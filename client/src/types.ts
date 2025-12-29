export type GamePhase =
  | 'lobby'
  | 'ready'
  | 'game_start_confirm'
  | 'round_intro'
  | 'category_select'
  | 'category_reveal'
  | 'random_event'
  | 'ability_phase'
  | 'question'
  | 'answer_reveal'
  | 'score'
  | 'intermission'
  | 'mini_game'
  | 'next_round_confirm'
  | 'game_end';

export interface Category {
  id: string;
  title: string;
  icon?: string;
  color?: string;
  art?: string;
  accent?: string;
  difficulty?: number;
}

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  categoryId: string;
  text: string;
  options: QuestionOption[];
  correctOptionId?: string;
  explanation?: string;
  difficulty?: number;
  timeLimitSec?: number;
}

export interface Ability {
  id: string;
  name: string;
  description: string;
  usesPerGame: number;
}

export interface Character {
  id: string;
  name: string;
  ability?: Ability;
  icon?: string;
  art?: string;
  accent?: string;
}

export interface AnswerRecord {
  optionId: string;
  answerTimeMs: number;
  pointsEarned?: number;
}

export interface PlayerState {
  id: string;
  nickname: string;
  characterId?: string;
  score: number;
  ready: boolean;
  abilityUses?: Record<string, number>;
  shieldConsumed?: boolean;
  frozenUntil?: number;
  eventLock?: { type: string; cleared?: boolean } | null;
  statusEffects?: { doublePoints?: boolean; eventShield?: boolean; hintPercentActive?: boolean; speedBonusReady?: boolean };
  preparedForQuestion?: boolean;
  status: 'active' | 'inactive' | 'offline';
  lastSeenAt?: number;
  lastAnswer?: AnswerRecord | null;
}

export interface ActiveEvent {
  id: string;
  title: string;
  kind: 'buff' | 'malus';
  effect: string;
  targetPlayerId?: string | null;
  requiresAction?: boolean;
  description?: string;
}

export type MiniGameType = 'MATCH_PAIRS' | 'SORT_ORDER' | 'CATEGORY_SNAP' | 'ODD_ONE_OUT';

export interface MatchPairsCard {
  id: string;
  pairId: string;
  icon: string;
}

export interface SortOrderItem {
  id: string;
  label: string;
}

export interface CategorySnapPrompt {
  id: string;
  label: string;
  correctCategoryId: string;
}

export interface CategorySnapCategory {
  id: string;
  label: string;
  icon?: string;
}

export interface OddOneOutRoundItem {
  id: string;
  label: string;
}

export interface OddOneOutRound {
  id?: string;
  items: OddOneOutRoundItem[];
  correctId: string;
}

export interface MiniGamePayload {
  type: MiniGameType;
  durationMs: number;
  data: {
    cards?: MatchPairsCard[];
    items?: SortOrderItem[];
    correctOrder?: string[];
    categories?: CategorySnapCategory[];
    prompts?: CategorySnapPrompt[];
    rounds?: OddOneOutRound[];
  };
}

export interface BaseMiniGameProgress {
  score: number;
  done: boolean;
}

export interface MatchPairsProgress extends BaseMiniGameProgress {
  openCardIds: string[];
  matchedPairIds: string[];
}

export interface SortOrderProgress extends BaseMiniGameProgress {
  order: string[];
}

export interface CategorySnapProgress extends BaseMiniGameProgress {
  promptIndex: number;
  hits: number;
  misses: number;
}

export interface OddOneOutProgress extends BaseMiniGameProgress {
  roundIndex: number;
  hits: number;
}

export type MiniGameProgress = MatchPairsProgress | SortOrderProgress | CategorySnapProgress | OddOneOutProgress;

export interface MiniGameResult {
  playerId: string;
  score: number;
  done?: boolean;
}

export interface MiniGameState {
  startedAt: number | null;
  endsAt: number | null;
  progress: Record<string, MiniGameProgress | undefined>;
  results?: MiniGameResult[];
  finished?: boolean;
}

export interface GameState {
  phase: GamePhase;
  phaseStartedAt: number | null;
  phaseEndsAt: number | null;
  narration?: string;
  activeCategoryId: string | null;
  categories: Category[];
  categoryOptions: Category[];
  characters: Character[];
  players: PlayerState[];
  preferredHost?: string | null;
  currentQuestion: Question | null;
  questionStartTime: number | null;
  answerStats: Record<string, number>;
  leaderboard: { id: string; nickname: string; score: number; characterId?: string }[];
  usedQuestionCount: number;
  totalQuestions: number;
  roundNumber: number;
  maxRounds: number;
  activeEvent: ActiveEvent | null;
  randomEventChance?: number;
  allCorrectBonusActive?: boolean;
  categoryVotes?: Record<string, string | undefined>;
  preQuestionReady?: Record<string, boolean>;
  categoryVoteStats?: Record<string, number>;
  activeMiniGame?: MiniGamePayload | null;
  miniGameState?: MiniGameState | null;
  miniGamesPlayed?: MiniGameType[];
  miniGameSchedule?: number[];
  recentImpact?: { from?: string | null; target?: string | null; effect?: string; at: number; kind: 'ability' | 'event' } | null;
  controllerUrl?: string | null;
  maxPlayers?: number;
}
