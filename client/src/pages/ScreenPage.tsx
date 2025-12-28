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
    (state?.phase === 'answer_reveal' || state?.phase === 'score') && currentQuestion
      ? players
          .filter((p) => p.lastAnswer)
          .map((p) => {
            const isCorrect = p.lastAnswer?.optionId === currentQuestion.correctOptionId;
            return { ...p, isCorrect };
          })
          .sort((a, b) => Number(b.isCorrect) - Number(a.isCorrect))
      : [];
  const phaseTimer =
    state?.phaseEndsAt && state?.phaseStartedAt ? (
      <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Таймер стадии" />
    ) : null;

  const renderPhaseContent = () => {
    switch (state?.phase) {
      case 'round_intro':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Новый раунд</div>
            <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Интро раунда" />
            <div className="small-muted" style={{ marginTop: 6 }}>
              Скоро выбор категории и вопрос.
            </div>
          </div>
        );
      case 'lobby':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Подключение игроков</div>
            <PlayerList players={players} characters={state?.characters || []} showReady={true} showScore={false} />
          </div>
        );
      case 'ready':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Нажмите «Готов» на своих устройствах</div>
            <PlayerList players={players} characters={state?.characters || []} showReady={true} showScore={false} />
          </div>
        );
      case 'game_start_confirm':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Все готовы!</div>
            <div className="badge">Любой игрок может начать игру</div>
            <PlayerList players={players} characters={state?.characters || []} showReady={true} showScore={false} />
          </div>
        );
      case 'category_select':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Выберите категорию</div>
            <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Голосование" />
            <div className="flex-row" style={{ gap: 12, marginTop: 10 }}>
              {(state.categoryOptions || state.categories).slice(0, 4).map((cat) => (
                <div key={cat.id} className="badge">
                  <span>{cat.icon || '📚'}</span>
                  <strong>{cat.title}</strong>
                </div>
              ))}
            </div>
            <div className="small-muted" style={{ marginTop: 8 }}>
              Как только все игроки проголосуют — идём дальше.
            </div>
          </div>
        );
      case 'category_reveal':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Категория выбрана</div>
            <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Результаты голосования" />
            <div className="flex-row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
              {(state.categoryOptions?.length ? state.categoryOptions : state.categories).map((cat) => {
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
        );
      case 'random_event':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Случайное событие</div>
            <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Показ события" />
            {state.activeEvent ? (
              <div className="alert" style={{ marginTop: 8 }}>
                {state.activeEvent.kind === 'malus' ? 'Пакость' : 'Баф'}: {state.activeEvent.title}
                {state.activeEvent.targetPlayerId && (
                  <span style={{ marginLeft: 6 }}>
                    → цель: {players.find((p) => p.id === state.activeEvent?.targetPlayerId)?.nickname || 'случайный игрок'}
                  </span>
                )}
                {state.activeEvent.description && <div className="small-muted">{state.activeEvent.description}</div>}
              </div>
            ) : (
              <div className="small-muted" style={{ marginTop: 6 }}>
                На этот раунд событие не выпало.
              </div>
            )}
          </div>
        );
      case 'ability_phase':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Подготовка перед вопросом</div>
            <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Окно бафов и пакостей" />
            <div className="small-muted" style={{ marginTop: 6 }}>
              Все способности и события применяются только сейчас.
            </div>
            <div className="flex-row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {players.map((p) => (
                <div key={p.id} className="badge" style={{ borderColor: state.preQuestionReady?.[p.id] ? '#22c55e' : undefined }}>
                  <span>{p.nickname}</span>
                  {state.preQuestionReady?.[p.id] && <span className="small-muted">готов</span>}
                </div>
              ))}
            </div>
          </div>
        );
      case 'question':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            {state.currentQuestion && <QuestionPrompt question={state.currentQuestion} questionStartTime={state.questionStartTime} />}
          </div>
        );
      case 'answer_reveal':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Результаты вопроса</div>
            <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Показ результатов" />
            {state.currentQuestion && <QuestionResults question={state.currentQuestion} answerStats={state.answerStats || {}} />}
            {state.currentQuestion?.explanation && <div className="alert" style={{ marginTop: 12 }}>{state.currentQuestion.explanation}</div>}
          </div>
        );
      case 'score':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Очки за раунд</div>
            <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Анимация очков" />
            <Leaderboard leaderboard={state.leaderboard} players={players} characters={state?.characters || []} />
          </div>
        );
      case 'intermission':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Перерыв перед мини-игрой</div>
            <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Интермиссия" />
            <div className="small-muted" style={{ marginTop: 6 }}>Сейчас начнётся случайная мини-игра.</div>
            <div className="flex-row" style={{ marginTop: 8 }}>
              {(state.miniGamesRemaining || []).map((m) => (
                <div key={m.id} className="badge">
                  {m.title}
                </div>
              ))}
            </div>
          </div>
        );
      case 'mini_game':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Мини-игра</div>
            <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Мини-игра" />
            {state.activeMiniGame ? (
              <div className="alert" style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 700 }}>{state.activeMiniGame.title}</div>
                <div className="small-muted">{state.activeMiniGame.description}</div>
                {state.activeMiniGame.scoring && <div className="small-muted">Очки: {state.activeMiniGame.scoring}</div>}
              </div>
            ) : (
              <div className="small-muted">Мини-игра выбирается сервером...</div>
            )}
          </div>
        );
      case 'next_round_confirm':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Готовы продолжить?</div>
            <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Ожидание подтверждения" />
            <div className="badge" style={{ marginTop: 8 }}>Любой игрок может начать следующий раунд</div>
          </div>
        );
      case 'game_end':
        return (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Игра завершена</div>
            <Leaderboard leaderboard={state.leaderboard} players={players} characters={state?.characters || []} />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="app-shell">
      <div className="card">
        <div className="section-title">Главный экран</div>
        <div className="flex-row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="status-pill">
            <span>{connected ? 'Socket подключен' : 'Нет соединения'}</span>
            {state && <span className="badge">Стадия: {state.phase}</span>}
            {state && (
              <span className="badge">
                Вопросов сыграно: {state.usedQuestionCount}/{state.totalQuestions}
              </span>
            )}
            {state && (
              <span className="badge">
                Раунд: {state.roundNumber}/{state.maxRounds}
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

      <div className="badge" style={{ marginTop: 10 }}>{state?.narration || '...'}</div>
      {phaseTimer}
      {state?.activeEvent && (
        <div className="alert" style={{ marginTop: 8 }}>
          {state.activeEvent.kind === 'malus' ? 'Пакость' : 'Баф'}: {state.activeEvent.title}
          {state.activeEvent.targetPlayerId && (
            <span style={{ marginLeft: 6 }}>
              → цель: {players.find((p) => p.id === state.activeEvent?.targetPlayerId)?.nickname || 'случайный игрок'}
            </span>
          )}
        </div>
      )}
    </div>

      {renderPhaseContent()}

      {(state?.phase === 'answer_reveal' || state?.phase === 'score') && answeredPlayers.length > 0 && (
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

      {state?.leaderboard?.length && state?.phase !== 'score' && state?.phase !== 'game_end' ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title">Лидеры</div>
          <Leaderboard leaderboard={state.leaderboard} players={players} characters={state?.characters || []} />
        </div>
      ) : null}

      <div className="small-muted" style={{ marginTop: 12 }}>
        Подсказка: стадиями управляет сервер автоматически. Клиент синхронизируется через Socket.IO ({socket?.id || '...'}).
      </div>
    </div>
  );
}
