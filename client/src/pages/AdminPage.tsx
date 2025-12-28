import PlayerList from '../components/PlayerList';
import Leaderboard from '../components/Leaderboard';
import QuestionPrompt from '../components/QuestionPrompt';
import QuestionResults from '../components/QuestionResults';
import TimerBar from '../components/TimerBar';
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
        {state?.phaseEndsAt && state?.phaseStartedAt && (
          <div style={{ marginTop: 8 }}>
            <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Таймер стадии" />
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title">Категории</div>
        <div className="flex-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {state?.categories.map((cat) => (
            <button
              key={cat.id}
              className="button-primary"
              disabled={state?.phase !== 'category_pick'}
              onClick={() => pickCategory(cat.id)}
            >
              {cat.icon || '📚'} {cat.title} ({state?.categoryVoteStats?.[cat.id] || 0})
            </button>
          ))}
        </div>
        <div className="small-muted" style={{ marginTop: 6 }}>
          Игроки голосуют за категорию. Если все проголосовали — выбор произойдет автоматически, при равенстве голосов — случайно. Кнопка
          «{nextLabel}» выберет категорию на основе текущих голосов.
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title">Игроки</div>
        <PlayerList players={state?.players || []} characters={state?.characters || []} showReady showScore />
      </div>

      {state?.phase === 'question' && state.currentQuestion && (
        <div className="card" style={{ marginTop: 14 }}>
          <QuestionPrompt question={state.currentQuestion} questionStartTime={state.questionStartTime} />
        </div>
      )}
      {state?.phase === 'reveal' && state.currentQuestion && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title">Результаты вопроса</div>
          <QuestionResults question={state.currentQuestion} answerStats={state.answerStats} />
        </div>
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
