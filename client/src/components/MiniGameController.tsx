import { ReactNode } from 'react';
import TimerBar from './TimerBar';
import {
  CategorySnapProgress,
  GameState,
  MatchPairsCard,
  MiniGameType,
  OddOneOutProgress,
  PlayerState,
  SortOrderItem,
  SortOrderProgress,
} from '../types';

interface Props {
  state: GameState;
  me: PlayerState;
  accentColor: string;
  onAction: (payload: any) => void;
  statusBanner?: ReactNode;
}

function MiniGameBadge({ type }: { type: MiniGameType }) {
  const labels: Record<MiniGameType, string> = {
    MATCH_PAIRS: 'Пары',
    SORT_ORDER: 'Порядок',
    CATEGORY_SNAP: 'Категории',
    ODD_ONE_OUT: 'Лишнее',
  };
  return <div className="mini-chip">{labels[type]}</div>;
}

export default function MiniGameController({ state, me, accentColor, onAction, statusBanner }: Props) {
  const type = state.activeMiniGame?.type as MiniGameType | undefined;
  const data = state.activeMiniGame?.data || {};
  const progress = (state.miniGameState?.progress?.[me.id] as any) || null;
  const done = Boolean(progress?.done || state.miniGameState?.finished);
  const startsAt = state.miniGameState?.startedAt || state.phaseStartedAt || null;
  const endsAt = state.miniGameState?.endsAt || state.phaseEndsAt || null;

  if (!type) {
    return (
      <div className="controller-stage controller-centered">
        <div className="mini-finish">✦</div>
      </div>
    );
  }

  const renderMatchPairs = () => {
    const cards: MatchPairsCard[] = data.cards || [];
    const openCards: string[] = progress?.openCardIds || [];
    const matchedPairs: string[] = progress?.matchedPairIds || [];
    return (
      <div className="mini-grid mini-grid--pairs">
        {cards.map((card) => {
          const isMatched = matchedPairs.includes(card.pairId);
          const isOpen = openCards.includes(card.id);
          const faceUp = isMatched || isOpen;
          return (
            <button
              key={card.id}
              className={`mini-card tappable ${faceUp ? 'mini-card--on' : ''}`}
              onClick={() => (!done ? onAction({ type, cardId: card.id }) : null)}
              disabled={done}
              type="button"
            >
              <span className="mini-card__icon">{faceUp ? card.icon : '✦'}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderSortOrder = () => {
    const items: SortOrderItem[] = data.items || [];
    const fallbackOrder = items.map((i) => i.id);
    const order: string[] = (progress as SortOrderProgress)?.order || fallbackOrder;
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    return (
      <div className="mini-sort-list">
        {order.map((id, idx) => {
          const item = byId[id];
          if (!item) return null;
          return (
            <div key={id} className="mini-sort-row">
              <div className="mini-sort-label">{item.label}</div>
              <div className="mini-sort-actions">
                <button
                  className="mini-pill"
                  onClick={() => (!done ? onAction({ type, itemId: id, direction: 'up' }) : null)}
                  disabled={done || idx === 0}
                  type="button"
                >
                  ↑
                </button>
                <button
                  className="mini-pill"
                  onClick={() => (!done ? onAction({ type, itemId: id, direction: 'down' }) : null)}
                  disabled={done || idx === order.length - 1}
                  type="button"
                >
                  ↓
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderCategorySnap = () => {
    const prompts = data.prompts || [];
    const categories = data.categories || [];
    const progressTyped = progress as CategorySnapProgress | null;
    const promptIndex = progressTyped?.promptIndex || 0;
    const prompt = prompts[promptIndex] || prompts[prompts.length - 1];
    return (
      <div className="mini-column">
        {prompt && <div className="mini-bubble">{prompt.label}</div>}
        <div className="mini-grid mini-grid--categories">
          {categories.map((cat: any) => (
            <button
              key={cat.id}
              className="mini-card mini-card--wide tappable"
              onClick={() => (!done ? onAction({ type, categoryId: cat.id }) : null)}
              disabled={done}
              type="button"
            >
              <span className="mini-card__icon">{cat.icon || cat.label}</span>
              <span className="mini-card__text">{cat.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderOddOneOut = () => {
    const rounds = data.rounds || [];
    const progressTyped = progress as OddOneOutProgress | null;
    const roundIndex = Math.min(progressTyped?.roundIndex ?? 0, rounds.length - 1);
    const round = rounds[roundIndex] || rounds[0];
    const items = round?.items || [];
    return (
      <div className="mini-grid mini-grid--options">
        {items.map((item: any) => (
          <button
            key={item.id}
            className="mini-card mini-card--option tappable"
            onClick={() => (!done ? onAction({ type, itemId: item.id }) : null)}
            disabled={done}
            type="button"
          >
            <span className="mini-card__text">{item.label}</span>
          </button>
        ))}
      </div>
    );
  };

  const renderByType = () => {
    if (type === 'MATCH_PAIRS') return renderMatchPairs();
    if (type === 'SORT_ORDER') return renderSortOrder();
    if (type === 'CATEGORY_SNAP') return renderCategorySnap();
    if (type === 'ODD_ONE_OUT') return renderOddOneOut();
    return null;
  };

  return (
    <div className="controller-stage controller-stage--flow controller-stage--stack minigame-stage">
      {startsAt && endsAt && (
        <TimerBar startsAt={startsAt} endsAt={endsAt} showTimeText={false} accent={accentColor} className="timer-bar--compact" />
      )}
      {statusBanner}
      <div className="mini-header">
        <MiniGameBadge type={type} />
        <div className="mini-score">{Math.round(progress?.score || 0)}</div>
      </div>
      <div className="mini-board">{renderByType()}</div>
      {done && <div className="mini-finish">✓</div>}
    </div>
  );
}
