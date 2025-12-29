import ScreenRoot from '../components/screen/ScreenRoot';
import { useSocket } from '../hooks/useSocket';
import { usePacedState } from '../hooks/usePacedState';

export default function ScreenPage() {
  const { state } = useSocket();
  const pacedState = usePacedState(state);
  return <ScreenRoot state={pacedState} />;
}
