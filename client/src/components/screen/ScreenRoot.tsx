import { useMemo } from 'react';
import { GameState } from '../../types';
import ScreenBackground from './ScreenBackground';
import ScreenInGame from './ScreenInGame';
import ScreenLobbyEmpty from './ScreenLobbyEmpty';
import ScreenLobbyWaiting from './ScreenLobbyWaiting';
import ScreenReadyCheck from './ScreenReadyCheck';

type ScreenMode = 'lobby_empty' | 'lobby_waiting' | 'ready_check' | 'in_game';

interface Props {
  state: GameState | null;
}

function deriveMode(state: GameState | null): ScreenMode {
  const players = state?.players || [];
  if (!state || state.phase === 'lobby') {
    return players.length === 0 ? 'lobby_empty' : 'lobby_waiting';
  }
  if (state.phase === 'ready' || state.phase === 'game_start_confirm') {
    return 'ready_check';
  }
  return 'in_game';
}

function buildControllerUrl(state: GameState | null) {
  if (state?.controllerUrl) return state.controllerUrl;
  if (typeof window === 'undefined') return '';
  const hostForQr = state?.preferredHost || window.location.hostname;
  return `${window.location.protocol}//${hostForQr}${window.location.port ? `:${window.location.port}` : ''}/controller`;
}

export default function ScreenRoot({ state }: Props) {
  const mode = deriveMode(state);
  const controllerUrl = useMemo(() => buildControllerUrl(state), [state]);
  const maxPlayers = state?.maxPlayers ?? 8;
  const players = state?.players || [];

  return (
    <div className="screen-root">
      <ScreenBackground />
      <div className="screen-foreground">
        {mode === 'lobby_empty' && <ScreenLobbyEmpty controllerUrl={controllerUrl} maxPlayers={maxPlayers} />}
        {mode === 'lobby_waiting' && (
          <ScreenLobbyWaiting controllerUrl={controllerUrl} players={players} maxPlayers={maxPlayers} />
        )}
        {mode === 'ready_check' && <ScreenReadyCheck players={players} characters={state?.characters || []} />}
        {mode === 'in_game' && state && <ScreenInGame state={state} />}
      </div>
    </div>
  );
}
