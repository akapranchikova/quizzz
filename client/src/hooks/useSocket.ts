import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState } from '../types';

const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5174';

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = io(socketUrl, { transports: ['websocket'] });
    setSocket(s);

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('server:state', (payload: GameState) => setState(payload));

    return () => {
      s.disconnect();
    };
  }, []);

  return { socket, state, connected };
}
