import { QRCodeCanvas } from 'qrcode.react';
import { PlayerState } from '../../types';

interface Props {
  controllerUrl: string;
  players: PlayerState[];
  maxPlayers?: number;
}

const palette = ['#f472b6', '#22d3ee', '#a78bfa', '#f97316', '#34d399', '#38bdf8', '#eab308', '#fb7185'];

function avatarColor(index: number) {
  return palette[index % palette.length];
}

export default function ScreenLobbyWaiting({ controllerUrl, players, maxPlayers }: Props) {
  return (
    <div className="screen-panel screen-panel--split">
      <div className="screen-panel__content">
        <div className="screen-title neon-text">Ждём игроков</div>
        <div className="screen-subtitle">Подключайтесь, чтобы начать</div>
        <div className="pill glow">Игроки: {players.length}{maxPlayers ? ` / ${maxPlayers}` : ''}</div>
        <div className="avatar-row">
          {players.map((p, idx) => (
            <div key={p.id} className="avatar-dot" style={{ background: avatarColor(idx) }}>
              {p.nickname[0]?.toUpperCase() || '•'}
            </div>
          ))}
        </div>
      </div>
      <div className="qr-stack small">
        <div className="qr-glow" />
        <div className="qr-wrapper">
          <QRCodeCanvas value={controllerUrl} size={160} bgColor="transparent" fgColor="#eef2ff" />
        </div>
        <div className="screen-url">{controllerUrl}</div>
      </div>
    </div>
  );
}
