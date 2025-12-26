import { QRCodeCanvas } from 'qrcode.react';
import PlayerList from '../components/PlayerList';
import QuestionPanel from '../components/QuestionPanel';
import Leaderboard from '../components/Leaderboard';
import { useSocket } from '../hooks/useSocket';

export default function ScreenPage() {
  const { socket, state, connected } = useSocket();
  const controllerUrl = `${window.location.protocol}//${window.location.host}/controller`;

  return (
    <div className="app-shell">
      <div className="card">
        <div className="section-title">Экран ведущего</div>
        <div className="flex-row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="status-pill">
            <span>{connected ? 'Socket подключен' : 'Нет соединения'}</span>
            {state && <span className="badge">Стадия: {state.phase}</span>}
            {state && (
              <span className="badge">
                Вопросов сыграно: {state.usedQuestionCount}/{state.totalQuestions}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div>
              <div className="small-muted">Подключайтесь на телефоне</div>
              <strong>{controllerUrl}</strong>
            </div>
            <QRCodeCanvas value={controllerUrl} size={110} bgColor="#0b1221" fgColor="#e2e8f0" />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title">Игроки</div>
        <PlayerList players={state?.players || []} characters={state?.characters || []} showReady={true} showScore={true} />
      </div>

      {state?.phase === 'category_pick' && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title">Выбор категории</div>
          <div className="flex-row">
            {state.categories.map((cat) => (
              <div key={cat.id} className="badge">
                <span>{cat.icon || '📚'}</span>
                <strong>{cat.title}</strong>
              </div>
            ))}
          </div>
          <div className="small-muted" style={{ marginTop: 8 }}>
            Нажмите нужную категорию на панели администратора.
          </div>
        </div>
      )}

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

      <div className="small-muted" style={{ marginTop: 12 }}>
        Подсказка: стадиями управляет сервер и админ. Клиент синхронизируется через Socket.IO ({socket?.id || '...'}).
      </div>
    </div>
  );
}
