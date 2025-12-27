import PlayerList from '../components/PlayerList';
import QuestionPanel from '../components/QuestionPanel';
import Leaderboard from '../components/Leaderboard';
import { useSocket } from '../hooks/useSocket';

export default function AdminPage() {
  const { socket, state, connected } = useSocket();

  const startGame = () => socket?.emit('admin:startGame');
  const resetGame = () => socket?.emit('admin:reset');
  const reloadData = () => socket?.emit('admin:reloadData');
  const pickCategory = (categoryId: string) => socket?.emit('admin:pickCategory', { categoryId });
  const advance = () => socket?.emit('admin:next');

  const nextLabel = state?.phase === 'question' ? 'Пропустить ожидание' : 'Следующий раунд';

  return (
    <div className="app-shell">
      <div className="card">
        <div className="section-title">Админ-панель</div>
        <div className="flex-row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="status-pill">
            <span>{connected ? 'Онлайн' : 'Оффлайн'}</span>
            {state && <span className="badge">Стадия: {state.phase}</span>}
          </div>
          <div className="flex-row">
            <button className="button-primary" onClick={startGame} disabled={!socket || state?.phase !== 'lobby'}>
              Старт
            </button>
            <button className="button-primary" onClick={advance} disabled={!socket || state?.phase === 'lobby'}>
              {nextLabel}
            </button>
            <button className="button-primary" onClick={resetGame}>
              Reset game
            </button>
            <button className="button-primary" onClick={reloadData}>
              Reload data
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title">Категории</div>
        <div className="flex-row">
          {state?.categories.map((cat) => (
            <button
              key={cat.id}
              className="button-primary"
              disabled={state?.phase !== 'category_pick'}
              onClick={() => pickCategory(cat.id)}
            >
              {cat.icon || '📚'} {cat.title}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title">Игроки</div>
        <PlayerList players={state?.players || []} characters={state?.characters || []} showReady showScore />
      </div>

      {(state?.phase === 'question' || state?.phase === 'reveal') && state.currentQuestion && (
        <QuestionPanel
          question={state.currentQuestion}
          phase={state.phase === 'question' ? 'question' : 'reveal'}
          questionStartTime={state.questionStartTime}
          answerStats={state.answerStats}
        />
      )}

      {state?.leaderboard?.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title">Лидеры</div>
          <Leaderboard leaderboard={state.leaderboard} players={state.players} characters={state.characters} />
        </div>
      ) : null}
    </div>
  );
}
