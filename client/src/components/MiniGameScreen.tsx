import { Character, GameState, MatchPairsCard, MiniGameResult, MiniGameType, OddOneOutRound, PlayerState, SortOrderItem } from '../types';

interface Props {
  state: GameState;
  players: PlayerState[];
  characters?: Character[];
}

function LeaderRow({ result, players, characters }: { result: MiniGameResult; players: PlayerState[]; characters?: Character[] }) {
  const player = players.find((p) => p.id === result.playerId);
  const character = characters?.find((c) => c.id === player?.characterId);
  return (
    <div className="mini-leader">
      <div className="mini-avatar" style={{ ['--accent' as string]: character?.accent || '#22d3ee' }}>
        {character?.art ? <img src={character.art} alt={character.name} /> : <span>{character?.icon || '⭐'}</span>}
      </div>
      <div className="mini-leader__name">{player?.nickname || 'Игрок'}</div>
      <div className="mini-leader__score">+{Math.round(result.score || 0)}</div>
    </div>
  );
}

export default function MiniGameScreen({ state, players, characters }: Props) {
  const type = state.activeMiniGame?.type as MiniGameType | undefined;
  const data = state.activeMiniGame?.data || {};
  const results = state.miniGameState?.results || [];
  const titleMap: Record<MiniGameType, string> = {
    MATCH_PAIRS: 'Пары',
    SORT_ORDER: 'Порядок',
    CATEGORY_SNAP: 'Категории',
    ODD_ONE_OUT: 'Лишнее',
  };

  const renderMatchPairs = () => {
    const cards: MatchPairsCard[] = data.cards || [];
    return (
      <div className="mini-grid mini-grid--pairs screen-view">
        {cards.map((card) => (
          <div key={card.id} className="mini-card mini-card--ghost">
            <span className="mini-card__icon">{card.icon}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderSortOrder = () => {
    const items: SortOrderItem[] = data.items || [];
    return (
      <div className="mini-sort-list mini-sort-list--screen">
        {items.map((item) => (
          <div key={item.id} className="mini-sort-row">
            <div className="mini-sort-label">{item.label}</div>
          </div>
        ))}
      </div>
    );
  };

  const renderCategorySnap = () => {
    const prompts = data.prompts || [];
    const categories = data.categories || [];
    const prompt = prompts[0] || null;
    return (
      <div className="mini-column">
        {prompt && <div className="mini-bubble mini-bubble--screen">{prompt.label}</div>}
        <div className="mini-grid mini-grid--categories">
          {categories.map((cat: any) => (
            <div key={cat.id} className="mini-card mini-card--wide mini-card--ghost">
              <span className="mini-card__icon">{cat.icon || cat.label}</span>
              <span className="mini-card__text">{cat.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderOddOneOut = () => {
    const rounds: OddOneOutRound[] = data.rounds || [];
    const items = rounds[0]?.items || [];
    return (
      <div className="mini-grid mini-grid--options">
        {items.map((item: any) => (
          <div key={item.id} className="mini-card mini-card--option mini-card--ghost">
            <span className="mini-card__text">{item.label}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderByType = () => {
    if (type === 'MATCH_PAIRS') return renderMatchPairs();
    if (type === 'SORT_ORDER') return renderSortOrder();
    if (type === 'CATEGORY_SNAP') return renderCategorySnap();
    if (type === 'ODD_ONE_OUT') return renderOddOneOut();
    return (
      <div className="mini-board mini-board--fallback">
        <div className="mini-finish">✦</div>
      </div>
    );
  };

  if (!type) {
    return (
      <div className="phase-card mini-game-card">
        <div className="mini-finish">✦</div>
      </div>
    );
  }

  return (
    <div className="phase-card mini-game-card mini-game-card--full">
      <div className="mini-header">
        <div className="mini-chip">{titleMap[type]}</div>
        <div className="mini-meta">
          {state.miniGameState?.finished ? <span className="mini-pill mini-pill--soft">Финиш</span> : <span className="mini-pill mini-pill--soft">Ход</span>}
        </div>
      </div>
      <div className="mini-board">{renderByType()}</div>
      {results.length > 0 && (
        <div className="mini-leaders">
          {results.map((result) => (
            <LeaderRow key={result.playerId} result={result} players={players} characters={characters} />
          ))}
        </div>
      )}
    </div>
  );
}
