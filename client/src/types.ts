export type GamePhase =
  | 'lobby'
  | 'ready'
  | 'game_start_confirm'
  | 'category_select'
  | 'category_reveal'
  | 'pre_question'
  | 'question'
  | 'answer_reveal'
  | 'score'
  | 'next_round_confirm'
  | 'game_end';

export interface Category {
  id: string;
  title: string;
  icon?: string;
  color?: string;
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
  statusEffects?: { doublePoints?: boolean; eventShield?: boolean };
  preparedForQuestion?: boolean;
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
}
