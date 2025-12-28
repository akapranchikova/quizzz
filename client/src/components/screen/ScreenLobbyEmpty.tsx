import { QRCodeCanvas } from 'qrcode.react';

interface Props {
  controllerUrl: string;
  maxPlayers?: number;
}

export default function ScreenLobbyEmpty({ controllerUrl, maxPlayers }: Props) {
  return (
    <div className="screen-panel">
      <div className="screen-panel__content">
        <div className="screen-title neon-text">Подключайтесь с телефона</div>
        <div className="screen-subtitle">Сканируйте QR-код, чтобы войти</div>
        {maxPlayers ? <div className="pill glow">Игроки: 0 / {maxPlayers}</div> : <div className="pill glow">Ждём игроков</div>}
      </div>
      <div className="qr-stack">
        <div className="qr-glow" />
        <div className="qr-wrapper">
          <QRCodeCanvas value={controllerUrl} size={220} bgColor="transparent" fgColor="#eef2ff" />
        </div>
        <div className="screen-url">{controllerUrl}</div>
      </div>
    </div>
  );
}
