import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import chokidar from 'chokidar';
import os from 'os';
import { fileURLToPath } from 'url';
import { randomBytes, randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const QUESTIONS_PATH = path.join(DATA_DIR, 'questions.json');
const CHARACTERS_PATH = path.join(DATA_DIR, 'characters.json');

const PORT = process.env.PORT || 5174;
const BASE_POINTS = 1000;
const WRONG_PENALTY = Number(process.env.WRONG_PENALTY || 0);
const FREEZE_DURATION_MS = 3000;
const MIN_PLAYERS_TO_START = Number(process.env.MIN_PLAYERS_TO_START || 2);
const MAX_ROUNDS = Number(process.env.MAX_ROUNDS || 9);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 8);
const READY_DURATION_MS = 8000;
const ROUND_INTRO_DURATION_MS = 3200;
const CATEGORY_PICK_DURATION_MS = 15000;
const CATEGORY_REVEAL_DURATION_MS = 4000;
const RANDOM_EVENT_DURATION_MS = 4500;
const RANDOM_EVENT_CHANCE = 0.35;
const ABILITY_PHASE_DURATION_MS = 8000;
const QUESTION_DURATION_FALLBACK_MS = 15000;
const ANSWER_REVEAL_DURATION_MS = 5500;
const SCORE_DURATION_MS = 4500;
const INTERMISSION_DURATION_MS = 2200;
const MINI_GAME_DURATION_MS = 8000;
const NEXT_ROUND_CONFIRM_DURATION_MS = 8000;
const ALL_CORRECT_BONUS_POINTS = 350;
const RESUME_GRACE_PERIOD_MS = 45000;
const MINI_GAME_SCORE_CAP = 500;
const MINI_GAME_ALLOWED = ['MATCH_PAIRS', 'SORT_ORDER', 'CATEGORY_SNAP', 'ODD_ONE_OUT'];
const MINI_GAME_SCHEDULE_DEFAULT = [4, 8];
const MINI_GAME_SINGLE_FALLBACK = 6;
const SPEED_BONUS_WINDOW_MS = 3000;
const SPEED_BONUS_POINTS = 200;
const CHARACTER_THEMES = {
  spark: { art: '/assets/characters/spark.png', accent: '#f97316' },
  glitch: { art: '/assets/characters/glitch.png', accent: '#22d3ee' },
  frost: { art: '/assets/characters/frost.png', accent: '#38bdf8' },
  shieldy: { art: '/assets/characters/shieldy.png', accent: '#a3e635' },
  echo: { art: '/assets/characters/echo.png', accent: '#c084fc' },
  blitz: { art: '/assets/characters/blitz.png', accent: '#fde047' },
};

const CATEGORY_THEMES = {
  geography: { art: '/assets/categories/geography.png', accent: '#22c55e' },
  history: { art: '/assets/categories/history.png', accent: '#f59e0b' },
  movies: { art: '/assets/categories/movies.png', accent: '#f472b6' },
  geek: { art: '/assets/categories/geek.png', accent: '#8b5cf6' },
};

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
  pingInterval: 10000,
  pingTimeout: 20000,
});

const gameState = {
  phase: 'lobby',
  phaseStartedAt: null,
  phaseEndsAt: null,
  narration: 'Подключение игроков',
  activeCategoryId: null,
  categories: [],
  categoryOptions: [],
  characters: [],
  players: new Map(),
  usedQuestionIds: new Set(),
  currentQuestion: null,
  nextQuestion: null,
  questionStartTime: null,
  answers: {},
  answerStats: {},
  preQuestionReady: {},
  leaderboard: [],
  categoryVotes: {},
  roundNumber: 0,
  maxRounds: MAX_ROUNDS,
  activeEvent: null,
  allCorrectBonusActive: false,
  recentCategoryIds: [],
  miniGamesPlayed: [],
  miniGameSchedule: [],
  activeMiniGame: null,
  miniGameState: null,
  recentImpact: null,
  phaseEligiblePlayerIds: null,
};

let phaseTimer = null;
let revealTimer = null;
const socketToPlayerId = new Map();
const reconnectTimers = new Map();

const RANDOM_EVENTS = [
  {
    id: 'ice_lock',
    title: 'Ледяная стужа',
    effect: 'ice',
    kind: 'malus',
    requiresTarget: true,
    requiresAction: true,
    description: 'Экран с ответами покрывается льдом. Разбейте его, чтобы отвечать.',
  },
  {
    id: 'mud_splash',
    title: 'Грязевая атака',
    effect: 'mud',
    kind: 'malus',
    requiresTarget: true,
    requiresAction: true,
    description: 'Ответы заляпаны. Очистите экран свайпами/тапами, чтобы выбрать.',
  },
  {
    id: 'option_shuffle',
    title: 'Вихрь хаоса',
    effect: 'shuffle',
    kind: 'malus',
    requiresTarget: true,
    description: 'Варианты ответа начинают прыгать. Следите за порядком!',
  },
  {
    id: 'double_points',
    title: 'x2 очков',
    effect: 'double_points',
    kind: 'buff',
    requiresTarget: true,
    description: 'У выбранного игрока удваиваются очки за верный ответ.',
  },
  {
    id: 'all_correct_bonus',
    title: 'Бонус синхрона',
    effect: 'all_correct_bonus',
    kind: 'buff',
    targetMode: 'all',
    description: 'Если все ответят верно — всем прилетит общий бонус.',
  },
  {
    id: 'event_shield',
    title: 'Щит судьбы',
    effect: 'event_shield',
    kind: 'buff',
    requiresTarget: true,
    description: 'Следующая пакость проигнорируется выбранным игроком.',
  },
];

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
const phasesWithEligiblePlayers = new Set(['category_select', 'ability_phase', 'question', 'mini_game']);

function generateResumeToken() {
  return randomBytes(24).toString('hex');
}

function clearGraceTimer(playerId) {
  const timer = reconnectTimers.get(playerId);
  if (timer) {
    clearTimeout(timer);
  }
  reconnectTimers.delete(playerId);
}

function buildMiniGameSchedule(maxRounds = MAX_ROUNDS) {
  if (maxRounds >= Math.max(...MINI_GAME_SCHEDULE_DEFAULT)) {
    return MINI_GAME_SCHEDULE_DEFAULT.filter((round) => round <= maxRounds);
  }
  if (maxRounds >= MINI_GAME_SINGLE_FALLBACK) {
    return [MINI_GAME_SINGLE_FALLBACK];
  }
  return [];
}

function cleanupPlayerState(playerId) {
  delete gameState.categoryVotes[playerId];
  delete gameState.preQuestionReady[playerId];
  delete gameState.answers[playerId];
}

function clearPlayerEventLocks() {
  for (const player of gameState.players.values()) {
    if (player.eventLock) {
      player.eventLock = null;
    }
  }
}

function scheduleOfflineStatus(player) {
  clearGraceTimer(player.id);
  reconnectTimers.set(
    player.id,
    setTimeout(() => {
      const existing = gameState.players.get(player.id);
      if (!existing || existing.status === 'active') return;
      if (Date.now() - (existing.lastSeenAt || 0) < RESUME_GRACE_PERIOD_MS) return;
      existing.status = 'offline';
      if (gameState.phase === 'lobby' || gameState.phase === 'game_end') {
        gameState.players.delete(player.id);
        cleanupPlayerState(player.id);
      }
      broadcastState();
      syncLobbyState();
    }, RESUME_GRACE_PERIOD_MS)
  );
}

function setEligiblePlayersForPhase(phase) {
  if (phasesWithEligiblePlayers.has(phase)) {
    gameState.phaseEligiblePlayerIds = new Set(getActivePlayers().map((p) => p.id));
  } else {
    gameState.phaseEligiblePlayerIds = null;
  }
}

function isPlayerEligible(playerId) {
  if (!gameState.phaseEligiblePlayerIds) return true;
  return gameState.phaseEligiblePlayerIds.has(playerId);
}

function getActivePlayers() {
  return Array.from(gameState.players.values()).filter((p) => p.status === 'active');
}

function getActivePlayerIds() {
  return getActivePlayers().map((p) => p.id);
}

function getActiveEligiblePlayerIds() {
  const eligible = gameState.phaseEligiblePlayerIds
    ? Array.from(gameState.phaseEligiblePlayerIds)
    : Array.from(gameState.players.keys());
  return eligible.filter((id) => gameState.players.get(id)?.status === 'active');
}

function getPlayerBySocket(socket) {
  const playerId = socketToPlayerId.get(socket.id);
  return playerId ? gameState.players.get(playerId) : null;
}

function attachSocketToPlayer(player, socket) {
  if (!player) return;
  socketToPlayerId.set(socket.id, player.id);
  player.socketId = socket.id;
  player.status = 'active';
  player.lastSeenAt = Date.now();
  clearGraceTimer(player.id);
}

function markPlayerInactive(player) {
  if (!player) return;
  player.status = 'inactive';
  player.lastSeenAt = Date.now();
  player.socketId = null;
  scheduleOfflineStatus(player);
}

async function loadJsonFile(filePath, fallback = {}) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to load ${filePath}:`, err);
    return fallback;
  }
}

function enrichCharacters(characters = []) {
  return (characters || []).map((char) => {
    const theme = CHARACTER_THEMES[char.id] || {};
    return {
      ...char,
      art: char.art || theme.art || null,
      accent: char.accent || char.color || theme.accent || '#8b5cf6',
    };
  });
}

function enrichCategories(categories = []) {
  return (categories || []).map((cat) => {
    const theme = CATEGORY_THEMES[cat.id] || {};
    return {
      ...cat,
      art: cat.art || theme.art || null,
      accent: cat.accent || cat.color || theme.accent || '#22d3ee',
    };
  });
}

async function loadData() {
  const questionsData = await loadJsonFile(QUESTIONS_PATH, { categories: [], questions: [] });
  const charactersData = await loadJsonFile(CHARACTERS_PATH, { characters: [] });
  gameState.categories = enrichCategories(questionsData.categories || []);
  gameState.questions = questionsData.questions || [];
  gameState.categoryOptions = chooseCategoryOptions();
  gameState.characters = enrichCharacters(charactersData.characters || []);
  gameState.miniGameSchedule = buildMiniGameSchedule(gameState.maxRounds || MAX_ROUNDS);
  gameState.miniGamesPlayed = [];
  gameState.activeMiniGame = null;
  gameState.miniGameState = null;
  for (const player of gameState.players.values()) {
    player.abilityUses = getAbilityUses(player.characterId);
    player.status = player.status || 'active';
    player.lastSeenAt = player.lastSeenAt || Date.now();
  }
  io.emit('server:dataReloaded');
  broadcastState();
}

function resetGame(keepPlayers = true) {
  clearRevealTimer();
  clearPhaseTimer();
  gameState.phase = 'lobby';
  gameState.phaseStartedAt = null;
  gameState.phaseEndsAt = null;
  gameState.narration = 'Подключение игроков';
  gameState.activeCategoryId = null;
  gameState.categoryOptions = [];
  gameState.usedQuestionIds = new Set();
  gameState.currentQuestion = null;
  gameState.nextQuestion = null;
  gameState.questionStartTime = null;
  gameState.answers = {};
  gameState.answerStats = {};
  gameState.preQuestionReady = {};
  gameState.leaderboard = [];
  gameState.categoryVotes = {};
  gameState.roundNumber = 0;
  gameState.activeEvent = null;
  gameState.allCorrectBonusActive = false;
  gameState.recentCategoryIds = [];
  gameState.miniGameSchedule = buildMiniGameSchedule(gameState.maxRounds || MAX_ROUNDS);
  gameState.activeMiniGame = null;
  gameState.miniGamesPlayed = [];
  gameState.miniGameState = null;
  gameState.recentImpact = null;
  gameState.phaseEligiblePlayerIds = null;
  if (!keepPlayers) {
    gameState.players.clear();
  } else {
    for (const player of gameState.players.values()) {
      player.score = 0;
      player.ready = false;
      player.abilityUses = getAbilityUses(player.characterId);
      player.shieldConsumed = false;
      player.eventLock = null;
      player.statusEffects = { doublePoints: false, eventShield: false, hintPercentActive: false, speedBonusReady: false };
      player.preparedForQuestion = false;
      player.status = player.status || 'active';
      player.lastSeenAt = Date.now();
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

function clearPhaseTimer() {
  if (phaseTimer) {
    clearTimeout(phaseTimer);
    phaseTimer = null;
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
  if (phase !== 'answer_reveal' && phase !== 'score') {
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

function computeCategoryVoteStats() {
  const stats = {};
  const allowedIds = (gameState.categoryOptions?.length ? gameState.categoryOptions : gameState.categories).map((c) => c.id);
  for (const categoryId of Object.values(gameState.categoryVotes || {})) {
    if (!categoryId) continue;
    if (allowedIds.length && !allowedIds.includes(categoryId)) continue;
    stats[categoryId] = (stats[categoryId] || 0) + 1;
  }
  return stats;
}

function buildHintPercentStats(excludePlayerId = null) {
  const counts = {};
  for (const [playerId, answer] of Object.entries(gameState.answers || {})) {
    if (!answer?.optionId) continue;
    if (excludePlayerId && playerId === excludePlayerId) continue;
    counts[answer.optionId] = (counts[answer.optionId] || 0) + 1;
  }
  const total = Object.values(counts).reduce((acc, count) => acc + count, 0);
  const percents = Object.fromEntries(
    Object.entries(counts).map(([optionId, count]) => [optionId, total ? Math.round((count / total) * 100) : 0])
  );
  const leadingOptionId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { percents, total, leadingOptionId };
}

function emitHintPercentToPlayer(player) {
  if (!player?.socketId || !player.statusEffects?.hintPercentActive) return;
  const payload = buildHintPercentStats(player.id);
  io.to(player.socketId).emit('ability:hintPercent', payload);
}

function emitHintPercentToSubscribers() {
  for (const player of gameState.players.values()) {
    if (player.statusEffects?.hintPercentActive) {
      emitHintPercentToPlayer(player);
    }
  }
}

function chooseCategoryOptions() {
  const categories = gameState.categories || [];
  if (!categories.length) return [];
  const recentSet = new Set(gameState.recentCategoryIds || []);
  const fresh = categories.filter((c) => !recentSet.has(c.id));
  const pool = (fresh.length >= 4 ? fresh : categories).slice();
  const shuffled = pool.sort(() => Math.random() - 0.5);
  const unique = [];
  for (const cat of shuffled) {
    if (unique.find((c) => c.id === cat.id)) continue;
    unique.push(cat);
    if (unique.length === 4) break;
  }
  return unique.length ? unique : categories.slice(0, 4);
}

function updateNarrationForPhase(phase) {
  const displayRound = Math.max(1, gameState.roundNumber);
  const phrases = {
    lobby: 'Подключение',
    ready: 'Готовность',
    game_start_confirm: 'Старт по удержанию',
    round_intro: `Раунд ${displayRound}`,
    category_select: `Выбор ${displayRound}/${gameState.maxRounds}`,
    category_reveal: 'Категория готова',
    random_event: 'Событие',
    ability_phase: 'Подготовка',
    question: 'Поехали',
    answer_reveal: 'Ответ открыт',
    score: 'Очки летят',
    intermission: 'Пауза',
    mini_game: 'Миг мини-игры',
    next_round_confirm: 'Далее?',
    game_end: 'Финал',
  };
  gameState.narration = phrases[phase] || 'Идём дальше';
}

function setPhase(phase, durationMs = null, onEnter = null) {
  clearPhaseTimer();
  gameState.phase = phase;
  const now = Date.now();
  gameState.phaseStartedAt = now;
  gameState.phaseEndsAt = durationMs ? now + durationMs : null;
  updateNarrationForPhase(phase);
  setEligiblePlayersForPhase(phase);
  if (onEnter) {
    onEnter();
  }
  broadcastState();
  if (durationMs) {
    phaseTimer = setTimeout(() => handlePhaseTimeout(phase), durationMs);
  }
}

function handlePhaseTimeout(expectedPhase) {
  if (gameState.phase !== expectedPhase) return;
  if (expectedPhase === 'ready') {
    if (readyCountMeetsMinimum()) {
      for (const player of gameState.players.values()) {
        player.ready = true;
      }
      enterGameStartConfirm();
    } else if (!hasMinimumPlayers()) {
      setPhase('lobby');
    } else {
      setPhase('ready', READY_DURATION_MS);
    }
    return;
  }
  if (expectedPhase === 'round_intro') {
    setPhase('category_select', CATEGORY_PICK_DURATION_MS);
    return;
  }
  if (expectedPhase === 'category_select') {
    if (!resolveCategory()) {
      startNextRoundConfirm();
    }
    return;
  }
  if (expectedPhase === 'category_reveal') {
    startRandomEventPhase();
    return;
  }
  if (expectedPhase === 'random_event') {
    startAbilityPhase();
    return;
  }
  if (expectedPhase === 'ability_phase') {
    startQuestion(gameState.nextQuestion || gameState.currentQuestion);
    return;
  }
  if (expectedPhase === 'question') {
    revealQuestion();
    return;
  }
  if (expectedPhase === 'answer_reveal') {
    startScoreAnimation();
    return;
  }
  if (expectedPhase === 'score') {
    startIntermissionOrNextRound();
    return;
  }
  if (expectedPhase === 'intermission') {
    startMiniGame();
    return;
  }
  if (expectedPhase === 'mini_game') {
    finalizeMiniGame();
    startNextRoundConfirm();
    return;
  }
  if (expectedPhase === 'next_round_confirm') {
    beginRound();
  }
}

function chooseCategoryFromVotes() {
  const stats = computeCategoryVoteStats();
  const entries = Object.entries(stats);
  if (!entries.length) return null;
  const maxVotes = Math.max(...entries.map(([, count]) => count));
  const contenders = entries.filter(([, count]) => count === maxVotes).map(([id]) => id);
  return contenders[Math.floor(Math.random() * contenders.length)];
}

function resolveCategory() {
  const pickedVotes = chooseCategoryFromVotes();
  const available = gameState.categoryOptions?.length ? gameState.categoryOptions : gameState.categories;
  const fallbackCategory = available.length ? available[Math.floor(Math.random() * available.length)]?.id : null;
  const categoryId = pickedVotes || fallbackCategory;
  if (!categoryId) return false;
  const question = selectQuestion(categoryId);
  if (!question) return false;
  gameState.activeCategoryId = categoryId;
  gameState.nextQuestion = question;
  gameState.usedQuestionIds.add(question.id);
  gameState.recentCategoryIds = [...(gameState.recentCategoryIds || []), categoryId].slice(-5);
  setPhase('category_reveal', CATEGORY_REVEAL_DURATION_MS);
  return true;
}

function haveAllPlayersVoted() {
  const players = getActiveEligiblePlayerIds();
  return players.length > 0 && players.every((id) => Boolean(gameState.categoryVotes?.[id]));
}

function haveAllPlayersPrepared() {
  const players = getActiveEligiblePlayerIds();
  return players.length > 0 && players.every((id) => Boolean(gameState.preQuestionReady?.[id]));
}

function haveAllPlayersAnswered() {
  const players = getActiveEligiblePlayerIds();
  return players.length > 0 && players.every((id) => Boolean(gameState.answers?.[id]));
}

function markPlayerPrepared(playerId) {
  if (!playerId) return;
  if (!isPlayerEligible(playerId)) return;
  gameState.preQuestionReady[playerId] = true;
  const player = gameState.players.get(playerId);
  if (player) {
    player.preparedForQuestion = true;
  }
  if (haveAllPlayersPrepared()) {
    startQuestion(gameState.currentQuestion || gameState.nextQuestion);
  } else {
    broadcastState();
  }
}

function startRoundFromVotes(requireAllVotes = false) {
  if (gameState.phase !== 'category_select') return false;
  if (requireAllVotes && !haveAllPlayersVoted()) return false;
  return resolveCategory();
}

function selectQuestion(categoryId) {
  const pool = gameState.questions.filter((q) => q.categoryId === categoryId && !gameState.usedQuestionIds.has(q.id));
  if (!pool.length) {
    const remaining = gameState.questions.filter((q) => !gameState.usedQuestionIds.has(q.id));
    if (!remaining.length) return null;
    return remaining[Math.floor(Math.random() * remaining.length)];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function broadcastState() {
  io.emit('server:state', buildStatePayload());
}

function prepareForMatch() {
  clearRevealTimer();
  clearPhaseTimer();
  gameState.usedQuestionIds = new Set();
  gameState.leaderboard = [];
  gameState.currentQuestion = null;
  gameState.nextQuestion = null;
  gameState.questionStartTime = null;
  gameState.answers = {};
  gameState.answerStats = {};
  gameState.preQuestionReady = {};
  gameState.categoryVotes = {};
  gameState.activeCategoryId = null;
  gameState.roundNumber = 0;
  gameState.activeEvent = null;
  gameState.recentCategoryIds = [];
  gameState.allCorrectBonusActive = false;
  gameState.miniGameSchedule = buildMiniGameSchedule(gameState.maxRounds || MAX_ROUNDS);
  gameState.miniGamesPlayed = [];
  gameState.activeMiniGame = null;
  gameState.miniGameState = null;
  gameState.recentImpact = null;
  gameState.categoryOptions = chooseCategoryOptions();
  gameState.phaseEligiblePlayerIds = null;
  clearPlayerEventLocks();
  for (const player of gameState.players.values()) {
    player.score = 0;
    player.shieldConsumed = false;
    player.abilityUses = getAbilityUses(player.characterId);
    player.preparedForQuestion = false;
    player.statusEffects = { doublePoints: false, eventShield: false, hintPercentActive: false, speedBonusReady: false };
  }
}

function hasMinimumPlayers() {
  return getActivePlayers().length >= MIN_PLAYERS_TO_START;
}

function hasEnoughReadyPlayers() {
  const players = getActivePlayers();
  const enoughPlayers = players.length >= MIN_PLAYERS_TO_START;
  return enoughPlayers && players.every((p) => p.ready);
}

function readyCountMeetsMinimum() {
  const players = getActivePlayers();
  const readyCount = players.filter((p) => p.ready).length;
  return players.length >= MIN_PLAYERS_TO_START && readyCount >= MIN_PLAYERS_TO_START;
}

function enterReadyPhase() {
  prepareForMatch();
  setPhase('ready', READY_DURATION_MS);
}

function enterGameStartConfirm() {
  clearPhaseTimer();
  setPhase('game_start_confirm');
}

function beginRound() {
  if (maybeEndGame()) return;
  gameState.roundNumber += 1;
  gameState.activeCategoryId = null;
  gameState.categoryVotes = {};
  gameState.answers = {};
  gameState.answerStats = {};
  gameState.preQuestionReady = {};
  gameState.currentQuestion = null;
  gameState.nextQuestion = null;
  gameState.questionStartTime = null;
  gameState.activeEvent = null;
  gameState.allCorrectBonusActive = false;
  gameState.categoryOptions = chooseCategoryOptions();
  clearPlayerEventLocks();
  for (const player of gameState.players.values()) {
    player.preparedForQuestion = false;
    player.statusEffects = { doublePoints: false, eventShield: false, hintPercentActive: false, speedBonusReady: false };
  }
  setPhase('round_intro', ROUND_INTRO_DURATION_MS);
}

function startRandomEventPhase() {
  const question = gameState.nextQuestion || (gameState.activeCategoryId ? selectQuestion(gameState.activeCategoryId) : null);
  if (!question) {
    startNextRoundConfirm();
    return;
  }
  gameState.currentQuestion = question;
  gameState.questionStartTime = null;
  gameState.answers = {};
  gameState.answerStats = {};
  gameState.preQuestionReady = {};
  const event = pickRandomEvent();
  const targetPlayerId = event?.targetMode === 'all' ? null : pickEventTargetId();
  const payload = event ? { ...event, targetPlayerId } : null;
  if (payload) {
    setPhase('random_event', RANDOM_EVENT_DURATION_MS, () => {
      gameState.narration = `Случайное событие: ${payload.title}`;
      gameState.activeEvent = payload;
      applyRandomEvent(payload);
    });
    return;
  }
  gameState.activeEvent = null;
  startAbilityPhase();
}

function startAbilityPhase() {
  if (!gameState.currentQuestion) {
    startNextRoundConfirm();
    return;
  }
  setPhase('ability_phase', ABILITY_PHASE_DURATION_MS);
}

function syncLobbyState() {
  const enoughPlayers = hasMinimumPlayers();
  const everyoneReady = hasEnoughReadyPlayers();
  if ((gameState.phase === 'lobby' || gameState.phase === 'game_end') && enoughPlayers) {
    enterReadyPhase();
    return;
  }
  if (gameState.phase === 'ready') {
    if (!enoughPlayers) {
      setPhase('lobby');
      return;
    }
    if (everyoneReady) {
      enterGameStartConfirm();
      return;
    }
  }
  if (gameState.phase === 'game_start_confirm' && !enoughPlayers) {
    setPhase('lobby');
  }
}

function startQuestion(question) {
  clearRevealTimer();
  if (!question) {
    startNextRoundConfirm();
    return;
  }
  gameState.currentQuestion = question;
  gameState.questionStartTime = Date.now();
  gameState.answers = {};
  gameState.answerStats = {};
  gameState.categoryVotes = {};
  for (const player of gameState.players.values()) {
    player.frozenUntil = 0;
  }
  io.emit('server:question', sanitizeQuestion(question, 'question'));
  const limitMs = (question.timeLimitSec || QUESTION_DURATION_FALLBACK_MS / 1000) * 1000;
  setPhase('question', limitMs);
}

function startScoreAnimation() {
  setPhase('score', SCORE_DURATION_MS);
}

function shouldEnterIntermission() {
  const completedQuestions = gameState.roundNumber;
  const schedule = gameState.miniGameSchedule || [];
  return schedule.includes(completedQuestions);
}

function startIntermissionOrNextRound() {
  if (maybeEndGame()) return;
  if (shouldEnterIntermission()) {
    setPhase('intermission', INTERMISSION_DURATION_MS);
    return;
  }
  startNextRoundConfirm();
}

function startNextRoundConfirm() {
  if (maybeEndGame()) return;
  gameState.currentQuestion = null;
  gameState.nextQuestion = null;
  gameState.questionStartTime = null;
  gameState.answers = {};
  gameState.answerStats = {};
  gameState.activeCategoryId = null;
  gameState.categoryVotes = {};
  gameState.activeEvent = null;
  gameState.preQuestionReady = {};
  gameState.allCorrectBonusActive = false;
  gameState.activeMiniGame = null;
  gameState.miniGameState = null;
  clearPlayerEventLocks();
  for (const player of gameState.players.values()) {
    if (player.statusEffects) {
      player.statusEffects.hintPercentActive = false;
      player.statusEffects.speedBonusReady = false;
    }
  }
  setPhase('next_round_confirm', NEXT_ROUND_CONFIRM_DURATION_MS);
}

function randomFromArray(list = []) {
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function shuffleArray(list = []) {
  return [...list].sort(() => Math.random() - 0.5);
}

function pickMiniGameType() {
  const history = gameState.miniGamesPlayed || [];
  const lastType = history[history.length - 1] || null;
  const candidates = MINI_GAME_ALLOWED.filter(Boolean);
  const filtered = candidates.filter((t) => t !== lastType);
  return randomFromArray(filtered.length ? filtered : candidates);
}

function generateMatchPairsPayload() {
  const icons = ['🔥', '🌊', '🌿', '⚡', '🎯', '🚀', '🎧', '🌟', '🍀', '🍉', '🧊', '🎲'];
  const picked = shuffleArray(icons).slice(0, 4);
  if (picked.length < 4) return null;
  const cards = shuffleArray(
    picked.flatMap((icon, idx) => {
      const pairId = `pair_${idx}`;
      return [
        { id: `${pairId}_a`, pairId, icon },
        { id: `${pairId}_b`, pairId, icon },
      ];
    })
  );
  return { type: 'MATCH_PAIRS', data: { cards }, durationMs: MINI_GAME_DURATION_MS };
}

function generateSortOrderPayload() {
  const items = [
    { id: 'one', label: '1️⃣' },
    { id: 'two', label: '2️⃣' },
    { id: 'three', label: '3️⃣' },
    { id: 'four', label: '4️⃣' },
  ];
  const correctOrder = items.map((i) => i.id);
  const shuffledItems = shuffleArray(items);
  return { type: 'SORT_ORDER', data: { items: shuffledItems, correctOrder }, durationMs: MINI_GAME_DURATION_MS };
}

function generateCategorySnapPayload() {
  const categories = [
    { id: 'animal', label: '🐾' },
    { id: 'food', label: '🍔' },
    { id: 'tech', label: '💻' },
  ];
  const promptPool = [
    { label: 'кот', category: 'animal' },
    { label: 'бургер', category: 'food' },
    { label: 'мишка', category: 'animal' },
    { label: 'чипсы', category: 'food' },
    { label: 'мышь', category: 'tech' },
    { label: 'робот', category: 'tech' },
    { label: 'сыр', category: 'food' },
    { label: 'тигр', category: 'animal' },
  ];
  const prompts = shuffleArray(promptPool)
    .slice(0, 6)
    .map((p, idx) => ({ id: `snap_${idx}`, label: p.label, correctCategoryId: p.category }));
  if (prompts.length < 4) return null;
  return { type: 'CATEGORY_SNAP', data: { categories, prompts }, durationMs: MINI_GAME_DURATION_MS };
}

function generateOddOneOutPayload() {
  const roundsPool = [
    { items: ['🧊', '🔥', '☀️', '🌋'], odd: '🧊' },
    { items: ['🍎', '🍌', '🥕', '🍇'], odd: '🥕' },
    { items: ['🚗', '🚌', '✈️', '🚲'], odd: '✈️' },
    { items: ['🎧', '🎺', '🥁', '📱'], odd: '📱' },
    { items: ['⚽', '🏀', '🎾', '🎻'], odd: '🎻' },
    { items: ['🌊', '🏄', '⛵', '🏔️'], odd: '🏔️' },
    { items: ['📚', '📝', '🎨', '🍰'], odd: '🍰' },
  ];
  const rounds = shuffleArray(roundsPool)
    .slice(0, 6)
    .map((r, idx) => {
      const items = shuffleArray(r.items).map((label, itemIdx) => ({ id: `odd_${idx}_${itemIdx}`, label }));
      const correctItem = items.find((i) => i.label === r.odd) || items[0];
      return { id: `round_${idx}`, items, correctId: correctItem.id };
    });
  if (!rounds.length) return null;
  return { type: 'ODD_ONE_OUT', data: { rounds }, durationMs: MINI_GAME_DURATION_MS };
}

function createMiniGamePayload() {
  const type = pickMiniGameType();
  if (!type) return null;
  const generators = {
    MATCH_PAIRS: generateMatchPairsPayload,
    SORT_ORDER: generateSortOrderPayload,
    CATEGORY_SNAP: generateCategorySnapPayload,
    ODD_ONE_OUT: generateOddOneOutPayload,
  };
  const payload = generators[type]?.();
  if (!payload) return null;
  return { ...payload, type };
}

function ensureMiniGameProgress(playerId) {
  if (!gameState.miniGameState || !gameState.activeMiniGame) return null;
  const type = gameState.activeMiniGame.type;
  const progress = gameState.miniGameState.progress || {};
  if (!progress[playerId]) {
    if (type === 'MATCH_PAIRS') {
      progress[playerId] = { score: 0, done: false, openCardIds: [], matchedPairIds: [] };
    } else if (type === 'SORT_ORDER') {
      const items = gameState.activeMiniGame.data.items || [];
      let shuffled = shuffleArray(items.map((i) => i.id));
      const correct = gameState.activeMiniGame.data.correctOrder || [];
      if (shuffled.join(',') === correct.join(',') && shuffled.length > 1) {
        [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
      }
      progress[playerId] = { score: 0, done: false, order: shuffled };
    } else if (type === 'CATEGORY_SNAP') {
      progress[playerId] = { score: 0, done: false, promptIndex: 0, hits: 0, misses: 0 };
    } else if (type === 'ODD_ONE_OUT') {
      progress[playerId] = { score: 0, done: false, roundIndex: 0, hits: 0 };
    }
    gameState.miniGameState.progress = progress;
  }
  return progress[playerId];
}

function updateMiniGameScore(progress, delta) {
  const next = Math.min(MINI_GAME_SCORE_CAP, Math.max(0, Math.round((progress.score || 0) + delta)));
  progress.score = next;
}

function checkMiniGameCompletion() {
  const activePlayers = getActiveEligiblePlayerIds();
  const progress = gameState.miniGameState?.progress || {};
  if (!activePlayers.length) return false;
  return activePlayers.every((id) => progress[id]?.done);
}

function finalizeMiniGame(applyScores = true) {
  const miniGame = gameState.activeMiniGame;
  const state = gameState.miniGameState;
  if (!miniGame || !state || state.finished) return;
  state.finished = true;
  const results = [];
  if (applyScores) {
    const now = Date.now();
    for (const player of getActivePlayers()) {
      const progress = state.progress?.[player.id] || { score: 0 };
      const awarded = Math.min(MINI_GAME_SCORE_CAP, Math.max(0, Math.round(progress.score || 0)));
      if (awarded > 0) {
        player.score += awarded;
      }
      results.push({ playerId: player.id, score: awarded, done: Boolean(progress.done) });
    }
    state.results = results.sort((a, b) => b.score - a.score).slice(0, 3);
    if (state.results[0]?.playerId) {
      gameState.recentImpact = { from: state.results[0].playerId, target: null, effect: 'mini_game', at: now, kind: 'event' };
    }
    computeLeaderboard();
  }
}

function startMiniGame() {
  if (!shouldEnterIntermission()) {
    startNextRoundConfirm();
    return;
  }
  const payload = createMiniGamePayload();
  if (!payload || !payload.data) {
    startNextRoundConfirm();
    return;
  }
  gameState.activeMiniGame = { type: payload.type, data: payload.data, durationMs: payload.durationMs || MINI_GAME_DURATION_MS };
  gameState.miniGamesPlayed = [...(gameState.miniGamesPlayed || []), payload.type];
  gameState.miniGameSchedule = (gameState.miniGameSchedule || []).filter((round) => round !== gameState.roundNumber);
  setPhase('mini_game', gameState.activeMiniGame.durationMs, () => {
    gameState.miniGameState = {
      startedAt: gameState.phaseStartedAt,
      endsAt: gameState.phaseEndsAt,
      progress: {},
      results: [],
      finished: false,
    };
    broadcastState();
  });
}

function pickEventTargetId() {
  const players = getActivePlayers();
  if (!players.length) return null;
  const shuffled = players.sort(() => Math.random() - 0.5);
  return shuffled[0].id;
}

function pickRandomEvent() {
  if (Math.random() > RANDOM_EVENT_CHANCE) return null;
  return RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
}

function applyRandomEvent(payload) {
  if (!payload) return;
  const now = Date.now();
  if (payload.effect === 'all_correct_bonus') {
    gameState.allCorrectBonusActive = true;
    broadcastState();
    return;
  }
  const targets =
    payload.targetMode === 'all'
      ? getActivePlayers()
      : [gameState.players.get(payload.targetPlayerId)].filter((p) => p && p.status === 'active');
  let impactRecorded = false;
  for (const target of targets) {
    if (payload.kind === 'malus' && applyShieldIfPresent(target)) {
      continue;
    }
    if (payload.effect === 'double_points') {
      target.statusEffects = { ...(target.statusEffects || {}), doublePoints: true };
      if (target.socketId) {
        io.to(target.socketId).emit('event:applied', payload);
      }
    }
    if (payload.effect === 'event_shield') {
      target.statusEffects = { ...(target.statusEffects || {}), eventShield: true };
      if (target.socketId) {
        io.to(target.socketId).emit('event:applied', payload);
      }
    }
    if (payload.effect === 'ice' || payload.effect === 'mud') {
      target.eventLock = { type: payload.effect, cleared: false };
      if (target.socketId) {
        io.to(target.socketId).emit('event:applied', { ...payload, requiresAction: true });
      }
    }
    if (payload.effect === 'shuffle') {
      const question = gameState.nextQuestion || gameState.currentQuestion;
      if (!question) continue;
      const order = [...question.options].sort(() => Math.random() - 0.5).map((o) => o.id);
      if (target.socketId) {
        io.to(target.socketId).emit('event:shuffleOptions', { order, from: 'случайное событие' });
      }
    }
    if (!impactRecorded) {
      gameState.recentImpact = { from: null, target: target.id, effect: payload.effect, at: now, kind: 'event' };
      impactRecorded = true;
    }
  }
  broadcastState();
}

function concludeMiniGameIfFinished() {
  if (gameState.phase !== 'mini_game') return;
  if (!checkMiniGameCompletion()) return;
  finalizeMiniGame();
  startNextRoundConfirm();
}

function handleMatchPairsAction(player, { cardId }) {
  if (!cardId || !gameState.activeMiniGame?.data?.cards) return;
  const playerProgress = ensureMiniGameProgress(player.id);
  if (!playerProgress || playerProgress.done) return;
  const cards = gameState.activeMiniGame.data.cards;
  const card = cards.find((c) => c.id === cardId);
  if (!card) return;
  if (playerProgress.matchedPairIds.includes(card.pairId) || playerProgress.openCardIds.includes(cardId)) return;
  playerProgress.openCardIds = [...(playerProgress.openCardIds || []), cardId].slice(-2);
  if (playerProgress.openCardIds.length === 2) {
    const [first, second] = playerProgress.openCardIds.map((id) => cards.find((c) => c.id === id));
    if (first && second && first.pairId === second.pairId) {
      playerProgress.matchedPairIds = [...new Set([...(playerProgress.matchedPairIds || []), first.pairId])];
      updateMiniGameScore(playerProgress, 120);
      playerProgress.openCardIds = [];
      if (playerProgress.matchedPairIds.length >= 4) {
        playerProgress.done = true;
      }
    } else {
      playerProgress.openCardIds = [];
    }
  }
}

function handleSortOrderAction(player, { itemId, direction }) {
  const items = gameState.activeMiniGame?.data?.items || [];
  const correctOrder = gameState.activeMiniGame?.data?.correctOrder || [];
  if (!items.length || !correctOrder.length) return;
  const playerProgress = ensureMiniGameProgress(player.id);
  if (!playerProgress || playerProgress.done) return;
  const order = [...(playerProgress.order || items.map((i) => i.id))];
  const index = order.findIndex((id) => id === itemId);
  if (index === -1) return;
  if (direction === 'up' && index > 0) {
    [order[index - 1], order[index]] = [order[index], order[index - 1]];
  } else if (direction === 'down' && index < order.length - 1) {
    [order[index + 1], order[index]] = [order[index], order[index + 1]];
  }
  playerProgress.order = order;
  const correctPositions = order.filter((id, idx) => id === correctOrder[idx]).length;
  updateMiniGameScore(playerProgress, 80 * correctPositions - (playerProgress.score || 0));
  if (order.join(',') === correctOrder.join(',')) {
    playerProgress.done = true;
    updateMiniGameScore(playerProgress, MINI_GAME_SCORE_CAP);
  }
}

function handleCategorySnapAction(player, { categoryId }) {
  const prompts = gameState.activeMiniGame?.data?.prompts || [];
  if (!prompts.length) return;
  const playerProgress = ensureMiniGameProgress(player.id);
  if (!playerProgress || playerProgress.done) return;
  const prompt = prompts[playerProgress.promptIndex] || prompts[prompts.length - 1];
  if (!prompt) return;
  if (categoryId === prompt.correctCategoryId) {
    playerProgress.hits = (playerProgress.hits || 0) + 1;
    updateMiniGameScore(playerProgress, 90);
  } else {
    playerProgress.misses = (playerProgress.misses || 0) + 1;
  }
  playerProgress.promptIndex += 1;
  if (playerProgress.promptIndex >= prompts.length) {
    playerProgress.done = true;
  }
}

function handleOddOneOutAction(player, { itemId }) {
  const rounds = gameState.activeMiniGame?.data?.rounds || [];
  if (!rounds.length) return;
  const playerProgress = ensureMiniGameProgress(player.id);
  if (!playerProgress || playerProgress.done) return;
  const round = rounds[playerProgress.roundIndex] || rounds[rounds.length - 1];
  if (!round) return;
  if (itemId === round.correctId) {
    playerProgress.hits = (playerProgress.hits || 0) + 1;
    updateMiniGameScore(playerProgress, 90);
  }
  playerProgress.roundIndex += 1;
  if (playerProgress.roundIndex >= rounds.length) {
    playerProgress.done = true;
  }
}

function handleMiniGameAction(player, payload = {}) {
  if (!player || gameState.phase !== 'mini_game' || !gameState.activeMiniGame || !gameState.miniGameState) return;
  if (!isPlayerEligible(player.id)) return;
  const { type } = gameState.activeMiniGame;
  if (!MINI_GAME_ALLOWED.includes(type)) return;
  if (!payload || payload.type !== type) return;
  if (type === 'MATCH_PAIRS') {
    handleMatchPairsAction(player, payload);
  } else if (type === 'SORT_ORDER') {
    handleSortOrderAction(player, payload);
  } else if (type === 'CATEGORY_SNAP') {
    handleCategorySnapAction(player, payload);
  } else if (type === 'ODD_ONE_OUT') {
    handleOddOneOutAction(player, payload);
  }
  broadcastState();
  concludeMiniGameIfFinished();
}

function buildControllerUrl() {
  if (process.env.PUBLIC_CONTROLLER_URL) {
    return process.env.PUBLIC_CONTROLLER_URL;
  }
  if (process.env.PUBLIC_HOST) {
    const protocol = process.env.PUBLIC_PROTOCOL || 'http';
    const port = process.env.PUBLIC_PORT ? `:${process.env.PUBLIC_PORT}` : '';
    return `${protocol}://${process.env.PUBLIC_HOST}${port}/controller`;
  }
  return null;
}

function buildStatePayload() {
  return {
    phase: gameState.phase,
    phaseStartedAt: gameState.phaseStartedAt,
    phaseEndsAt: gameState.phaseEndsAt,
    narration: gameState.narration,
    activeCategoryId: gameState.activeCategoryId,
    categories: gameState.categories,
    categoryOptions: gameState.categoryOptions,
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
      eventLock: p.eventLock,
      statusEffects: p.statusEffects,
      preparedForQuestion: p.preparedForQuestion,
      status: p.status || 'active',
      lastSeenAt: p.lastSeenAt,
      lastAnswer: gameState.answers[p.id] || null,
    })),
    preferredHost,
    currentQuestion: sanitizeQuestion(gameState.currentQuestion, gameState.phase),
    questionStartTime: gameState.questionStartTime,
    answerStats: gameState.phase === 'answer_reveal' || gameState.phase === 'score' ? gameState.answerStats : {},
    leaderboard: gameState.leaderboard,
    usedQuestionCount: gameState.usedQuestionIds.size,
    totalQuestions: (gameState.questions || []).length,
    roundNumber: gameState.roundNumber,
    maxRounds: gameState.maxRounds,
    activeEvent: gameState.activeEvent,
    randomEventChance: RANDOM_EVENT_CHANCE,
    allCorrectBonusActive: gameState.allCorrectBonusActive,
    categoryVotes: gameState.categoryVotes,
    preQuestionReady: gameState.preQuestionReady,
    categoryVoteStats: gameState.phase === 'category_select' ? {} : computeCategoryVoteStats(),
    activeMiniGame: gameState.activeMiniGame,
    miniGameState: gameState.miniGameState,
    miniGamesPlayed: gameState.miniGamesPlayed,
    miniGameSchedule: gameState.miniGameSchedule,
    recentImpact: gameState.recentImpact,
    controllerUrl: buildControllerUrl(),
    maxPlayers: MAX_PLAYERS,
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
      const basePoints = Math.round(BASE_POINTS * multiplier);
      const doublePoints = player.statusEffects?.doublePoints ? 2 : 1;
      let points = Math.round(basePoints * doublePoints);
      let speedBonusAwarded = false;
      if (player.statusEffects?.speedBonusReady && answer.answerTimeMs <= SPEED_BONUS_WINDOW_MS) {
        points += SPEED_BONUS_POINTS;
        speedBonusAwarded = true;
      }
      player.score += points;
      answer.pointsEarned = points;
      if (speedBonusAwarded && player.socketId) {
        io.to(player.socketId).emit('ability:speedBonusAwarded', { bonusPoints: SPEED_BONUS_POINTS });
      }
    } else if (WRONG_PENALTY) {
      player.score += WRONG_PENALTY;
    }
    if (player.statusEffects?.speedBonusReady) {
      player.statusEffects.speedBonusReady = false;
    }
  }

  const players = Array.from(gameState.players.values());
  const everyoneAnswered =
    players.length > 0 &&
    players.every((p) => {
      const answer = gameState.answers[p.id];
      return answer && answer.optionId === question.correctOptionId;
    });
  if (everyoneAnswered && gameState.allCorrectBonusActive) {
    for (const player of players) {
      player.score += ALL_CORRECT_BONUS_POINTS;
      const record = gameState.answers[player.id];
      if (record) {
        record.pointsEarned = (record.pointsEarned || 0) + ALL_CORRECT_BONUS_POINTS;
      }
    }
  }

  computeLeaderboard();
  setPhase('answer_reveal', ANSWER_REVEAL_DURATION_MS);
}

function maybeEndGame() {
  const noQuestionsLeft = gameState.usedQuestionIds.size >= (gameState.questions || []).length;
  const reachedMaxRounds = gameState.roundNumber >= gameState.maxRounds;
  if (noQuestionsLeft || reachedMaxRounds) {
    clearPlayerEventLocks();
    gameState.miniGameState = null;
    gameState.recentImpact = null;
    setPhase('game_end');
    return true;
  }
  return false;
}

function handleAbilityUse(player, { abilityId, targetPlayerId }) {
  if (!abilityId || !player || gameState.phase !== 'ability_phase') return;
  if (player.status !== 'active' || !isPlayerEligible(player.id)) return;
  if (!player.socketId) return;
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
    if (!target || target.status !== 'active') return;
    if (applyShieldIfPresent(target)) return;
    decrementUse();
    const question = gameState.currentQuestion;
    if (!question) return;
    const shuffledOptions = [...question.options].sort(() => Math.random() - 0.5).map((o) => o.id);
    if (target.socketId) {
      io.to(target.socketId).emit('ability:shuffleOptions', { order: shuffledOptions, from: player.nickname });
    }
    gameState.recentImpact = { from: player.id, target: targetPlayerId, effect: 'shuffle_enemy', at: Date.now(), kind: 'ability' };
  }

  if (abilityId === 'freeze_enemy' && targetPlayerId) {
    const target = gameState.players.get(targetPlayerId);
    if (!target || target.status !== 'active') return;
    if (applyShieldIfPresent(target)) return;
    decrementUse();
    target.frozenUntil = Date.now() + FREEZE_DURATION_MS;
    if (target.socketId) {
      io.to(target.socketId).emit('ability:freeze', { durationMs: FREEZE_DURATION_MS, from: player.nickname });
    }
    gameState.recentImpact = { from: player.id, target: targetPlayerId, effect: 'freeze_enemy', at: Date.now(), kind: 'ability' };
  }

  if (abilityId === 'hint_percent') {
    decrementUse();
    player.statusEffects = { ...(player.statusEffects || {}), hintPercentActive: true };
    emitHintPercentToPlayer(player);
    gameState.recentImpact = { from: player.id, target: player.id, effect: 'hint_percent', at: Date.now(), kind: 'ability' };
  }

  if (abilityId === 'speed_bonus') {
    decrementUse();
    player.statusEffects = { ...(player.statusEffects || {}), speedBonusReady: true };
    if (player.socketId) {
      io.to(player.socketId).emit('ability:speedBonusReady', { windowMs: SPEED_BONUS_WINDOW_MS, bonusPoints: SPEED_BONUS_POINTS });
    }
    gameState.recentImpact = { from: player.id, target: player.id, effect: 'speed_bonus', at: Date.now(), kind: 'ability' };
  }

  broadcastState();
}

function applyShieldIfPresent(target) {
  if (target.statusEffects?.eventShield) {
    target.statusEffects.eventShield = false;
    if (target.socketId) {
      io.to(target.socketId).emit('event:shielded');
    }
    return true;
  }
  const remainingShield = target.abilityUses?.shield ?? 0;
  const hasShield = target.characterId === 'shieldy' && remainingShield > 0 && !target.shieldConsumed;
  if (!hasShield) return false;
  target.abilityUses.shield = remainingShield - 1;
  target.shieldConsumed = true;
  if (target.socketId) {
    io.to(target.socketId).emit('ability:shieldTriggered');
  }
  return true;
}

function notifyMissedRound(player, socket) {
  if (!player) return;
  if (gameState.phase === 'question' && !isPlayerEligible(player.id)) {
    const targetSocketId = socket?.id || player.socketId;
    if (targetSocketId) {
      io.to(targetSocketId).emit('server:you_missed_round', { roundIndex: gameState.roundNumber });
    }
  }
}

io.on('connection', (socket) => {
  console.log('Client connected', socket.id);

  socket.on('player:join', ({ nickname, characterId }, callback) => {
    if (!nickname) {
      callback?.({ ok: false, error: 'Nickname required' });
      return;
    }
    if (gameState.players.size >= MAX_PLAYERS) {
      callback?.({ ok: false, error: 'Лобби заполнено' });
      return;
    }
    const exists = Array.from(gameState.players.values()).some(
      (p) => p.nickname.toLowerCase() === nickname.toLowerCase()
    );
    if (exists) {
      callback?.({ ok: false, error: 'Такой игрок уже есть' });
      return;
    }
    const playerId = randomUUID();
    const resumeToken = generateResumeToken();
    const player = {
      id: playerId,
      socketId: socket.id,
      nickname,
      characterId,
      score: 0,
      ready: false,
      abilityUses: getAbilityUses(characterId),
      shieldConsumed: false,
      frozenUntil: 0,
      eventLock: null,
      preparedForQuestion: false,
      statusEffects: { doublePoints: false, eventShield: false, hintPercentActive: false, speedBonusReady: false },
      status: 'active',
      resumeToken,
      lastSeenAt: Date.now(),
    };
    socketToPlayerId.set(socket.id, playerId);
    gameState.players.set(playerId, player);
    broadcastState();
    syncLobbyState();
    callback?.({ ok: true, playerId, resumeToken });
  });

  socket.on('player:resume', ({ playerId, resumeToken }, callback) => {
    const player = playerId ? gameState.players.get(playerId) : null;
    if (!player || !resumeToken || player.resumeToken !== resumeToken) {
      callback?.({ ok: false });
      socket.emit('server:resume_failed');
      return;
    }
    if (player.socketId && player.socketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(player.socketId);
      oldSocket?.disconnect(true);
    }
    attachSocketToPlayer(player, socket);
    callback?.({ ok: true, playerId });
    socket.emit('server:resume_ok', { playerId });
    socket.emit('server:state', buildStatePayload());
    broadcastState();
    notifyMissedRound(player, socket);
  });

  socket.on('player:voteCategory', ({ categoryId }) => {
    if (gameState.phase !== 'category_select') return;
    if (!gameState.categoryOptions.find((c) => c.id === categoryId)) return;
    const player = getPlayerBySocket(socket);
    if (!player || player.status !== 'active' || !isPlayerEligible(player.id)) return;
    gameState.categoryVotes[player.id] = categoryId;
    broadcastState();
    startRoundFromVotes(true);
  });

  socket.on('player:startGame', () => {
    if (gameState.phase !== 'game_start_confirm') return;
    if (!hasEnoughReadyPlayers()) return;
    beginRound();
  });

  socket.on('player:ready', (isReady) => {
    const player = getPlayerBySocket(socket);
    if (!player || player.status !== 'active') return;
    player.ready = Boolean(isReady);
    broadcastState();
    syncLobbyState();
  });

  socket.on('player:answer', ({ optionId }) => {
    const player = getPlayerBySocket(socket);
    if (!player || player.status !== 'active' || gameState.phase !== 'question' || !gameState.currentQuestion) return;
    if (!isPlayerEligible(player.id)) {
      notifyMissedRound(player, socket);
      return;
    }
    const now = Date.now();
    if (player.frozenUntil && now < player.frozenUntil) {
      io.to(socket.id).emit('player:blocked', { reason: 'frozen' });
      return;
    }
    if (player.eventLock && !player.eventLock.cleared) {
      io.to(socket.id).emit('player:blocked', { reason: player.eventLock.type });
      return;
    }
    if (gameState.answers[player.id]) return;
    const answerTimeMs = now - gameState.questionStartTime;
    gameState.answers[player.id] = { optionId, answerTimeMs };
    gameState.answerStats[optionId] = (gameState.answerStats[optionId] || 0) + 1;
    emitHintPercentToSubscribers();
    if (haveAllPlayersAnswered()) {
      revealQuestion();
    } else {
      broadcastState();
    }
  });

  socket.on('player:clearEventLock', () => {
    const player = getPlayerBySocket(socket);
    if (!player || player.status !== 'active' || !player.eventLock) return;
    player.eventLock = null;
    io.to(socket.id).emit('event:lockCleared');
    broadcastState();
  });

  socket.on('player:confirmPreQuestion', () => {
    if (gameState.phase !== 'ability_phase') return;
    const player = getPlayerBySocket(socket);
    if (!player || player.status !== 'active' || !isPlayerEligible(player.id)) return;
    markPlayerPrepared(player.id);
  });

  socket.on('player:useAbility', (payload) => {
    const player = getPlayerBySocket(socket);
    if (!player || player.status !== 'active' || gameState.phase !== 'ability_phase') return;
    if (!isPlayerEligible(player.id)) return;
    handleAbilityUse(player, payload || {});
  });

  socket.on('player:continueNextRound', () => {
    if (gameState.phase !== 'next_round_confirm') return;
    const player = getPlayerBySocket(socket);
    if (!player || player.status !== 'active') return;
    beginRound();
  });

  socket.on('player:miniGameAction', (payload) => {
    const player = getPlayerBySocket(socket);
    if (!player || player.status !== 'active') return;
    handleMiniGameAction(player, payload || {});
  });

  socket.on('disconnect', () => {
    const player = getPlayerBySocket(socket);
    socketToPlayerId.delete(socket.id);
    if (!player) return;
    markPlayerInactive(player);
    broadcastState();
    syncLobbyState();
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
