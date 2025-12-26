export type GamePhase = 'lobby' | 'category_pick' | 'question' | 'reveal' | 'round_end' | 'game_end';

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
  lastAnswer?: AnswerRecord | null;
}

export interface GameState {
  phase: GamePhase;
  categories: Category[];
  characters: Character[];
  players: PlayerState[];
  currentQuestion: Question | null;
  questionStartTime: number | null;
  answerStats: Record<string, number>;
  leaderboard: { id: string; nickname: string; score: number; characterId?: string }[];
  usedQuestionCount: number;
  totalQuestions: number;
}
