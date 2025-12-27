import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import chokidar from 'chokidar';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const QUESTIONS_PATH = path.join(DATA_DIR, 'questions.json');
const CHARACTERS_PATH = path.join(DATA_DIR, 'characters.json');

const PORT = process.env.PORT || 5174;
const BASE_POINTS = 1000;
const WRONG_PENALTY = Number(process.env.WRONG_PENALTY || 0);
const FREEZE_DURATION_MS = 3000;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

const gameState = {
  phase: 'lobby',
  categories: [],
  characters: [],
  players: new Map(),
  hostPlayerId: null,
  usedQuestionIds: new Set(),
  currentQuestion: null,
  questionStartTime: null,
  answers: {},
  answerStats: {},
  leaderboard: [],
};

let revealTimer = null;

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const isV4 = net.family === 'IPv4' || net.family === 4;
      if (isV4 && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

const preferredHost = process.env.PUBLIC_HOST || getLocalIp();

async function loadJsonFile(filePath, fallback = {}) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to load ${filePath}:`, err);
    return fallback;
  }
}

async function loadData() {
  const questionsData = await loadJsonFile(QUESTIONS_PATH, { categories: [], questions: [] });
  const charactersData = await loadJsonFile(CHARACTERS_PATH, { characters: [] });
  gameState.categories = questionsData.categories || [];
  gameState.questions = questionsData.questions || [];
  gameState.characters = charactersData.characters || [];
  for (const player of gameState.players.values()) {
    player.abilityUses = getAbilityUses(player.characterId);
  }
  io.emit('server:dataReloaded');
  broadcastState();
}

function resetGame(keepPlayers = true) {
  clearRevealTimer();
  gameState.phase = 'lobby';
  gameState.usedQuestionIds = new Set();
  gameState.currentQuestion = null;
  gameState.questionStartTime = null;
  gameState.answers = {};
  gameState.answerStats = {};
  gameState.leaderboard = [];
  if (!keepPlayers) {
    gameState.players.clear();
  } else {
    for (const player of gameState.players.values()) {
      player.score = 0;
      player.ready = false;
      player.abilityUses = getAbilityUses(player.characterId);
      player.shieldConsumed = false;
    }
  }
  broadcastState();
}

function clearRevealTimer() {
  if (revealTimer) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }
}

function getAbilityUses(characterId) {
  const character = gameState.characters.find((c) => c.id === characterId);
  if (!character || !character.ability) return {};
  return { [character.ability.id]: character.ability.usesPerGame || 0 };
}

function sanitizeQuestion(question, phase) {
  if (!question) return null;
  const clone = { ...question };
  if (phase !== 'reveal') {
    delete clone.correctOptionId;
    delete clone.explanation;
  }
  return clone;
}

function calculateMultiplier(answerTimeMs, timeLimitSec) {
  if (!timeLimitSec) return 1;
  const ratio = Math.min(1, Math.max(0, answerTimeMs / 1000 / timeLimitSec));
  const multiplier = 1 - 0.8 * ratio;
  return Math.max(0.2, Number(multiplier.toFixed(3)));
}

function computeLeaderboard() {
  const leaderboard = Array.from(gameState.players.values())
    .map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, characterId: p.characterId }))
    .sort((a, b) => b.score - a.score);
  gameState.leaderboard = leaderboard;
}

function selectQuestion(categoryId) {
  const pool = gameState.questions.filter((q) => q.categoryId === categoryId && !gameState.usedQuestionIds.has(q.id));
  if (!pool.length) {
    const remaining = gameState.questions.filter((q) => !gameState.usedQuestionIds.has(q.id));
    return remaining[Math.floor(Math.random() * remaining.length)];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function broadcastState() {
  io.emit('server:state', buildStatePayload());
}

function beginGame() {
  gameState.phase = 'category_pick';
  gameState.usedQuestionIds = new Set();
  gameState.leaderboard = [];
  gameState.currentQuestion = null;
  gameState.questionStartTime = null;
  gameState.answers = {};
  gameState.answerStats = {};
  clearRevealTimer();
  broadcastState();
}

function startQuestion(question) {
  clearRevealTimer();
  if (!question) return;
  gameState.currentQuestion = question;
  gameState.phase = 'question';
  gameState.questionStartTime = Date.now();
  gameState.answers = {};
  gameState.answerStats = {};
  for (const player of gameState.players.values()) {
    player.frozenUntil = 0;
  }
  io.emit('server:question', sanitizeQuestion(question, 'question'));
  const limitMs = (question.timeLimitSec || 15) * 1000;
  revealTimer = setTimeout(() => {
    if (gameState.phase === 'question') {
      revealQuestion();
    }
  }, limitMs + 200);
  broadcastState();
}

function buildStatePayload() {
  return {
    phase: gameState.phase,
    categories: gameState.categories,
    characters: gameState.characters,
    players: Array.from(gameState.players.values()).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      characterId: p.characterId,
      score: p.score,
      ready: p.ready,
      abilityUses: p.abilityUses,
      shieldConsumed: p.shieldConsumed,
      frozenUntil: p.frozenUntil,
      lastAnswer: gameState.answers[p.id] || null,
    })),
    hostPlayerId: gameState.hostPlayerId,
    preferredHost,
    currentQuestion: sanitizeQuestion(gameState.currentQuestion, gameState.phase),
    questionStartTime: gameState.questionStartTime,
    answerStats: gameState.answerStats,
    leaderboard: gameState.leaderboard,
    usedQuestionCount: gameState.usedQuestionIds.size,
    totalQuestions: (gameState.questions || []).length,
  };
}

function revealQuestion() {
  clearRevealTimer();
  if (!gameState.currentQuestion) return;
  const question = gameState.currentQuestion;
  for (const [playerId, answer] of Object.entries(gameState.answers)) {
    const player = gameState.players.get(playerId);
    if (!player) continue;
    const isCorrect = answer.optionId === question.correctOptionId;
    if (isCorrect) {
      const multiplier = calculateMultiplier(answer.answerTimeMs, question.timeLimitSec || 15);
      const points = Math.round(BASE_POINTS * multiplier);
      player.score += points;
      answer.pointsEarned = points;
    } else if (WRONG_PENALTY) {
      player.score += WRONG_PENALTY;
    }
  }
  computeLeaderboard();
  gameState.phase = 'reveal';
  broadcastState();
}

function maybeEndGame() {
  const allUsed = gameState.usedQuestionIds.size >= (gameState.questions || []).length;
  if (allUsed) {
    gameState.phase = 'game_end';
    broadcastState();
    return true;
  }
  return false;
}

function handleAbilityUse(player, { abilityId, targetPlayerId }) {
  if (!abilityId || !player) return;
  const usesLeft = player.abilityUses?.[abilityId] ?? 0;
  if (usesLeft <= 0) return;
  const character = gameState.characters.find((c) => c.id === player.characterId);
  if (!character || character.ability?.id !== abilityId) return;

  const decrementUse = () => {
    player.abilityUses[abilityId] = usesLeft - 1;
  };

  if (abilityId === 'fifty') {
    decrementUse();
    const question = gameState.currentQuestion;
    if (!question) return;
    const wrongOptions = question.options.filter((o) => o.id !== question.correctOptionId);
    const shuffled = [...wrongOptions].sort(() => Math.random() - 0.5);
    const removed = new Set(shuffled.slice(0, 2).map((o) => o.id));
    const allowedOptions = question.options.filter((o) => !removed.has(o.id)).map((o) => o.id);
    io.to(player.socketId).emit('ability:fifty', { allowedOptions });
  }

  if (abilityId === 'shuffle_enemy' && targetPlayerId) {
    const target = gameState.players.get(targetPlayerId);
    if (!target) return;
    if (applyShieldIfPresent(target)) return;
    decrementUse();
    const question = gameState.currentQuestion;
    if (!question) return;
    const shuffledOptions = [...question.options].sort(() => Math.random() - 0.5).map((o) => o.id);
    io.to(target.socketId).emit('ability:shuffleOptions', { order: shuffledOptions, from: player.nickname });
  }

  if (abilityId === 'freeze_enemy' && targetPlayerId) {
    const target = gameState.players.get(targetPlayerId);
    if (!target) return;
    if (applyShieldIfPresent(target)) return;
    decrementUse();
    target.frozenUntil = Date.now() + FREEZE_DURATION_MS;
    io.to(target.socketId).emit('ability:freeze', { durationMs: FREEZE_DURATION_MS, from: player.nickname });
  }

  broadcastState();
}

function applyShieldIfPresent(target) {
  const remainingShield = target.abilityUses?.shield ?? 0;
  const hasShield = target.characterId === 'shieldy' && remainingShield > 0 && !target.shieldConsumed;
  if (!hasShield) return false;
  target.abilityUses.shield = remainingShield - 1;
  target.shieldConsumed = true;
  io.to(target.socketId).emit('ability:shieldTriggered');
  return true;
}

io.on('connection', (socket) => {
  console.log('Client connected', socket.id);

  socket.on('player:join', ({ nickname, characterId }, callback) => {
    if (!nickname) {
      callback?.({ ok: false, error: 'Nickname required' });
      return;
    }
    const player = {
      id: socket.id,
      socketId: socket.id,
      nickname,
      characterId,
      score: 0,
      ready: false,
      abilityUses: getAbilityUses(characterId),
      shieldConsumed: false,
      frozenUntil: 0,
    };
    gameState.players.set(socket.id, player);
    if (!gameState.hostPlayerId) {
      gameState.hostPlayerId = socket.id;
    }
    broadcastState();
    callback?.({ ok: true, playerId: socket.id });
  });

  socket.on('player:ready', (isReady) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;
    player.ready = Boolean(isReady);
    broadcastState();
  });

  socket.on('player:answer', ({ optionId }) => {
    const player = gameState.players.get(socket.id);
    if (!player || gameState.phase !== 'question' || !gameState.currentQuestion) return;
    const now = Date.now();
    if (player.frozenUntil && now < player.frozenUntil) {
      io.to(socket.id).emit('player:blocked', { reason: 'frozen' });
      return;
    }
    if (gameState.answers[player.id]) return;
    const answerTimeMs = now - gameState.questionStartTime;
    gameState.answers[player.id] = { optionId, answerTimeMs };
    gameState.answerStats[optionId] = (gameState.answerStats[optionId] || 0) + 1;
    broadcastState();
  });

  socket.on('player:useAbility', (payload) => {
    const player = gameState.players.get(socket.id);
    if (!player || gameState.phase !== 'question') return;
    handleAbilityUse(player, payload || {});
  });

  socket.on('player:startGame', () => {
    if (gameState.phase !== 'lobby') return;
    if (socket.id !== gameState.hostPlayerId) return;
    const players = Array.from(gameState.players.values());
    const everyoneReady = players.length > 0 && players.every((p) => p.ready);
    if (!everyoneReady) return;
    beginGame();
  });

  socket.on('admin:startGame', () => {
    beginGame();
  });

  socket.on('admin:pickCategory', ({ categoryId }) => {
    if (gameState.phase !== 'category_pick') return;
    const question = selectQuestion(categoryId);
    if (!question) return;
    gameState.usedQuestionIds.add(question.id);
    startQuestion(question);
  });

  socket.on('admin:next', () => {
    if (gameState.phase === 'question') {
      revealQuestion();
    } else if (gameState.phase === 'reveal') {
      if (!maybeEndGame()) {
        gameState.phase = 'category_pick';
        gameState.currentQuestion = null;
        gameState.questionStartTime = null;
        gameState.answers = {};
        gameState.answerStats = {};
        clearRevealTimer();
        broadcastState();
      }
    }
  });

  socket.on('admin:reset', () => {
    resetGame(true);
  });

  socket.on('admin:reloadData', () => {
    loadData();
  });

  socket.on('disconnect', () => {
    gameState.players.delete(socket.id);
    if (gameState.hostPlayerId === socket.id) {
      const next = gameState.players.values().next().value;
      gameState.hostPlayerId = next ? next.id : null;
    }
    broadcastState();
  });

  socket.emit('server:state', buildStatePayload());
});

async function bootstrap() {
  await loadData();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
  chokidar.watch([QUESTIONS_PATH, CHARACTERS_PATH]).on('change', async (file) => {
    console.log(`${path.basename(file)} changed, reloading...`);
    await loadData();
  });
}

bootstrap();
