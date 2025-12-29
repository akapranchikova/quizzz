import { useEffect, useRef, useState } from 'react';
import { GamePhase, GameState } from '../types';

function computeDelay(previous: GamePhase | null, next: GamePhase) {
  const base = 280;
  if (!previous) return 0;
  if (previous === 'category_reveal' && next !== previous) return 620;
  if (previous === 'answer_reveal' && next === 'score') return 520;
  if (previous === 'score' && next !== 'score') return 780;
  return base;
}

export function usePacedState(state: GameState | null) {
  const [visualPhase, setVisualPhase] = useState<GamePhase | null>(state?.phase ?? null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const nextPhase = state?.phase ?? null;
    if (!nextPhase) return;
    if (nextPhase === visualPhase) return;
    const delay = computeDelay(visualPhase, nextPhase);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setVisualPhase(nextPhase);
      timerRef.current = null;
    }, delay);
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [state?.phase, visualPhase]);

  useEffect(() => () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
  }, []);

  const pacedState = state ? { ...state, phase: visualPhase || state.phase } : null;
  return pacedState;
}
