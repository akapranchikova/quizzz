import { Category } from '../../types';

interface Props {
  category: Category | null;
  categoryKey: number;
  questionFlashKey: number;
  scoreKey: number;
  lastSeconds: boolean;
}

export default function ScreenEffects({ category, categoryKey, questionFlashKey, scoreKey, lastSeconds }: Props) {
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
      {scoreKey ? (
        <div className="score-flight" key={`score-${scoreKey}`}>
          {Array.from({ length: 10 }).map((_, idx) => (
            <span key={idx} style={{ ['--i' as string]: idx + 1 }} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
