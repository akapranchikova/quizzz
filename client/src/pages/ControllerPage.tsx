import { useEffect, useMemo, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { Ability, ActiveEvent, QuestionOption } from '../types';
import TimerBar from '../components/TimerBar';

function reorderOptions(options: QuestionOption[], order?: string[] | null) {
  if (!order || !order.length) return options;
  const lookup = Object.fromEntries(options.map((o) => [o.id, o]));
  const mapped = order.map((id) => lookup[id]).filter(Boolean) as QuestionOption[];
  const remaining = options.filter((o) => !order.includes(o.id));
  return [...mapped, ...remaining];
}

export default function ControllerPage() {
  const { socket, state, connected } = useSocket();
  const [nickname, setNickname] = useState('');
  const [characterId, setCharacterId] = useState('spark');
  const [targetPlayerId, setTargetPlayerId] = useState('');
  const [allowedOptions, setAllowedOptions] = useState<string[] | null>(null);
  const [optionOrder, setOptionOrder] = useState<string[] | null>(null);
  const [freezeUntil, setFreezeUntil] = useState(0);
  const [eventLock, setEventLock] = useState<{ type: string; cleared?: boolean } | null>(null);
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
  const [info, setInfo] = useState('');
  const [joinError, setJoinError] = useState('');

  const me = state?.players.find((p) => p.id === socket?.id);
  const myCharacter = state?.characters.find((c) => c.id === (me?.characterId || characterId));
  const ability: Ability | undefined = myCharacter?.ability;
  const abilityUses = me?.abilityUses?.[ability?.id || ''] ?? ability?.usesPerGame ?? 0;
  const canUseAbility = abilityUses > 0 && state?.phase === 'ability_phase';
  const hasAnswered = Boolean(me?.lastAnswer);
  const preparedForQuestion = me ? Boolean(state?.preQuestionReady?.[me.id] || me.preparedForQuestion) : false;

  useEffect(() => {
    if (!socket) return;
    const handleFifty = ({ allowedOptions: options }: { allowedOptions: string[] }) => setAllowedOptions(options);
    const handleShuffle = ({ order, from }: { order: string[]; from?: string }) => {
      setOptionOrder(order);
      setInfo(`Ответы перемешал ${from || 'другой игрок'}`);
    };
    const handleFreeze = ({ durationMs, from }: { durationMs: number; from?: string }) => {
      setFreezeUntil(Date.now() + durationMs);
      setInfo(`Заморозка от ${from || 'соперника'} на ${Math.round(durationMs / 1000)} сек`);
    };
    const handleShield = () => setInfo('Щит поглотил пакость!');
    const handleBlocked = () => setInfo('Пока нельзя ответить (заморозка).');
    const handleEventApplied = (payload: ActiveEvent) => {
      setActiveEvent(payload);
      if (payload.effect === 'ice' || payload.effect === 'mud') {
        setEventLock({ type: payload.effect, cleared: false });
        setInfo(payload.effect === 'ice' ? 'Лёд блокирует ответы' : 'Экран заляпан — очистите его');
      }
      if (payload.effect === 'double_points') {
        setInfo('Двойные очки за следующий верный ответ!');
      }
      if (payload.effect === 'event_shield') {
        setInfo('Вы получили щит от ближайшей пакости');
      }
    };
    const handleEventShuffle = ({ order, from }: { order: string[]; from?: string }) => {
      setOptionOrder(order);
      setInfo(`Ответы хаотично перемешаны (${from || 'событие'})`);
    };
    const handleLockCleared = () => {
      setEventLock(null);
      setInfo('Эффект очищен, можно отвечать');
    };
    const handleEventShielded = () => setInfo('Щит от события поглотил пакость');

    socket.on('ability:fifty', handleFifty);
    socket.on('ability:shuffleOptions', handleShuffle);
    socket.on('ability:freeze', handleFreeze);
    socket.on('ability:shieldTriggered', handleShield);
    socket.on('player:blocked', handleBlocked);
    socket.on('event:applied', handleEventApplied);
    socket.on('event:shuffleOptions', handleEventShuffle);
    socket.on('event:lockCleared', handleLockCleared);
    socket.on('event:shielded', handleEventShielded);

    return () => {
      socket.off('ability:fifty', handleFifty);
      socket.off('ability:shuffleOptions', handleShuffle);
      socket.off('ability:freeze', handleFreeze);
      socket.off('ability:shieldTriggered', handleShield);
      socket.off('player:blocked', handleBlocked);
      socket.off('event:applied', handleEventApplied);
      socket.off('event:shuffleOptions', handleEventShuffle);
      socket.off('event:lockCleared', handleLockCleared);
      socket.off('event:shielded', handleEventShielded);
    };
  }, [socket]);

  useEffect(() => {
    setAllowedOptions(null);
    setOptionOrder(null);
    setFreezeUntil(0);
    setInfo('');
    setActiveEvent(null);
  }, [state?.currentQuestion?.id, state?.phase]);

  useEffect(() => {
    setEventLock(me?.eventLock || null);
  }, [me?.eventLock]);

  useEffect(() => {
    if (!state?.characters.length) return;
    const first = state.characters[0];
    setCharacterId((prev) => prev || first.id);
  }, [state?.characters]);

  const joinGame = () => {
    if (!socket || !nickname) return;
    setJoinError('');
    socket.emit('player:join', { nickname, characterId }, (res?: { ok: boolean; error?: string }) => {
      if (!res?.ok && res?.error) {
        setJoinError(res.error);
      }
    });
  };

  const toggleReady = () => {
    socket?.emit('player:ready', !me?.ready);
  };

  const startGame = () => {
    if (state?.phase !== 'game_start_confirm') return;
    socket?.emit('player:startGame');
  };

  const continueNextRound = () => {
    if (state?.phase !== 'next_round_confirm') return;
    socket?.emit('player:continueNextRound');
  };

  const currentQuestion = state?.currentQuestion;
  const orderedOptions = currentQuestion ? reorderOptions(currentQuestion.options, optionOrder) : [];
  const freezeActive = freezeUntil > Date.now();
  const lockActive = Boolean(eventLock && !eventLock.cleared);

  const canAnswer = state?.phase === 'question' && !hasAnswered && !freezeActive && !lockActive && Boolean(me);

  const onAnswer = (optionId: string) => {
    if (!canAnswer) return;
    socket?.emit('player:answer', { optionId });
  };

  const confirmPreQuestion = () => {
    if (!socket || state?.phase !== 'ability_phase') return;
    socket.emit('player:confirmPreQuestion');
  };

  const useAbility = () => {
    if (!ability || abilityUses <= 0 || state?.phase !== 'ability_phase') return false;
    if (ability.id === 'shuffle_enemy' || ability.id === 'freeze_enemy') {
      if (!targetPlayerId) {
        setInfo('Выберите цель для способности.');
        return false;
      }
    }
    socket?.emit('player:useAbility', { abilityId: ability.id, targetPlayerId });
    return true;
  };

  const applyAbilityAndConfirm = () => {
    const applied = useAbility();
    if (applied) {
      confirmPreQuestion();
    }
  };

  const renderQuestion = () => {
    if (!currentQuestion || state?.phase !== 'question') return null;
    const timeLimitMs = (currentQuestion.timeLimitSec || 15) * 1000;
    const endsAt = state.questionStartTime ? state.questionStartTime + timeLimitMs : null;
    return (
      <div className="mobile-card" style={{ marginTop: 16 }}>
        <p className="question-title">{currentQuestion.text}</p>
        {endsAt && state.questionStartTime && <TimerBar startsAt={state.questionStartTime} endsAt={endsAt} label="Время на ответ" />}
        {freezeActive && (
          <div className="alert-warning" style={{ marginBottom: 8, padding: 10 }}>Заморозка активна</div>
        )}
        {lockActive && (
          <div className="alert-warning" style={{ marginBottom: 8, padding: 10 }}>
            {eventLock?.type === 'mud' ? 'Ответы заляпаны — очистите экран' : 'Лёд блокирует ответы'}
            <button className="button-primary cta-button" style={{ marginTop: 8 }} onClick={clearEventLock}>
              Очистить/разбить
            </button>
          </div>
        )}
        <div className="mobile-answer-grid">
          {orderedOptions.map((opt) => {
            const disabled = !canAnswer || (allowedOptions && !allowedOptions.includes(opt.id));
            return (
              <button
                key={opt.id}
                className="option-button mobile-option"
                disabled={disabled}
                onClick={() => onAnswer(opt.id)}
                style={{
                  borderColor: me?.lastAnswer?.optionId === opt.id ? '#22d3ee' : undefined,
                  opacity: allowedOptions && !allowedOptions.includes(opt.id) ? 0.4 : undefined,
                }}
              >
                {opt.text}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const otherPlayers = useMemo(() => state?.players.filter((p) => p.id !== me?.id) || [], [state?.players, me]);
  const myVote = me?.id ? state?.categoryVotes?.[me.id] : undefined;
  const voteStats = state?.categoryVoteStats || {};
  const categoriesForVote = (state?.categoryOptions?.length ? state.categoryOptions : state?.categories || []).slice(0, 4);

  const statusMessage = () => {
    switch (state?.phase) {
      case 'ready':
        return 'Нажмите «Готов», как только будете на связи.';
      case 'game_start_confirm':
        return 'Все подтвердили. Любой игрок может начать игру.';
      case 'category_select':
        return 'Выбираем категорию. Итоги сразу после голосов.';
      case 'category_reveal':
        return 'Категория выбрана. Готовимся.';
      case 'round_intro':
        return 'Новый раунд сейчас начнётся.';
      case 'random_event':
        return 'Случайное событие — смотрите на экран.';
      case 'ability_phase':
        return 'Бафы и пакости только сейчас — решайте.';
      case 'question':
        return 'Отвечайте быстрее на вопрос!';
      case 'answer_reveal':
        return 'Смотрите результаты на экране.';
      case 'score':
        return 'Очки начисляются...';
      case 'intermission':
        return 'Перерыв перед мини-игрой.';
      case 'mini_game':
        return 'Сервер запускает мини-игру.';
      case 'next_round_confirm':
        return 'Любой игрок может начать следующий раунд.';
      default:
        return 'Ждём остальных игроков и старт';
    }
  };

  const voteForCategory = (categoryId: string) => {
    if (!me || !socket || state?.phase !== 'category_select') return;
    socket.emit('player:voteCategory', { categoryId });
  };

  const clearEventLock = () => {
    if (!socket || !eventLock) return;
    socket.emit('player:clearEventLock');
  };

  return (
    <div className="controller-shell">
      <div className="mobile-card">
        <div className="status-line">
          <div className="status-pill">
            <span>{connected ? 'Подключено' : 'Ожидание соединения'}</span>
            {state?.phase && <span className="badge">Стадия: {state.phase}</span>}
          </div>
          {me && <div className="badge">Очки: {me.score}</div>}
        </div>
        {state?.phaseEndsAt && state?.phaseStartedAt && (
          <TimerBar startsAt={state.phaseStartedAt} endsAt={state.phaseEndsAt} label="Таймер стадии" />
        )}
        {activeEvent && (
          <div className="alert" style={{ marginTop: 8 }}>
            {activeEvent.kind === 'malus' ? 'Пакость' : 'Баф'}: {activeEvent.title}
            {activeEvent.description && <div className="small-muted">{activeEvent.description}</div>}
          </div>
        )}

        {!me && (
          <div className="stacked-inputs">
            <input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Никнейм" />
            <select className="input" value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
              {state?.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.ability ? `(${c.ability.name})` : ''}
                </option>
              ))}
            </select>
            <button className="button-primary cta-button" onClick={joinGame} disabled={!nickname}>
              Войти в игру
            </button>
            {joinError && <div className="alert-warning">{joinError}</div>}
          </div>
        )}

        {me && (
          <div className="stacked-inputs">
            <button
              className="button-primary cta-button"
              onClick={toggleReady}
              disabled={!(state?.phase === 'lobby' || state?.phase === 'ready' || state?.phase === 'game_end')}
            >
              {me.ready ? 'Не готов' : 'Готов'}
            </button>
            <div className="small-muted">{statusMessage()}</div>
          </div>
        )}

        {me && state?.phase === 'game_start_confirm' && (
          <div className="stacked-inputs">
            <button className="button-primary cta-button" onClick={startGame}>
              Начать игру
            </button>
            <div className="small-muted">Любой игрок может нажать.</div>
          </div>
        )}

        {me && state?.phase === 'category_select' && (
          <div className="mobile-card" style={{ marginTop: 12 }}>
            <div className="section-title" style={{ marginBottom: 8 }}>
              Голосуйте за категорию
            </div>
            <div className="mobile-answer-grid">
              {categoriesForVote.map((cat) => {
                const votes = voteStats[cat.id] || 0;
                const isMine = myVote === cat.id;
                return (
                  <button
                    key={cat.id}
                    className="option-button mobile-option"
                    onClick={() => voteForCategory(cat.id)}
                    disabled={state.phase !== 'category_select'}
                    style={{
                      borderColor: isMine ? '#22d3ee' : undefined,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      {cat.icon || '📚'} {cat.title}
                    </div>
                    <div className="small-muted">Голоса: {votes}</div>
                  </button>
                );
              })}
            </div>
            <div className="small-muted" style={{ marginTop: 8 }}>
              Категория выбирается по большинству голосов игроков. При равенстве — случайно.
            </div>
          </div>
        )}

        {me && state?.phase === 'ability_phase' && (
          <div className="ability-card mobile-ability">
            <div style={{ fontWeight: 700 }}>{ability ? ability.name : 'Подготовка к вопросу'}</div>
            <div className="small-muted">{ability ? ability.description : 'Бафы и пакости применяются только сейчас.'}</div>
            {ability && <div className="small-muted">Осталось использований: {abilityUses}</div>}
            {(ability?.id === 'shuffle_enemy' || ability?.id === 'freeze_enemy') && (
              <select className="input" value={targetPlayerId} onChange={(e) => setTargetPlayerId(e.target.value)} style={{ marginTop: 8 }}>
                <option value="">Выберите цель</option>
                {otherPlayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nickname}
                  </option>
                ))}
              </select>
            )}
            {ability?.id === 'shield' && (
              <div className="alert" style={{ marginTop: 8 }}>
                Пассивно: срабатывает при первой пакости.
              </div>
            )}
            <div className="stacked-inputs" style={{ marginTop: 10 }}>
              {ability && ability.id !== 'shield' && (
                <button className="button-primary cta-button" onClick={applyAbilityAndConfirm} disabled={!canUseAbility || preparedForQuestion}>
                  Применить
                </button>
              )}
              <button className="button-primary cta-button" onClick={confirmPreQuestion} disabled={preparedForQuestion}>
                {preparedForQuestion ? 'Готово' : 'Пропустить'}
              </button>
            </div>
          </div>
        )}

        {me && state?.phase === 'next_round_confirm' && (
          <div className="stacked-inputs" style={{ marginTop: 12 }}>
            <button className="button-primary cta-button" onClick={continueNextRound}>
              Продолжить
            </button>
            <div className="small-muted">Любой игрок может начать следующий раунд.</div>
          </div>
        )}

        {info && <div className="alert" style={{ marginTop: 10 }}>{info}</div>}
        {lockActive && state?.phase !== 'question' && (
          <div className="alert-warning" style={{ marginTop: 10, padding: 10 }}>
            Эффект события блокирует ответы.
            <button className="button-primary cta-button" style={{ marginTop: 8 }} onClick={clearEventLock}>
              Снять эффект
            </button>
          </div>
        )}
      </div>

      {renderQuestion()}

      {state?.phase && state.phase !== 'question' && state.phase !== 'game_end' && (
        <div className="mobile-card" style={{ marginTop: 16 }}>
          <div className="small-muted">
            {state?.phase === 'category_select'
              ? 'Идёт выбор категории'
              : state?.phase === 'game_start_confirm'
                ? 'Ждём, кто нажмёт «Начать»'
                : state?.phase === 'ability_phase'
                  ? 'Окно способностей перед вопросом'
                  : state?.phase === 'next_round_confirm'
                    ? 'Подтвердите продолжение раунда'
                    : state?.phase === 'intermission'
                      ? 'Мини-игра начинается на экране'
                      : 'Смотрите на экран: скоро следующий вопрос'}
          </div>
        </div>
      )}
    </div>
  );
}
