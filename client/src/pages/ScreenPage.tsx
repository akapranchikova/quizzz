import { QRCodeCanvas } from 'qrcode.react';
import PlayerList from '../components/PlayerList';
import Leaderboard from '../components/Leaderboard';
import QuestionPrompt from '../components/QuestionPrompt';
import QuestionResults from '../components/QuestionResults';
import TimerBar from '../components/TimerBar';
import { useSocket } from '../hooks/useSocket';

export default function ScreenPage() {
  const { socket, state, connected } = useSocket();
  const hostForQr = state?.preferredHost || window.location.hostname;
  const controllerUrl = `${window.location.protocol}//${hostForQr}${window.location.port ? `:${window.location.port}` : ''}/controller`;
  const players = state?.players || [];
  const currentQuestion = state?.currentQuestion;
  const answeredPlayers =
    state?.phase === 'reveal' && currentQuestion
      ? players
          .filter((p) => p.lastAnswer)
          .map((p) => {
            const isCorrect = p.lastAnswer?.optionId === currentQuestion.correctOptionId;
            return { ...p, isCorrect };
          })
          .sort((a, b) => Number(b.isCorrect) - Number(a.isCorrect))
      : [];

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
        <PlayerList players={players} characters={state?.characters || []} showReady={true} showScore={true} />
      </div>

      {state?.phase === 'category_pick' && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title">Выбор категории</div>
          <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Выбор категории" />
          <div className="flex-row" style={{ gap: 8 }}>
            {state.categories.map((cat) => (
              <div key={cat.id} className="badge">
                <span>{cat.icon || '📚'}</span>
                <strong>{cat.title}</strong>
              </div>
            ))}
          </div>
          <div className="small-muted" style={{ marginTop: 8 }}>
            Игроки голосуют на своих контроллерах. Результаты появятся после окончания таймера.
          </div>
        </div>
      )}

      {state?.phase === 'category_reveal' && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title">Категория выбрана</div>
          <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Показ результата" />
          <div className="flex-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {state.categories.map((cat) => {
              const votes = state.categoryVoteStats?.[cat.id] || 0;
              const highlight = cat.id === state.activeCategoryId;
              return (
                <div key={cat.id} className="badge" style={{ borderColor: highlight ? '#22c55e' : undefined }}>
                  <span>{cat.icon || '📚'}</span>
                  <strong>{cat.title}</strong>
                  <span className="small-muted" style={{ marginLeft: 6 }}>
                    Голоса: {votes}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="small-muted" style={{ marginTop: 8 }}>
            Победила категория {state.categories.find((c) => c.id === state.activeCategoryId)?.title || '—'}.
          </div>
        </div>
      )}

      {state?.phase === 'ability' && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title">Подготовка к вопросу</div>
          <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Окно способностей" />
          <div className="small-muted">Выберите, будете ли применять способности. Вопрос появится после таймера.</div>
        </div>
      )}

      {state?.phase === 'question' && state.currentQuestion && (
        <div className="card" style={{ marginTop: 14 }}>
          <QuestionPrompt question={state.currentQuestion} questionStartTime={state.questionStartTime} />
        </div>
      )}

      {state?.phase === 'reveal' && state.currentQuestion && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title">Результаты вопроса</div>
          <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Показ результатов" />
          <QuestionResults question={state.currentQuestion} answerStats={state.answerStats || {}} />
          {state.currentQuestion.explanation && <div className="alert" style={{ marginTop: 12 }}>{state.currentQuestion.explanation}</div>}
        </div>
      )}

      {state?.phase === 'reveal' && answeredPlayers.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title">Кто как ответил</div>
          <div className="player-grid">
            {answeredPlayers.map((p) => (
              <div key={p.id} className="player-card" style={{ borderColor: p.isCorrect ? '#22c55e' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{p.nickname}</strong>
                  {p.isCorrect ? <span className="badge">+{p.lastAnswer?.pointsEarned || 0} очков</span> : <span className="badge">Мимо</span>}
                </div>
                <div className="small-muted">
                  Ответ: {currentQuestion?.options.find((o) => o.id === p.lastAnswer?.optionId)?.text || '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {state?.phase === 'round_end' && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title">Перерыв между раундами</div>
          <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="До следующего раунда" />
          <div className="small-muted">Следующий выбор категории начнется автоматически.</div>
        </div>
      )}

      {state?.leaderboard?.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title">Лидеры</div>
          <Leaderboard leaderboard={state.leaderboard} players={players} characters={state?.characters || []} />
        </div>
      ) : null}

      <div className="small-muted" style={{ marginTop: 12 }}>
        Подсказка: стадиями управляет сервер и админ. Клиент синхронизируется через Socket.IO ({socket?.id || '...'}).
      </div>
    </div>
  );
}
