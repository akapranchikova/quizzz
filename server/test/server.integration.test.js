import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
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
      const refused = err?.cause?.code === 'ECONNREFUSED' || err?.code === 'ECONNREFUSED';
      if (!refused) {
        throw err;
      }
    }
    await delay(200);
  }
  throw new Error('Healthcheck did not respond in time');
}

function startServer(t) {
  const child = spawn('node', ['src/index.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, PORT: TEST_PORT, MIN_PLAYERS_TO_START: '2' },
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

test('server healthcheck responds and players can start a match', async (t) => {
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
