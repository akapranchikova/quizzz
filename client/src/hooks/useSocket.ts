import { useCallback, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState } from '../types';

const defaultHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const defaultPort = import.meta.env.VITE_SOCKET_PORT || '5174';
const socketUrl = import.meta.env.VITE_SOCKET_URL || `${typeof window !== 'undefined' ? window.location.protocol : 'http:'}//${defaultHost}:${defaultPort}`;
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

  const persistIdentity = useCallback((payload: { playerId: string; resumeToken: string } | null) => {
    setIdentity(payload);
    if (typeof window === 'undefined') return;
    if (!payload) {
      localStorage.removeItem(IDENTITY_KEY);
      return;
    }
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(payload));
  }, []);

  const attemptResume = useCallback(() => {
    if (!socket || !identity) return;
    socket.emit('player:resume', identity, (res?: { ok?: boolean }) => {
      if (!res?.ok) {
        persistIdentity(null);
      }
    });
  }, [identity, persistIdentity, socket]);

  useEffect(() => {
    const s = io(socketUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 1500,
    });
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
      if (identity?.playerId !== playerId && identity?.resumeToken) {
        persistIdentity({ playerId, resumeToken: identity.resumeToken });
      }
    });

    return () => {
      s.disconnect();
    };
  }, [attemptResume, identity?.playerId, identity?.resumeToken, persistIdentity]);

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
  }, [attemptResume, connected, identity?.playerId, identity?.resumeToken]);

  return { socket, state, connected, playerId: identity?.playerId, persistIdentity };
}
