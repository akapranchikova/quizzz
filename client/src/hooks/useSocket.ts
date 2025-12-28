import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState } from '../types';

const defaultHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const portFromEnv = import.meta.env.VITE_SOCKET_PORT;
const fallbackPort =
  typeof window !== 'undefined'
    ? import.meta.env.DEV
      ? '5174'
      : window.location.port || '5174'
    : '5174';
const defaultPort = portFromEnv ?? fallbackPort;
const defaultProtocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
const socketUrl =
  import.meta.env.VITE_SOCKET_URL || `${defaultProtocol}//${defaultHost}${defaultPort ? `:${defaultPort}` : ''}`;
const IDENTITY_KEY = 'quizzz:player_identity';
type StoredIdentity = { playerId: string; resumeToken: string };

function readStoredIdentity(): StoredIdentity | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.playerId && parsed?.resumeToken) return parsed;
  } catch (err) {
    console.warn('Failed to parse stored identity', err);
  }
  return null;
}

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [identity, setIdentity] = useState<ReturnType<typeof readStoredIdentity>>(readStoredIdentity);
  const socketRef = useRef<Socket | null>(null);
  const identityRef = useRef(identity);

  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  const persistIdentity = useCallback((payload: { playerId: string; resumeToken: string } | null) => {
    identityRef.current = payload;
    setIdentity(payload);
    if (typeof window === 'undefined') return;
    if (!payload) {
      localStorage.removeItem(IDENTITY_KEY);
      return;
    }
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(payload));
  }, []);

  const attemptResume = useCallback(() => {
    const activeSocket = socketRef.current;
    const currentIdentity = identityRef.current;
    if (!activeSocket || !currentIdentity) return;
    activeSocket.emit('player:resume', currentIdentity, (res?: { ok?: boolean }) => {
      if (!res?.ok) {
        persistIdentity(null);
      }
    });
  }, [persistIdentity]);

  useEffect(() => {
    const s = io(socketUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 1500,
    });
    socketRef.current = s;
    setSocket(s);

    s.on('connect', () => {
      setConnected(true);
      attemptResume();
    });
    s.on('disconnect', () => setConnected(false));
    s.on('server:state', (payload: GameState) => setState(payload));
    s.on('reconnect', attemptResume);
    s.on('server:resume_failed', () => persistIdentity(null));
    s.on('server:resume_ok', ({ playerId }: { playerId: string }) => {
      const currentIdentity = identityRef.current;
      if (currentIdentity?.playerId !== playerId && currentIdentity?.resumeToken) {
        persistIdentity({ playerId, resumeToken: currentIdentity.resumeToken });
      }
    });

    return () => {
      socketRef.current = null;
      s.disconnect();
    };
  }, [attemptResume, persistIdentity]);

  useEffect(() => {
    if (!socket || typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        attemptResume();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [attemptResume, socket]);

  useEffect(() => {
    if (connected) {
      attemptResume();
    }
  }, [attemptResume, connected]);

  return { socket, state, connected, playerId: identity?.playerId, persistIdentity };
}
