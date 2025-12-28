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
const INTERMISSION_DURATION_MS = 6000;
const MINI_GAME_DURATION_MS = 9000;
const NEXT_ROUND_CONFIRM_DURATION_MS = 8000;
const ALL_CORRECT_BONUS_POINTS = 350;
const RESUME_GRACE_PERIOD_MS = 45000;

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
  miniGamePool: [],
  activeMiniGame: null,
  miniGamesPlayed: [],
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

const MINI_GAMES = [
  {
    id: 'match_pairs',
    title: 'MATCH PAIRS',
    description: 'Собери пары логически связанных карточек',
    scoring: '+300 за пару, +500 первому, кто закончит',
  },
  {
    id: 'sort_order',
    title: 'SORT ORDER',
    description: 'Расставьте элементы в правильном порядке',
    scoring: 'Идеально: +800, одна ошибка: +400',
  },
  {
    id: 'find_the_odd',
    title: 'FIND THE ODD',
    description: 'Найдите элемент, который не подходит',
    scoring: 'Верно: +500, иначе 0',
  },
  {
    id: 'sort_to_zones',
    title: 'SORT TO ZONES',
    description: 'Разложите карточки по 2–3 зонам',
    scoring: '+200 за верный элемент, +400 за идеал',
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
const phasesWithEligiblePlayers = new Set(['category_select', 'ability_phase', 'question']);

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

function cleanupPlayerState(playerId) {
  delete gameState.categoryVotes[playerId];
  delete gameState.preQuestionReady[playerId];
  delete gameState.answers[playerId];
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

async function loadData() {
  const questionsData = await loadJsonFile(QUESTIONS_PATH, { categories: [], questions: [] });
  const charactersData = await loadJsonFile(CHARACTERS_PATH, { characters: [] });
  gameState.categories = questionsData.categories || [];
  gameState.questions = questionsData.questions || [];
  gameState.categoryOptions = chooseCategoryOptions();
  gameState.characters = charactersData.characters || [];
  gameState.miniGamePool = MINI_GAMES.slice();
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
  gameState.miniGamePool = MINI_GAMES.slice();
  gameState.activeMiniGame = null;
  gameState.miniGamesPlayed = [];
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
      player.statusEffects = { doublePoints: false, eventShield: false };
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
    lobby: 'Подключение игроков',
    ready: 'Нажмите «Готов» на своих устройствах',
    game_start_confirm: 'Все готовы. Любой игрок может начать игру',
    round_intro: `Раунд ${displayRound} начинается`,
    category_select: `Раунд ${displayRound} из ${gameState.maxRounds}: выбираем категорию`,
    category_reveal: 'Категория выбрана',
    random_event: 'Случайное событие',
    ability_phase: 'Подготовка перед вопросом',
    question: 'Вопрос: отвечайте как можно быстрее',
    answer_reveal: 'Показ правильного ответа',
    score: 'Очки летят к игрокам',
    intermission: 'Перерыв: мини-игра на подходе',
    mini_game: gameState.activeMiniGame ? `Мини-игра: ${gameState.activeMiniGame.title}` : 'Мини-игра',
    next_round_confirm: 'Подтвердите следующий раунд',
    game_end: 'Игра завершена',
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
  gameState.miniGamePool = MINI_GAMES.slice();
  gameState.miniGamesPlayed = [];
  gameState.activeMiniGame = null;
  gameState.categoryOptions = chooseCategoryOptions();
  gameState.phaseEligiblePlayerIds = null;
  for (const player of gameState.players.values()) {
    player.score = 0;
    player.shieldConsumed = false;
    player.abilityUses = getAbilityUses(player.characterId);
    player.eventLock = null;
    player.preparedForQuestion = false;
    player.statusEffects = { doublePoints: false, eventShield: false };
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
  for (const player of gameState.players.values()) {
    player.eventLock = null;
    player.preparedForQuestion = false;
    player.statusEffects = { doublePoints: false, eventShield: false };
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
    if (player.eventLock) {
      player.eventLock = null;
    }
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
  return (completedQuestions === 3 || completedQuestions === 6) && gameState.miniGamePool.length > 0;
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
  setPhase('next_round_confirm', NEXT_ROUND_CONFIRM_DURATION_MS);
}

function pickMiniGame() {
  if (!gameState.miniGamePool.length) return null;
  const shuffled = [...gameState.miniGamePool].sort(() => Math.random() - 0.5);
  return shuffled[0];
}

function startMiniGame() {
  if (!shouldEnterIntermission() || !gameState.miniGamePool.length) {
    startNextRoundConfirm();
    return;
  }
  const miniGame = pickMiniGame();
  if (!miniGame) {
    startNextRoundConfirm();
    return;
  }
  gameState.activeMiniGame = miniGame;
  gameState.miniGamesPlayed = [...(gameState.miniGamesPlayed || []), miniGame.id];
  gameState.miniGamePool = gameState.miniGamePool.filter((m) => m.id !== miniGame.id);
  setPhase('mini_game', MINI_GAME_DURATION_MS, () => {
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
  if (payload.effect === 'all_correct_bonus') {
    gameState.allCorrectBonusActive = true;
    broadcastState();
    return;
  }
  const targets =
    payload.targetMode === 'all'
      ? getActivePlayers()
      : [gameState.players.get(payload.targetPlayerId)].filter((p) => p && p.status === 'active');
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
  }
  broadcastState();
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
    miniGamesRemaining: gameState.miniGamePool.map((m) => ({ id: m.id, title: m.title })),
    miniGamesPlayed: gameState.miniGamesPlayed,
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
      const points = Math.round(basePoints * doublePoints);
      player.score += points;
      answer.pointsEarned = points;
    } else if (WRONG_PENALTY) {
      player.score += WRONG_PENALTY;
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
      statusEffects: { doublePoints: false, eventShield: false },
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
    if (!readyCountMeetsMinimum()) return;
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
    if (haveAllPlayersAnswered()) {
      revealQuestion();
    } else {
      broadcastState();
    }
  });

  socket.on('player:clearEventLock', () => {
    const player = getPlayerBySocket(socket);
    if (!player || player.status !== 'active' || !player.eventLock) return;
    player.eventLock.cleared = true;
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
