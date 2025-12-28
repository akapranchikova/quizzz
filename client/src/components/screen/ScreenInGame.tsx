import Leaderboard from '../Leaderboard';
import QuestionPrompt from '../QuestionPrompt';
import QuestionResults from '../QuestionResults';
import TimerBar from '../TimerBar';
import { GameState, PlayerState } from '../../types';

interface Props {
  state: GameState;
}

function answeredPlayersFor(state: GameState): (PlayerState & { isCorrect: boolean })[] {
  const currentQuestion = state.currentQuestion;
  if (!currentQuestion) return [];
  if (state.phase !== 'answer_reveal' && state.phase !== 'score') return [];
  return (state.players || [])
    .filter((p) => p.lastAnswer)
    .map((p) => {
      const isCorrect = p.lastAnswer?.optionId === currentQuestion.correctOptionId;
      return { ...p, isCorrect };
    })
    .sort((a, b) => Number(b.isCorrect) - Number(a.isCorrect));
}

export default function ScreenInGame({ state }: Props) {
  const players = state.players || [];
  const currentQuestion = state.currentQuestion;
  const answeredPlayers = answeredPlayersFor(state);

  const phaseTimer =
    state?.phaseEndsAt && state?.phaseStartedAt ? (
      <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="До следующего шага" />
    ) : null;

  const renderPhaseContent = () => {
    switch (state?.phase) {
      case 'round_intro':
        return (
          <div className="phase-card">
            <div className="phase-title">Новый раунд</div>
            {phaseTimer}
            <div className="phase-note">Готовьтесь к выбору категории</div>
          </div>
        );
      case 'category_select':
        return (
          <div className="phase-card">
            <div className="phase-title">Выбор категории</div>
            {phaseTimer}
            <div className="chip-row">
              {(state.categoryOptions || state.categories).slice(0, 4).map((cat) => (
                <div key={cat.id} className="chip neon-edge">
                  <span>{cat.icon || '📚'}</span>
                  <strong>{cat.title}</strong>
                </div>
              ))}
            </div>
          </div>
        );
      case 'category_reveal':
        return (
          <div className="phase-card">
            <div className="phase-title">Категория выбрана</div>
            {phaseTimer}
            <div className="chip-grid">
              {(state.categoryOptions?.length ? state.categoryOptions : state.categories).map((cat) => {
                const highlight = cat.id === state.activeCategoryId;
                return (
                  <div key={cat.id} className={`chip neon-edge ${highlight ? 'active' : ''}`}>
                    <span>{cat.icon || '📚'}</span>
                    <strong>{cat.title}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        );
      case 'random_event':
        return (
          <div className="phase-card">
            <div className="phase-title">Случайное событие</div>
            {phaseTimer}
            {state.activeEvent ? (
              <div className="phase-note highlight">
                <div className="big">{state.activeEvent.title}</div>
                {state.activeEvent.description && <div className="muted">{state.activeEvent.description}</div>}
              </div>
            ) : (
              <div className="phase-note">На этот раунд события нет</div>
            )}
          </div>
        );
      case 'ability_phase':
        return (
          <div className="phase-card">
            <div className="phase-title">Бафы и пакости</div>
            {phaseTimer}
            <div className="pill-row">
              {players.map((p) => (
                <div key={p.id} className={`pill ${state.preQuestionReady?.[p.id] ? 'pill-ready' : ''}`}>
                  {p.nickname}
                </div>
              ))}
            </div>
          </div>
        );
      case 'question':
        return (
          <div className="phase-card">
            {currentQuestion && <QuestionPrompt question={currentQuestion} questionStartTime={state.questionStartTime} />}
          </div>
        );
      case 'answer_reveal':
        return (
          <div className="phase-card">
            <div className="phase-title">Результаты вопроса</div>
            {phaseTimer}
            {currentQuestion && <QuestionResults question={currentQuestion} answerStats={state.answerStats || {}} />}
            {currentQuestion?.explanation && <div className="phase-note muted">{currentQuestion.explanation}</div>}
          </div>
        );
      case 'score':
        return (
          <div className="phase-card">
            <div className="phase-title">Очки за раунд</div>
            {phaseTimer}
            <Leaderboard leaderboard={state.leaderboard} players={players} characters={state?.characters || []} />
          </div>
        );
      case 'intermission':
        return (
          <div className="phase-card">
            <div className="phase-title">Перерыв</div>
            {phaseTimer}
            <div className="phase-note">Скоро начнётся мини-игра</div>
            <div className="pill-row">
              {(state.miniGamesRemaining || []).map((m) => (
                <div key={m.id} className="pill">
                  {m.title}
                </div>
              ))}
            </div>
          </div>
        );
      case 'mini_game':
        return (
          <div className="phase-card">
            <div className="phase-title">Мини-игра</div>
            {phaseTimer}
            {state.activeMiniGame ? (
              <div className="phase-note highlight">
                <div className="big">{state.activeMiniGame.title}</div>
                {state.activeMiniGame.description && <div className="muted">{state.activeMiniGame.description}</div>}
                {state.activeMiniGame.scoring && <div className="muted">{state.activeMiniGame.scoring}</div>}
              </div>
            ) : (
              <div className="phase-note">Мини-игра выбирается...</div>
            )}
          </div>
        );
      case 'next_round_confirm':
        return (
          <div className="phase-card">
            <div className="phase-title">Продолжаем?</div>
            {phaseTimer}
            <div className="phase-note">Любой игрок может начать следующий раунд</div>
          </div>
        );
      case 'game_end':
        return (
          <div className="phase-card">
            <div className="phase-title">Игра завершена</div>
            <Leaderboard leaderboard={state.leaderboard} players={players} characters={state?.characters || []} />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="screen-stack">
      {state.narration ? <div className="narration">{state.narration}</div> : null}
      {renderPhaseContent()}
      {answeredPlayers.length > 0 && (
        <div className="phase-card">
          <div className="phase-title">Ответы</div>
          <div className="answer-grid">
            {answeredPlayers.map((p) => (
              <div key={p.id} className={`answer-chip ${p.isCorrect ? 'correct' : ''}`}>
                <div className="answer-name">{p.nickname}</div>
                <div className="answer-meta">
                  {p.isCorrect ? `+${p.lastAnswer?.pointsEarned || 0} очков` : 'мимо'}
                  {currentQuestion ? (
                    <span className="muted">
                      {currentQuestion.options.find((o) => o.id === p.lastAnswer?.optionId)?.text || '—'}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {state?.leaderboard?.length && state?.phase !== 'score' && state?.phase !== 'game_end' ? (
        <div className="phase-card">
          <div className="phase-title">Лидеры</div>
          <Leaderboard leaderboard={state.leaderboard} players={players} characters={state?.characters || []} />
        </div>
      ) : null}
    </div>
  );
}
