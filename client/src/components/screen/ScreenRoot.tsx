import { useEffect, useMemo, useState } from 'react';
import { Category, GameState } from '../../types';
import { usePhaseEffects } from '../../hooks/usePhaseEffects';
import { isSoundUnlocked, onSoundUnlocked, playSfx, unlockSound } from '../../utils/sound';
import ScreenBackground from './ScreenBackground';
import ScreenEffects from './ScreenEffects';
import ScreenInGame from './ScreenInGame';
import ScreenLobbyEmpty from './ScreenLobbyEmpty';
import ScreenLobbyWaiting from './ScreenLobbyWaiting';
import ScreenReadyCheck from './ScreenReadyCheck';

type ScreenMode = 'lobby_empty' | 'lobby_waiting' | 'ready_check' | 'in_game';

interface Props {
  state: GameState | null;
}

function findActiveCategory(state: GameState | null): Category | null {
  if (!state) return null;
  const pool = state.categoryOptions?.length ? state.categoryOptions : state.categories;
  const byId = Object.fromEntries(pool.map((c) => [c.id, c]));
  if (state.activeCategoryId && byId[state.activeCategoryId]) {
    return byId[state.activeCategoryId];
  }
  if (state.currentQuestion?.categoryId && byId[state.currentQuestion.categoryId]) {
    return byId[state.currentQuestion.categoryId];
  }
  return null;
}

function deriveMode(state: GameState | null): ScreenMode {
  const players = state?.players || [];
  if (!state || state.phase === 'lobby') {
    return players.length === 0 ? 'lobby_empty' : 'lobby_waiting';
  }
  if (state.phase === 'ready' || state.phase === 'game_start_confirm') {
    return 'ready_check';
  }
  return 'in_game';
}

function buildControllerUrl(state: GameState | null) {
  if (state?.controllerUrl) return state.controllerUrl;
  if (typeof window === 'undefined') return '';
  const hostForQr = state?.preferredHost || window.location.hostname;
  return `${window.location.protocol}//${hostForQr}${window.location.port ? `:${window.location.port}` : ''}/controller`;
}

export default function ScreenRoot({ state }: Props) {
  const [featuredCategory, setFeaturedCategory] = useState<Category | null>(null);
  const [categoryKey, setCategoryKey] = useState(0);
  const [questionFlashKey, setQuestionFlashKey] = useState(0);
  const [scoreKey, setScoreKey] = useState(0);
  const [finaleKey, setFinaleKey] = useState(0);
  const [impactKey, setImpactKey] = useState(0);
  const [lastSeconds, setLastSeconds] = useState(false);
  const [soundReady, setSoundReady] = useState(isSoundUnlocked());
  const [soundPromptDismissed, setSoundPromptDismissed] = useState(false);
  const mode = deriveMode(state);
  const controllerUrl = useMemo(() => buildControllerUrl(state), [state]);
  const maxPlayers = state?.maxPlayers ?? 8;
  const players = state?.players || [];
  const activeCategory = useMemo(() => findActiveCategory(state), [state]);
  const accent = featuredCategory?.accent || activeCategory?.accent || '#6366f1';
  const isFinalStretch = (state?.maxRounds || 0) > 0 && (state?.roundNumber || 0) >= (state?.maxRounds || 0) - 1;
  const isFinalQuestion = isFinalStretch && state?.phase === 'question';

  useEffect(() => {
    return onSoundUnlocked(() => setSoundReady(true));
  }, []);

  useEffect(() => {
    if (!featuredCategory) return;
    const timeout = window.setTimeout(() => setFeaturedCategory(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [featuredCategory, categoryKey]);

  useEffect(() => {
    if (!questionFlashKey) return;
    const t = window.setTimeout(() => setQuestionFlashKey(0), 520);
    return () => window.clearTimeout(t);
  }, [questionFlashKey]);

  useEffect(() => {
    if (!scoreKey) return;
    const t = window.setTimeout(() => setScoreKey(0), 2400);
    return () => window.clearTimeout(t);
  }, [scoreKey]);

  useEffect(() => {
    if (!state?.recentImpact) return;
    if (Date.now() - state.recentImpact.at > 2400) return;
    setImpactKey(Date.now());
  }, [state?.recentImpact?.at]);

  const handleUnlock = () => {
    unlockSound();
    setSoundReady(isSoundUnlocked());
    setSoundPromptDismissed(true);
  };

  usePhaseEffects(state, {
    onPhaseChange: (phase, prev) => {
      if (phase === 'category_reveal') {
        const nextCategory = findActiveCategory(state);
        setFeaturedCategory(nextCategory);
        setCategoryKey(Date.now());
        playSfx('reveal', { volume: 0.55 });
      }
      if (phase === 'question') {
        setQuestionFlashKey(Date.now());
        const totalRounds = state?.maxRounds || 0;
        const isFinale = totalRounds > 0 && (state?.roundNumber || 0) >= totalRounds;
        playSfx('reveal', { volume: 0.32, rate: isFinale ? 0.82 : 1.05 });
        if (isFinale) {
          setFinaleKey(Date.now());
        }
      }
      if (phase === 'answer_reveal' && prev !== 'answer_reveal') {
        const correctId = state?.currentQuestion?.correctOptionId;
        const correctCount = correctId ? (state?.answerStats?.[correctId] || 0) : 0;
        playSfx(correctCount > 0 ? 'correct' : 'wrong', { volume: 0.6 });
      }
      if (phase === 'score') {
        setScoreKey(Date.now());
        playSfx('score', { volume: 0.6 });
      }
    },
    onLastSeconds: (remaining, phase) => {
      if (phase !== 'question') return;
      setLastSeconds(true);
      playSfx('tick', { volume: 0.38, rate: 1 + (3 - remaining) * 0.08 });
      window.setTimeout(() => setLastSeconds(false), 540);
    },
  });

  return (
    <div
      className={`screen-root ${lastSeconds ? 'is-tense' : ''} ${isFinalStretch ? 'is-finale' : ''}`}
      onPointerDownCapture={soundReady ? undefined : handleUnlock}
    >
      <ScreenBackground
        accent={accent}
        tense={lastSeconds}
        pulseKey={categoryKey || questionFlashKey || scoreKey}
        finale={isFinalStretch}
      />
      <div className="screen-foreground">
        {mode === 'lobby_empty' && <ScreenLobbyEmpty controllerUrl={controllerUrl} maxPlayers={maxPlayers} />}
        {mode === 'lobby_waiting' && (
          <ScreenLobbyWaiting controllerUrl={controllerUrl} players={players} maxPlayers={maxPlayers} />
        )}
        {mode === 'ready_check' && <ScreenReadyCheck players={players} characters={state?.characters || []} />}
        {mode === 'in_game' && state && (
          <ScreenInGame
            state={state}
            activeCategory={activeCategory}
            accent={accent}
            impact={state.recentImpact}
            finale={isFinalStretch}
          />
        )}
      </div>
      <ScreenEffects
        category={featuredCategory}
        categoryKey={categoryKey}
        questionFlashKey={questionFlashKey}
        scoreKey={scoreKey}
        lastSeconds={lastSeconds}
        impact={state?.recentImpact}
        impactKey={impactKey}
        players={state?.players || []}
        characters={state?.characters || []}
        finaleKey={finaleKey}
        showFinale={isFinalQuestion && Boolean(finaleKey)}
      />
      {!soundReady && !soundPromptDismissed && (
        <div className="sound-gate">
          <button className="button-primary sound-gate__button" onClick={handleUnlock}>
            Включить звук
          </button>
          <div className="small-muted">Нажмите один раз, чтобы разблокировать звук для эффектов</div>
        </div>
      )}
    </div>
  );
}
