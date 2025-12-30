import Leaderboard from '../Leaderboard';
import QuestionPrompt from '../QuestionPrompt';
import QuestionResults from '../QuestionResults';
import TimerBar from '../TimerBar';
import { Category, GameState } from '../../types';
import MiniGameScreen from '../MiniGameScreen';

interface Props {
  state: GameState;
  activeCategory: Category | null;
  accent?: string;
  impact?: GameState['recentImpact'] | null;
  finale?: boolean;
}

export default function ScreenInGame({ state, activeCategory, accent, impact, finale }: Props) {
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
          <div className="phase-card phase-card--quiet">
            <div className="hero-text">Раунд {state.roundNumber}</div>
            <div className="pulse-dot" />
          </div>
        );
      case 'category_select': {
        const categories = (state.categoryOptions || state.categories).slice(0, 4);
        return (
          <div className="phase-card category-select">
            <div className="phase-chip subtle">Выберите категорию</div>
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
                  <div className="screen-message muted">Вдохните</div>
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
              <div className="phase-note highlight pulse">
                <div className="big">{state.activeEvent.title}</div>
                <div className="muted subtle">Эффект накрывает игроков</div>
              </div>
            ) : (
              <div className="phase-note">События нет — поехали</div>
            )}
          </div>
        );
      case 'ability_phase':
        return (
          <div className="phase-card">
            <div className="hero-text">Подготовка</div>
            <div className="pill-row pill-row--tight">
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
              impact={impact}
            />
          </div>
        );
      case 'intermission':
        return (
          <div className="phase-card">
            <div className="hero-text">Передышка</div>
            <div className="screen-message muted">Следом — мини-рывок</div>
          </div>
        );
      case 'mini_game':
        return <MiniGameScreen state={state} players={players} characters={state?.characters || []} />;
      case 'next_round_confirm':
        return (
          <div className="phase-card">
            <div className="hero-text">Далее?</div>
            <div className="screen-message muted">Ждём удержание</div>
          </div>
        );
      case 'game_end':
        return (
          <div className="phase-card">
            <div className="hero-text">Финал</div>
            <Leaderboard
              leaderboard={state.leaderboard}
              players={players}
              characters={state?.characters || []}
              highlight
              impact={impact}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`screen-stack ${finale ? 'screen-stack--finale' : ''}`}>
      {/*{state.narration ? <div className="narration">{state.narration}</div> : null}*/}
      {renderPhaseContent()}
    </div>
  );
}
