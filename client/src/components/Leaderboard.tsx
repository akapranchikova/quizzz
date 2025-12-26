import { Character, PlayerState } from '../types';

interface Props {
  leaderboard: { id: string; nickname: string; score: number; characterId?: string }[];
  players: PlayerState[];
  characters: Character[];
}

export default function Leaderboard({ leaderboard, players, characters }: Props) {
  const lookupChar = Object.fromEntries(characters.map((c) => [c.id, c]));
  const lookupPlayer = Object.fromEntries(players.map((p) => [p.id, p]));
  return (
    <div className="leaderboard">
      {leaderboard.map((entry, idx) => {
        const char = entry.characterId ? lookupChar[entry.characterId] : undefined;
        const p = lookupPlayer[entry.id];
        return (
          <div key={entry.id} className="player-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>
                #{idx + 1} {entry.nickname}
              </strong>
              <span className="badge">{entry.score} очков</span>
            </div>
            {char && <div className="small-muted">{char.name}</div>}
            {p?.lastAnswer?.pointsEarned != null && (
              <div className="small-muted">Последний раунд: +{p.lastAnswer.pointsEarned} очков</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
