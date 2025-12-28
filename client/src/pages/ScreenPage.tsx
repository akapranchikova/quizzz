import ScreenRoot from '../components/screen/ScreenRoot';
import { useSocket } from '../hooks/useSocket';

export default function ScreenPage() {
  const { state } = useSocket();
  return <ScreenRoot state={state} />;
}
