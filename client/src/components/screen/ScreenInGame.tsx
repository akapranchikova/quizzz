import Leaderboard from '../Leaderboard';
import QuestionPrompt from '../QuestionPrompt';
import QuestionResults from '../QuestionResults';
import TimerBar from '../TimerBar';
import { Category, GameState } from '../../types';

interface Props {
  state: GameState;
  activeCategory: Category | null;
  accent?: string;
}

export default function ScreenInGame({ state, activeCategory, accent }: Props) {
  const players = state.players || [];
  const currentQuestion = state.currentQuestion;

  const shouldShowTimer = state?.phase === 'category_select';
  const phaseTimer =
    shouldShowTimer && state?.phaseEndsAt && state?.phaseStartedAt ? (
      <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} showTimeText={false} accent={accent} />
    ) : null;

  const renderPhaseContent = () => {
    switch (state?.phase) {
      case 'round_intro':
        return (
          <div className="phase-card">
            <div className="hero-text">Новый раунд</div>
            <div className="screen-message muted">Готовьтесь к выбору категории</div>
          </div>
        );
      case 'category_select': {
        const categories = (state.categoryOptions || state.categories).slice(0, 4);
        return (
          <div className="phase-card category-select">
            <div className="category-grid">
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  className="category-card neon-edge"
                  style={{ ['--accent' as string]: cat.accent || '#8b5cf6' }}
                >
                  <div className="category-thumb">{cat.art ? <img src={cat.art} alt={cat.title} /> : <span>{cat.icon || '📚'}</span>}</div>
                  <div className="category-title">{cat.title}</div>
                </div>
              ))}
            </div>
            <div className="screen-message muted">Выберите категорию на своих устройствах</div>
            {phaseTimer}
          </div>
        );
      }
      case 'category_reveal': {
        const availableCategories = state.categoryOptions?.length ? state.categoryOptions : state.categories;
        const activeCategory = availableCategories.find((cat) => cat.id === state.activeCategoryId);
        return (
          <div className="phase-card">
            {activeCategory && (
              <div
                className="category-reveal"
                style={{ ['--accent' as string]: activeCategory.accent || '#8b5cf6' }}
              >
                <div className="category-reveal__thumb">
                  {activeCategory.art ? (
                    <img src={activeCategory.art} alt={activeCategory.title} />
                  ) : (
                    <span>{activeCategory.icon || '📚'}</span>
                  )}
                </div>
                <div className="category-reveal__meta">
                  <div className="pill pill-ghost">Категория</div>
                  <div className="hero-text">{activeCategory.title}</div>
                  <div className="screen-message muted">Готовьтесь к вопросу</div>
                </div>
              </div>
            )}
          </div>
        );
      }
      case 'random_event':
        return (
          <div className="phase-card">
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
            <div className="hero-text">Подготовка</div>
            <div className="screen-message muted">Настройте способности перед вопросом</div>
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
            {currentQuestion && (
              <>
                <div className="phase-header">
                  <div className="phase-chip">Вопрос</div>
                  {activeCategory && (
                    <div className="category-chip" style={{ ['--accent' as string]: activeCategory.accent || '#22d3ee' }}>
                      <div className="category-chip__thumb">
                        {activeCategory.art ? (
                          <img src={activeCategory.art} alt={activeCategory.title} />
                        ) : (
                          <span>{activeCategory.icon || '📚'}</span>
                        )}
                      </div>
                      <span>{activeCategory.title}</span>
                    </div>
                  )}
                </div>
                <QuestionPrompt
                  question={currentQuestion}
                  questionStartTime={state.questionStartTime}
                  accent={activeCategory?.accent || accent}
                />
              </>
            )}
          </div>
        );
      case 'answer_reveal':
        return (
          <div className="phase-card">
            {currentQuestion && (
              <QuestionResults
                question={currentQuestion}
                answerStats={state.answerStats || {}}
                accent={activeCategory?.accent}
              />
            )}
            {currentQuestion?.explanation && <div className="phase-note muted">{currentQuestion.explanation}</div>}
          </div>
        );
      case 'score':
        return (
          <div className="phase-card">
            <Leaderboard
              leaderboard={state.leaderboard}
              players={players}
              characters={state?.characters || []}
              highlight
            />
          </div>
        );
      case 'intermission':
        return (
          <div className="phase-card">
            <div className="hero-text">Перерыв</div>
            <div className="screen-message muted">Скоро начнётся мини-игра</div>
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
            <div className="hero-text">Готовы продолжить</div>
            <div className="screen-message muted">Любой игрок может начать следующий раунд</div>
          </div>
        );
      case 'game_end':
        return (
          <div className="phase-card">
            <div className="hero-text">Игра завершена</div>
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
    </div>
  );
}
