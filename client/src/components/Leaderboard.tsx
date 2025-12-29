import { Character, GameState, PlayerState } from '../types';

interface Props {
  leaderboard: { id: string; nickname: string; score: number; characterId?: string }[];
  players: PlayerState[];
  characters: Character[];
  highlight?: boolean;
  impact?: GameState['recentImpact'] | null;
}

export default function Leaderboard({ leaderboard, players, characters, highlight, impact }: Props) {
  const lookupChar = Object.fromEntries(characters.map((c) => [c.id, c]));
  const lookupPlayer = Object.fromEntries(players.map((p) => [p.id, p]));
  return (
    <div className={`leaderboard ${highlight ? 'leaderboard--animated' : ''}`}>
      {leaderboard.map((entry, idx) => {
        const char = entry.characterId ? lookupChar[entry.characterId] : undefined;
        const p = lookupPlayer[entry.id];
        const justScored = (p?.lastAnswer?.pointsEarned || 0) > 0;
        const isTarget = impact?.target && impact.target === entry.id;
        const isActor = impact?.from && impact.from === entry.id;
        return (
          <div
            key={entry.id}
            className={`player-card ${justScored ? 'player-card--glow' : ''} ${isTarget ? 'player-card--impact' : ''} ${
              isActor ? 'player-card--actor' : ''
            }`.trim()}
          >
            <div className="player-card__header">
              <div className="player-card__title">
                <span className="pill pill-ghost">#{idx + 1}</span>
                <strong>{entry.nickname}</strong>
              </div>
              <span className="badge">{entry.score} очков</span>
            </div>
            <div className="player-card__meta">
              {char ? (
                <span className="player-card__avatar" style={{ background: char.accent || '#1e293b' }}>
                  {char.art ? <img src={char.art} alt={char.name} /> : <span>{char.icon || '✨'}</span>}
                  <span className="avatar-glow" />
                </span>
              ) : null}
              {char && <div className="small-muted">{char.name}</div>}
            </div>
            {p?.lastAnswer?.pointsEarned != null && (
              <div className="small-muted">Последний: +{p.lastAnswer.pointsEarned}</div>
            )}
            {highlight && (
              <div className="score-particles">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i} style={{ ['--i' as string]: i + 1 }} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
