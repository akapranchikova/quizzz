import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const TEST_PORT = 5199;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

async function waitForHealth(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return true;
    } catch (err) {
      const code = err?.cause?.code || err?.code;
      const transient = code === 'ECONNREFUSED' || code === 'ECONNRESET';
      if (!transient) {
        throw err;
      }
    }
    await delay(200);
  }
  throw new Error('Healthcheck did not respond in time');
}

function startServer(t, extraEnv = {}) {
  const child = spawn('node', ['src/index.js'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, PORT: TEST_PORT, MIN_PLAYERS_TO_START: '2', ...extraEnv },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  t.after(() => {
    if (!child.killed) {
      child.kill();
    }
  });

  return child;
}

function createSocket() {
  return io(SERVER_URL, { transports: ['websocket'], autoConnect: true });
}

async function joinPlayer(socket, nickname) {
  await once(socket, 'connect');
  return new Promise((resolve, reject) => {
    socket.emit(
      'player:join',
      { nickname, characterId: 'spark' },
      (response) => {
        if (response?.ok) {
          resolve(response.playerId);
        } else {
          reject(new Error(response?.error || 'join failed'));
        }
      },
    );
  });
}

async function waitForPhase(socket, phase, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for phase ${phase}`)), timeoutMs);
    const handler = (payload) => {
      if (payload?.phase === phase) {
        clearTimeout(timer);
        socket.off('server:state', handler);
        resolve(payload);
      }
    };
    socket.on('server:state', handler);
  });
}

async function waitForState(socket, predicate, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('server:state', handler);
      reject(new Error('Timed out waiting for server state match'));
    }, timeoutMs);
    const handler = (payload) => {
      if (predicate(payload)) {
        clearTimeout(timer);
        socket.off('server:state', handler);
        resolve(payload);
      }
    };
    socket.on('server:state', handler);
  });
}

test('server healthcheck responds and players can start a match', { concurrency: false }, async (t) => {
  startServer(t);
  await waitForHealth(SERVER_URL);

  const playerOne = createSocket();
  const playerTwo = createSocket();

  t.after(() => {
    playerOne.close();
    playerTwo.close();
  });

  await Promise.all([joinPlayer(playerOne, 'PlayerOne'), joinPlayer(playerTwo, 'PlayerTwo')]);

  playerOne.emit('player:ready', true);
  playerTwo.emit('player:ready', true);

  await waitForPhase(playerOne, 'game_start_confirm');

  playerOne.emit('player:startGame');

  const stateAfterStart = await waitForPhase(playerOne, 'round_intro');
  assert.equal(stateAfterStart.phase, 'round_intro');

  const categoryPhase = await waitForPhase(playerOne, 'category_select');
  assert.equal(categoryPhase.phase, 'category_select');
});

test('ice event keeps player locked until manual clearing', { concurrency: false }, async (t) => {
  const randomShimPath = fileURLToPath(new URL('./random-zero.cjs', import.meta.url));
  const nodeOptions = [process.env.NODE_OPTIONS, `--require ${randomShimPath}`].filter(Boolean).join(' ');
  startServer(t, { NODE_OPTIONS: nodeOptions });
  await waitForHealth(SERVER_URL);

  const playerOne = createSocket();
  const playerTwo = createSocket();

  t.after(() => {
    playerOne.close();
    playerTwo.close();
  });

  const [playerOneId, playerTwoId] = await Promise.all([joinPlayer(playerOne, 'IcePlayer'), joinPlayer(playerTwo, 'Helper')]);
  const socketsById = new Map([
    [playerOneId, playerOne],
    [playerTwoId, playerTwo],
  ]);

  playerOne.emit('player:ready', true);
  playerTwo.emit('player:ready', true);

  await waitForPhase(playerOne, 'game_start_confirm');
  playerOne.emit('player:startGame');

  const categoryPhase = await waitForPhase(playerOne, 'category_select');
  const categoryId = categoryPhase.categoryOptions[0].id;
  playerOne.emit('player:voteCategory', { categoryId });
  playerTwo.emit('player:voteCategory', { categoryId });

  const randomEventState = await waitForPhase(playerOne, 'random_event');
  const lockedPlayerRandom = randomEventState.players.find((p) => p.eventLock);
  assert.equal(randomEventState.activeEvent?.effect, 'ice');
  assert.ok(lockedPlayerRandom?.id, 'locked player should exist');
  assert.deepEqual(lockedPlayerRandom.eventLock, { type: 'ice', cleared: false });
  const lockedSocket = socketsById.get(lockedPlayerRandom.id);
  assert.ok(lockedSocket, 'locked socket should be resolved');

  const abilityPhase = await waitForPhase(playerOne, 'ability_phase');
  const lockedPlayerAbility = abilityPhase.players.find((p) => p.id === lockedPlayerRandom.id);
  assert.deepEqual(lockedPlayerAbility.eventLock, { type: 'ice', cleared: false });

  playerOne.emit('player:confirmPreQuestion');
  playerTwo.emit('player:confirmPreQuestion');

  const questionState = await waitForPhase(playerOne, 'question');
  const question = questionState.currentQuestion;
  const lockedPlayerQuestion = questionState.players.find((p) => p.id === lockedPlayerRandom.id);
  assert.deepEqual(lockedPlayerQuestion.eventLock, { type: 'ice', cleared: false });

  const blockedPromise = once(lockedSocket, 'player:blocked');
  lockedSocket.emit('player:answer', { optionId: question.options[0].id });
  const [blockedPayload] = await blockedPromise;
  assert.equal(blockedPayload.reason, 'ice');

  lockedSocket.emit('player:clearEventLock');
  const unlockedState = await waitForState(playerOne, (payload) => {
    const player = payload.players.find((p) => p.id === lockedPlayerRandom.id);
    return player?.eventLock === null;
  });
  const unlockedPlayer = unlockedState.players.find((p) => p.id === lockedPlayerRandom.id);
  assert.equal(unlockedPlayer.eventLock, null);

  lockedSocket.emit('player:answer', { optionId: question.options[0].id });
  const answeredState = await waitForState(playerOne, (payload) => {
    const player = payload.players.find((p) => p.id === lockedPlayerRandom.id);
    return Boolean(player?.lastAnswer);
  });
  const answeredPlayer = answeredState.players.find((p) => p.id === lockedPlayerRandom.id);
  assert.equal(answeredPlayer.lastAnswer.optionId, question.options[0].id);
});
