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
const MIN_PLAYERS_TO_START = Number(process.env.MIN_PLAYERS_TO_START || 2);
const MAX_ROUNDS = Number(process.env.MAX_ROUNDS || 12);
const READY_CHECK_DURATION_MS = 4000;
const ROUND_INTRO_DURATION_MS = 3500;
const CATEGORY_PICK_DURATION_MS = 15000;
const CATEGORY_REVEAL_DURATION_MS = 4000;
const RANDOM_EVENT_DURATION_MS = 3500;
const RANDOM_EVENT_CHANCE = 0.4;
const ABILITY_DURATION_MS = 7000;
const QUESTION_DURATION_FALLBACK_MS = 15000;
const ANSWER_REVEAL_DURATION_MS = 5500;
const SCORE_DURATION_MS = 4500;
const INTERMISSION_DURATION_MS = 6000;
const ALL_CORRECT_BONUS_POINTS = 350;

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
  leaderboard: [],
  categoryVotes: {},
  roundNumber: 0,
  maxRounds: MAX_ROUNDS,
  activeEvent: null,
  allCorrectBonusActive: false,
  recentCategoryIds: [],
};

let phaseTimer = null;
let revealTimer = null;

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
  for (const player of gameState.players.values()) {
    player.abilityUses = getAbilityUses(player.characterId);
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
  gameState.leaderboard = [];
  gameState.categoryVotes = {};
  gameState.roundNumber = 0;
  gameState.activeEvent = null;
  gameState.allCorrectBonusActive = false;
  gameState.recentCategoryIds = [];
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
    ready_check: 'Нажмите «Готов» на своих устройствах',
    round_intro: `Раунд ${displayRound} из ${gameState.maxRounds}. Приготовьтесь!`,
    category_select: 'Выберите категорию на контроллерах',
    category_reveal: 'Категория выбрана',
    random_event: 'Случайное событие — смотрим на экран!',
    ability: 'Окно способностей',
    question: 'Вопрос: отвечайте как можно быстрее',
    answer_reveal: 'Показ правильного ответа',
    score: 'Анимация очков',
    intermission: 'Небольшая пауза перед следующим вопросом',
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
  if (expectedPhase === 'ready_check') {
    startRoundIntro();
    return;
  }
  if (expectedPhase === 'round_intro') {
    startCategorySelect();
    return;
  }
  if (expectedPhase === 'category_select') {
    if (!resolveCategory()) {
      startCategorySelect();
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
  if (expectedPhase === 'ability') {
    startQuestion(gameState.nextQuestion);
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
    startIntermission();
    return;
  }
  if (expectedPhase === 'intermission') {
    startRoundIntro();
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
  const players = Array.from(gameState.players.keys());
  return players.length > 0 && players.every((id) => Boolean(gameState.categoryVotes?.[id]));
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

function startRoundIntro() {
  if (maybeEndGame()) return;
  gameState.roundNumber += 1;
  gameState.activeCategoryId = null;
  gameState.categoryVotes = {};
  gameState.answers = {};
  gameState.answerStats = {};
  gameState.currentQuestion = null;
  gameState.nextQuestion = null;
  gameState.questionStartTime = null;
  gameState.activeEvent = null;
  gameState.allCorrectBonusActive = false;
  gameState.categoryOptions = chooseCategoryOptions();
  for (const player of gameState.players.values()) {
    player.eventLock = null;
    player.statusEffects = { doublePoints: false, eventShield: false };
  }
  setPhase('round_intro', ROUND_INTRO_DURATION_MS);
}

function startCategorySelect() {
  if (!gameState.categoryOptions?.length) {
    gameState.categoryOptions = chooseCategoryOptions();
  }
  gameState.categoryVotes = {};
  setPhase('category_select', CATEGORY_PICK_DURATION_MS);
}

function startAbilityPhase() {
  const question = gameState.nextQuestion || (gameState.activeCategoryId ? selectQuestion(gameState.activeCategoryId) : null);
  if (!question) {
    startIntermission();
    return;
  }
  gameState.currentQuestion = question;
  gameState.questionStartTime = null;
  gameState.answers = {};
  gameState.answerStats = {};
  setPhase('ability', ABILITY_DURATION_MS);
}

function beginGame() {
  clearRevealTimer();
  clearPhaseTimer();
  gameState.usedQuestionIds = new Set();
  gameState.leaderboard = [];
  gameState.currentQuestion = null;
  gameState.nextQuestion = null;
  gameState.questionStartTime = null;
  gameState.answers = {};
  gameState.answerStats = {};
  gameState.categoryVotes = {};
  gameState.activeCategoryId = null;
  gameState.roundNumber = 0;
  gameState.activeEvent = null;
  gameState.recentCategoryIds = [];
  for (const player of gameState.players.values()) {
    player.score = 0;
    player.shieldConsumed = false;
    player.abilityUses = getAbilityUses(player.characterId);
    player.eventLock = null;
    player.statusEffects = { doublePoints: false, eventShield: false };
  }
  setPhase('ready_check', READY_CHECK_DURATION_MS);
}

function maybeStartReadySequence() {
  const players = Array.from(gameState.players.values());
  const minPlayersMet = players.length >= MIN_PLAYERS_TO_START;
  const everyoneReady = minPlayersMet && players.every((p) => p.ready);
  if (everyoneReady && (gameState.phase === 'lobby' || gameState.phase === 'game_end')) {
    beginGame();
  } else if (!everyoneReady && gameState.phase === 'ready_check') {
    setPhase('lobby');
  }
}

function startQuestion(question) {
  clearRevealTimer();
  if (!question) {
    startIntermission();
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

function startIntermission() {
  if (maybeEndGame()) return;
  setPhase('intermission', INTERMISSION_DURATION_MS, () => {
    gameState.currentQuestion = null;
    gameState.nextQuestion = null;
    gameState.questionStartTime = null;
    gameState.answers = {};
    gameState.answerStats = {};
    gameState.activeCategoryId = null;
    gameState.categoryVotes = {};
    gameState.activeEvent = null;
    gameState.allCorrectBonusActive = false;
  });
}

function pickEventTargetId() {
  const players = Array.from(gameState.players.values());
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
      ? Array.from(gameState.players.values())
      : [gameState.players.get(payload.targetPlayerId)].filter(Boolean);
  for (const target of targets) {
    if (payload.kind === 'malus' && applyShieldIfPresent(target)) {
      continue;
    }
    if (payload.effect === 'double_points') {
      target.statusEffects = { ...(target.statusEffects || {}), doublePoints: true };
      io.to(target.socketId).emit('event:applied', payload);
    }
    if (payload.effect === 'event_shield') {
      target.statusEffects = { ...(target.statusEffects || {}), eventShield: true };
      io.to(target.socketId).emit('event:applied', payload);
    }
    if (payload.effect === 'ice' || payload.effect === 'mud') {
      target.eventLock = { type: payload.effect, cleared: false };
      io.to(target.socketId).emit('event:applied', { ...payload, requiresAction: true });
    }
    if (payload.effect === 'shuffle') {
      const question = gameState.nextQuestion || gameState.currentQuestion;
      if (!question) continue;
      const order = [...question.options].sort(() => Math.random() - 0.5).map((o) => o.id);
      io.to(target.socketId).emit('event:shuffleOptions', { order, from: 'случайное событие' });
    }
  }
  broadcastState();
}

function startRandomEventPhase() {
  const event = pickRandomEvent();
  if (!event) {
    gameState.activeEvent = null;
    startAbilityPhase();
    return;
  }
  const targetPlayerId = event.targetMode === 'all' ? null : pickEventTargetId();
  const payload = { ...event, targetPlayerId };
  gameState.activeEvent = payload;
  setPhase('random_event', RANDOM_EVENT_DURATION_MS, () => {
    gameState.narration = `Случайное событие: ${event.title}`;
    applyRandomEvent(payload);
  });
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
    categoryVoteStats: gameState.phase === 'category_select' ? {} : computeCategoryVoteStats(),
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
  if (target.statusEffects?.eventShield) {
    target.statusEffects.eventShield = false;
    io.to(target.socketId).emit('event:shielded');
    return true;
  }
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
    const exists = Array.from(gameState.players.values()).some((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (exists) {
      callback?.({ ok: false, error: 'Такой игрок уже есть' });
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
      eventLock: null,
      statusEffects: { doublePoints: false, eventShield: false },
    };
    gameState.players.set(socket.id, player);
    broadcastState();
    maybeStartReadySequence();
    callback?.({ ok: true, playerId: socket.id });
  });

  socket.on('player:voteCategory', ({ categoryId }) => {
    if (gameState.phase !== 'category_select') return;
    if (!gameState.categoryOptions.find((c) => c.id === categoryId)) return;
    const player = gameState.players.get(socket.id);
    if (!player) return;
    gameState.categoryVotes[player.id] = categoryId;
    broadcastState();
    startRoundFromVotes(true);
  });

  socket.on('player:ready', (isReady) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;
    player.ready = Boolean(isReady);
    broadcastState();
    maybeStartReadySequence();
  });

  socket.on('player:answer', ({ optionId }) => {
    const player = gameState.players.get(socket.id);
    if (!player || gameState.phase !== 'question' || !gameState.currentQuestion) return;
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
    broadcastState();
  });

  socket.on('player:clearEventLock', () => {
    const player = gameState.players.get(socket.id);
    if (!player || !player.eventLock) return;
    player.eventLock.cleared = true;
    io.to(socket.id).emit('event:lockCleared');
    broadcastState();
  });

  socket.on('player:useAbility', (payload) => {
    const player = gameState.players.get(socket.id);
    if (!player || (gameState.phase !== 'question' && gameState.phase !== 'ability')) return;
    handleAbilityUse(player, payload || {});
  });

  socket.on('disconnect', () => {
    gameState.players.delete(socket.id);
    delete gameState.categoryVotes[socket.id];
    broadcastState();
    maybeStartReadySequence();
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
