import { Character, PlayerState } from '../types';

interface Props {
  leaderboard: { id: string; nickname: string; score: number; characterId?: string }[];
  players: PlayerState[];
  characters: Character[];
  highlight?: boolean;
}

export default function Leaderboard({ leaderboard, players, characters, highlight }: Props) {
  const lookupChar = Object.fromEntries(characters.map((c) => [c.id, c]));
  const lookupPlayer = Object.fromEntries(players.map((p) => [p.id, p]));
  return (
    <div className={`leaderboard ${highlight ? 'leaderboard--animated' : ''}`}>
      {leaderboard.map((entry, idx) => {
        const char = entry.characterId ? lookupChar[entry.characterId] : undefined;
        const p = lookupPlayer[entry.id];
        return (
          <div key={entry.id} className="player-card">
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
                </span>
              ) : null}
              {char && <div className="small-muted">{char.name}</div>}
            </div>
            {p?.lastAnswer?.pointsEarned != null && (
              <div className="small-muted">Последний раунд: +{p.lastAnswer.pointsEarned} очков</div>
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
