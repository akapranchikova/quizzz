import { PlayerState, Character } from '../types';

interface Props {
  players: PlayerState[];
  characters: Character[];
  showReady?: boolean;
  showScore?: boolean;
}

export default function PlayerList({ players, characters, showReady = true, showScore = true }: Props) {
  const lookup = Object.fromEntries(characters.map((c) => [c.id, c]));
  return (
    <div className="player-grid">
      {players.map((p) => {
        const char = p.characterId ? lookup[p.characterId] : undefined;
        return (
          <div key={p.id} className="player-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{p.nickname}</strong>
                {char ? (
                  <div className="small-muted">
                    {char.name} {char.ability ? `• ${char.ability.name}` : ''}
                  </div>
                ) : null}
              </div>
              {showReady && <span className={p.ready ? 'tag-ready' : 'tag-not-ready'}>{p.ready ? 'Готов' : '...'}</span>}
            </div>
            {showScore && <div className="small-muted">Очки: {p.score}</div>}
          </div>
        );
      })}
    </div>
  );
}
