import { useEffect, useRef } from 'react';
import { GamePhase, GameState } from '../types';

type PhaseChangeHandler = (next: GamePhase, prev: GamePhase | null) => void;
type LastSecondsHandler = (remainingSeconds: number, phase: GamePhase) => void;

interface Options {
  onPhaseChange?: PhaseChangeHandler;
  onLastSeconds?: LastSecondsHandler;
}

export function usePhaseEffects(state: GameState | null, { onPhaseChange, onLastSeconds }: Options) {
  const prevPhaseRef = useRef<GamePhase | null>(null);
  const lastTickRef = useRef<number | null>(null);

  useEffect(() => {
    const nextPhase = state?.phase ?? null;
    const prevPhase = prevPhaseRef.current;
    if (nextPhase && nextPhase !== prevPhase) {
      onPhaseChange?.(nextPhase, prevPhase);
      prevPhaseRef.current = nextPhase;
      lastTickRef.current = null;
    }
  }, [onPhaseChange, state?.phase]);

  useEffect(() => {
    if (!state || !onLastSeconds) return;
    const { phase } = state;
    const computeEnds = () => {
      if (phase === 'question') {
        const limit = (state.currentQuestion?.timeLimitSec || 15) * 1000;
        if (!state.questionStartTime) return null;
        return { startsAt: state.questionStartTime, endsAt: state.questionStartTime + limit };
      }
      if (phase === 'category_select' && state.phaseStartedAt && state.phaseEndsAt) {
        return { startsAt: state.phaseStartedAt, endsAt: state.phaseEndsAt };
      }
      return null;
    };

    const range = computeEnds();
    if (!range) return;

    const check = () => {
      const remainingMs = range.endsAt - Date.now();
      const remainingSec = Math.ceil(remainingMs / 1000);
      if (remainingSec <= 3 && remainingSec > 0 && lastTickRef.current !== remainingSec) {
        lastTickRef.current = remainingSec;
        onLastSeconds(remainingSec, phase);
      }
    };

    const id = window.setInterval(check, 200);
    check();
    return () => clearInterval(id);
  }, [
    onLastSeconds,
    state?.phase,
    state?.phaseEndsAt,
    state?.phaseStartedAt,
    state?.questionStartTime,
    state?.currentQuestion?.id,
  ]);
}
