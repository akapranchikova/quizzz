import { PlayerState, Character } from '../../types';

interface Props {
  players: PlayerState[];
  characters: Character[];
}

export default function ScreenReadyCheck({ players, characters }: Props) {
  const lookup = Object.fromEntries(characters.map((c) => [c.id, c]));
  return (
    <div className="screen-panel ready">
      <div className="screen-title neon-text">Нажмите «Готов» на своих устройствах</div>
      <div className="ready-grid">
        {players.map((p) => {
          const char = p.characterId ? lookup[p.characterId] : null;
          return (
            <div key={p.id} className="ready-card">
              <div className="ready-avatar">{p.nickname[0]?.toUpperCase() || '•'}</div>
              <div className="ready-meta">
                <div className="ready-name">{p.nickname}</div>
                {char ? <div className="ready-role">{char.name}</div> : null}
              </div>
              <div className={`ready-indicator ${p.ready ? 'is-ready' : ''}`}>{p.ready ? '✓' : '•'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
