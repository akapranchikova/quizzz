import { Category, Character, GameState, PlayerState } from '../../types';

interface Props {
  category: Category | null;
  categoryKey: number;
  questionFlashKey: number;
  scoreKey: number;
  lastSeconds: boolean;
  impact?: GameState['recentImpact'] | null;
  impactKey?: number;
  players: PlayerState[];
  characters: Character[];
  finaleKey?: number;
  showFinale?: boolean;
}

export default function ScreenEffects({
  category,
  categoryKey,
  questionFlashKey,
  scoreKey,
  lastSeconds,
  impact,
  impactKey,
  players,
  characters,
  finaleKey,
  showFinale,
}: Props) {
  const lookupPlayer = Object.fromEntries(players.map((p) => [p.id, p]));
  const lookupChar = Object.fromEntries(characters.map((c) => [c.id, c]));
  const actor = impact?.from ? lookupPlayer[impact.from] : null;
  const target = impact?.target ? lookupPlayer[impact.target] : null;
  const actorChar = actor?.characterId ? lookupChar[actor.characterId] : null;
  const targetChar = target?.characterId ? lookupChar[target.characterId] : null;
  const isFreshImpact = impact && Date.now() - impact.at < 2400;

  return (
    <div className="screen-effects">
      {category ? (
        <div
          className="effect-card"
          key={`${category.id}-${categoryKey}`}
          style={{ ['--accent' as string]: category.accent || '#8b5cf6' }}
        >
          <div className="effect-card__glow" />
          <div className="effect-card__body">
            <div className="effect-card__thumb">
              {category.art ? <img src={category.art} alt={category.title} /> : <span>{category.icon || '📚'}</span>}
            </div>
            <div className="effect-card__meta">
              <div className="effect-card__label">Категория</div>
              <div className="effect-card__title">{category.title}</div>
            </div>
          </div>
          <div className="confetti-burst">
            {Array.from({ length: 18 }).map((_, idx) => (
              <span key={idx} style={{ ['--i' as string]: idx + 1 }} />
            ))}
          </div>
        </div>
      ) : null}
      {questionFlashKey ? <div className="whoosh" key={`whoosh-${questionFlashKey}`} /> : null}
      {lastSeconds ? <div className="vignette-pulse" /> : null}
      {showFinale && finaleKey ? (
        <div className="finale-overlay" key={`finale-${finaleKey}`}>
          <div className="finale-text">Финальный вопрос</div>
        </div>
      ) : null}
      {scoreKey ? (
        <div className="score-flight" key={`score-${scoreKey}`}>
          {Array.from({ length: 10 }).map((_, idx) => (
            <span key={idx} style={{ ['--i' as string]: idx + 1 }} />
          ))}
        </div>
      ) : null}
      {impact && impactKey && isFreshImpact ? (
        <div className="impact-bloom" key={`impact-${impactKey}`}>
          <div className="impact-ring" />
          <div className="impact-card">
            {actorChar && (
              <span className="impact-avatar" style={{ ['--accent' as string]: actorChar.accent }}>
                {actorChar.art ? <img src={actorChar.art} alt={actorChar.name} /> : <span>{actorChar.icon || '✨'}</span>}
              </span>
            )}
            {targetChar && (
              <span className="impact-avatar impact-avatar--target" style={{ ['--accent' as string]: targetChar.accent }}>
                {targetChar.art ? <img src={targetChar.art} alt={targetChar.name} /> : <span>{targetChar.icon || '✨'}</span>}
              </span>
            )}
            <div className="impact-wave" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
