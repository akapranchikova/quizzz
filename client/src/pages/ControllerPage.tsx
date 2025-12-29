import { useEffect, useMemo, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { usePhaseEffects } from '../hooks/usePhaseEffects';
import { usePacedState } from '../hooks/usePacedState';
import { Ability, ActiveEvent, Category, Character, GameState, PlayerState, QuestionOption } from '../types';
import TimerBar from '../components/TimerBar';
import HoldToConfirmButton, { DEFAULT_HOLD_MS } from '../components/HoldToConfirmButton';
import { isSoundUnlocked, onSoundUnlocked, playSfx, unlockSound } from '../utils/sound';

function reorderOptions(options: QuestionOption[], order?: string[] | null) {
  if (!order || !order.length) return options;
  const lookup = Object.fromEntries(options.map((o) => [o.id, o]));
  const mapped = order.map((id) => lookup[id]).filter(Boolean) as QuestionOption[];
  const remaining = options.filter((o) => !order.includes(o.id));
  return [...mapped, ...remaining];
}

type ControllerMode = 'join' | 'ready' | 'wait_start' | 'start' | 'in_game';

export default function ControllerPage() {
  const { socket, state, connected, playerId, persistIdentity } = useSocket();
  const visualState = usePacedState(state);
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
  const [missedRound, setMissedRound] = useState<number | null>(null);
  const [soundReady, setSoundReady] = useState(isSoundUnlocked());

  const me = state?.players.find((p) => p.id === playerId);
  const myCharacter = (visualState || state)?.characters.find((c) => c.id === (me?.characterId || characterId));
  const ability: Ability | undefined = myCharacter?.ability;
  const abilityUses = me?.abilityUses?.[ability?.id || ''] ?? ability?.usesPerGame ?? 0;
  const isActivePlayer = me?.status === 'active';
  const hasAnswered = Boolean(me?.lastAnswer);
  const preparedForQuestion = me ? Boolean(state?.preQuestionReady?.[me.id] || me.preparedForQuestion) : false;
  const availableCharacters = (visualState || state)?.characters || [];
  const isCharacterSupported = availableCharacters.some((c) => c.id === characterId);

  useEffect(() => {
    return onSoundUnlocked(() => setSoundReady(true));
  }, []);

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
    if (!socket) return;
    const handleMissedRound = ({ roundIndex }: { roundIndex?: number }) => setMissedRound(roundIndex ?? 0);
    socket.on('server:you_missed_round', handleMissedRound);
    return () => {
      socket.off('server:you_missed_round', handleMissedRound);
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
    if (!state) return;
    if (state.phase !== 'question' && state.phase !== 'answer_reveal' && state.phase !== 'score') {
      setMissedRound(null);
    }
  }, [state?.phase, state?.currentQuestion?.id]);

  useEffect(() => {
    const characters = state?.characters || [];
    if (!characters.length) {
      setCharacterId('');
      return;
    }
    const first = characters[0];
    setCharacterId((prev) => {
      const exists = characters.some((c) => c.id === prev);
      return exists ? prev || first.id : first.id;
    });
  }, [state?.characters]);

  const handleUnlockSound = () => {
    if (soundReady) return;
    unlockSound();
    setSoundReady(isSoundUnlocked());
  };

  usePhaseEffects(visualState, {
    onLastSeconds: (remaining, phase) => {
      if (phase !== 'question') return;
      playSfx('tick', { volume: 0.2, rate: 1 + (3 - remaining) * 0.05 });
    },
  });

  const joinGame = () => {
    if (!socket || !nickname) return;
    playSfx('ui_tap', { volume: 0.28 });
    setJoinError('');
    socket.emit('player:join', { nickname, characterId }, (res?: { ok: boolean; error?: string; playerId?: string; resumeToken?: string }) => {
      if (!res?.ok) {
        if (res?.error) {
          setJoinError(res.error);
          const message = res.error.toLowerCase();
          const missingCharacterError = message.includes('character') || message.includes('персонаж');
          if (missingCharacterError || !availableCharacters.some((c) => c.id === characterId)) {
            const fallback = availableCharacters[0]?.id || '';
            setCharacterId(fallback);
          }
        }
        return;
      }
      if (res?.playerId && res?.resumeToken) {
        persistIdentity({ playerId: res.playerId, resumeToken: res.resumeToken });
      }
    });
  };

  const toggleReady = () => {
    playSfx('ui_tap', { volume: 0.28 });
    socket?.emit('player:ready', !me?.ready);
  };

  const startGame = () => {
    if (state?.phase !== 'game_start_confirm') return;
    playSfx('ui_tap', { volume: 0.3 });
    socket?.emit('player:startGame');
  };

  const continueNextRound = () => {
    if (state?.phase !== 'next_round_confirm') return;
    playSfx('ui_tap', { volume: 0.3 });
    socket?.emit('player:continueNextRound');
  };

  const tapMiniGame = () => {
    if (!socket || state?.phase !== 'mini_game') return;
    playSfx('ui_tap', { volume: 0.32 });
    socket.emit('player:miniGameTap');
  };

  const currentQuestion = state?.currentQuestion;
  const orderedOptions = currentQuestion ? reorderOptions(currentQuestion.options, optionOrder) : [];
  const freezeActive = freezeUntil > Date.now();
  const lockActive = Boolean(eventLock && !eventLock.cleared);

  const canAnswer = state?.phase === 'question' && !hasAnswered && !freezeActive && !lockActive && Boolean(me) && !missedRound && isActivePlayer;
  const canParticipate = Boolean(isActivePlayer && !missedRound);

  const onAnswer = (optionId: string) => {
    if (!canAnswer) return;
    playSfx('ui_tap', { volume: 0.3 });
    socket?.emit('player:answer', { optionId });
  };

  const confirmPreQuestion = () => {
    if (!socket || state?.phase !== 'ability_phase' || !canParticipate) return;
    playSfx('ui_tap', { volume: 0.24 });
    socket.emit('player:confirmPreQuestion');
  };

  const useAbility = () => {
    if (!ability || abilityUses <= 0 || state?.phase !== 'ability_phase' || !canParticipate) return false;
    if (ability.id === 'shuffle_enemy' || ability.id === 'freeze_enemy') {
      if (!targetPlayerId) {
        setInfo('Выберите цель для способности.');
        return false;
      }
    }
    playSfx('ui_tap', { volume: 0.28 });
    socket?.emit('player:useAbility', { abilityId: ability.id, targetPlayerId });
    return true;
  };

  const applyAbilityAndConfirm = () => {
    const applied = useAbility();
    if (applied) {
      confirmPreQuestion();
    }
  };

  const otherPlayers = useMemo(() => state?.players.filter((p) => p.id !== me?.id) || [], [state?.players, me]);
  const myVote = me?.id ? state?.categoryVotes?.[me.id] : undefined;
  const categoriesForVote = (visualState?.categoryOptions?.length ? visualState.categoryOptions : visualState?.categories || []).slice(0, 4);

  const voteForCategory = (categoryId: string) => {
    if (!me || !socket || state?.phase !== 'category_select' || !canParticipate) return;
    playSfx('ui_tap', { volume: 0.22 });
    socket.emit('player:voteCategory', { categoryId });
  };

  const clearEventLock = () => {
    if (!socket || !eventLock || !isActivePlayer) return;
    playSfx('ui_tap', { volume: 0.24 });
    socket.emit('player:clearEventLock');
  };

  const controllerMode: ControllerMode = useMemo(() => {
    if (!me) return 'join';
    if (visualState?.phase === 'game_start_confirm') return 'start';
    if (!me.ready) return 'ready';
    if (visualState?.phase === 'lobby' || visualState?.phase === 'ready' || visualState?.phase === 'game_end') return 'wait_start';
    return 'in_game';
  }, [me, visualState?.phase]);
  const headerCharacter = myCharacter || availableCharacters.find((c) => c.id === characterId) || null;
  const headerAccent = headerCharacter?.accent || '#22d3ee';

  return (
    <div className="controller-screen" onPointerDownCapture={handleUnlockSound}>
      {headerCharacter && (
        <div className="controller-header" style={{ ['--accent' as string]: headerAccent }}>
          <div className="controller-header__thumb">
            {headerCharacter.art ? <img src={headerCharacter.art} alt={headerCharacter.name} /> : <span>{headerCharacter.icon || '✨'}</span>}
          </div>
          <div className="controller-header__meta">
            <div className="small-muted">Ваш персонаж</div>
            <div className="controller-header__name">{headerCharacter.name}</div>
          </div>
        </div>
      )}
      {controllerMode === 'join' && (
        <ControllerJoin
          characters={state?.characters || []}
          characterId={characterId}
          nickname={nickname}
          onCharacterChange={setCharacterId}
          onJoin={joinGame}
          onNicknameChange={setNickname}
          error={joinError}
          isCharacterSupported={isCharacterSupported}
        />
      )}

      {controllerMode === 'ready' && <ControllerReadyButton onReady={toggleReady} disabled={!connected} />}

      {controllerMode === 'wait_start' && <ControllerWaitStart />}

      {controllerMode === 'start' && <ControllerStartButton onStart={startGame} />}

      {controllerMode === 'in_game' && visualState && me && (
        <ControllerInGame
          state={visualState}
          me={me}
          ability={ability}
          abilityUses={abilityUses}
          allowedOptions={allowedOptions}
          orderedOptions={orderedOptions}
          canAnswer={canAnswer}
          canParticipate={canParticipate}
          freezeActive={freezeActive}
          lockActive={lockActive}
          eventLock={eventLock}
          onAnswer={onAnswer}
          categoriesForVote={categoriesForVote}
          myVote={myVote}
          voteForCategory={voteForCategory}
          applyAbilityAndConfirm={applyAbilityAndConfirm}
          confirmPreQuestion={confirmPreQuestion}
          preparedForQuestion={preparedForQuestion}
          targetPlayerId={targetPlayerId}
          setTargetPlayerId={setTargetPlayerId}
          otherPlayers={otherPlayers}
          clearEventLock={clearEventLock}
          info={info}
          activeEvent={activeEvent}
          continueNextRound={continueNextRound}
          missedRound={missedRound}
          isActivePlayer={isActivePlayer}
          accentColor={headerAccent}
          onMiniGameTap={tapMiniGame}
        />
      )}
    </div>
  );
}

interface ControllerJoinProps {
  characters: Character[];
  nickname: string;
  characterId: string;
  onNicknameChange: (value: string) => void;
  onCharacterChange: (value: string) => void;
  onJoin: () => void;
  error?: string;
  isCharacterSupported: boolean;
}

function ControllerJoin({ characters, nickname, characterId, onNicknameChange, onCharacterChange, onJoin, error, isCharacterSupported }: ControllerJoinProps) {
  const isJoinDisabled = !nickname || !isCharacterSupported;
  return (
    <div className="controller-stage controller-stage--flow controller-stage--stack">
      <div className="controller-title">Войти</div>
      <div className="controller-stack">
        <div className="character-grid">
          {characters.map((character) => (
            <button
              key={character.id}
              type="button"
              className={`character-tile tappable ${characterId === character.id ? 'selected' : ''}`}
              onClick={() => {
                playSfx('ui_tap', { volume: 0.22 });
                onCharacterChange(character.id);
              }}
            >
              <div
                className="character-thumb"
                style={{ ['--accent' as string]: character.accent || '#22d3ee' }}
              >
                {character.art ? <img src={character.art} alt={character.name} /> : <span>{character.icon || '✨'}</span>}
              </div>
              <div className="character-name">{character.name}</div>
            </button>
          ))}
        </div>
        <div className="stacked-inputs">
          <input className="input" value={nickname} onChange={(e) => onNicknameChange(e.target.value)} placeholder="Имя" />
          <button className="button-primary cta-button primary-action controller-main-button tappable" onClick={onJoin} disabled={isJoinDisabled}>
            Войти
          </button>
        </div>
        {characters.length > 0 && !isCharacterSupported && (
          <div className="alert-warning">Этот персонаж недоступен. Выберите другого.</div>
        )}
        {error && <div className="alert-warning">{error}</div>}
      </div>
    </div>
  );
}

function ControllerReadyButton({ onReady, disabled }: { onReady: () => void; disabled?: boolean }) {
  return (
    <div className="controller-stage controller-centered">
      <button className="ready-button tappable" onClick={onReady} disabled={disabled}>
        Готов
      </button>
    </div>
  );
}

function ControllerWaitStart() {
  return (
    <div className="controller-stage controller-centered">
      <div className="wait-text">Ждём старт…</div>
    </div>
  );
}

function ControllerStartButton({ onStart }: { onStart: () => void }) {
  return (
    <div className="controller-stage controller-centered">
      <HoldToConfirmButton label="Начать" onConfirm={onStart} holdMs={DEFAULT_HOLD_MS} size={200} />
      <div className="info-banner subtle">Зажмите, чтобы начать</div>
    </div>
  );
}

interface ControllerInGameProps {
  state: GameState;
  me: PlayerState;
  ability?: Ability;
  abilityUses: number;
  allowedOptions: string[] | null;
  orderedOptions: QuestionOption[];
  canAnswer: boolean;
  canParticipate: boolean;
  freezeActive: boolean;
  lockActive: boolean;
  eventLock: PlayerState['eventLock'];
  onAnswer: (optionId: string) => void;
  categoriesForVote: Category[];
  myVote?: string;
  voteForCategory: (categoryId: string) => void;
  applyAbilityAndConfirm: () => void;
  confirmPreQuestion: () => void;
  preparedForQuestion: boolean;
  targetPlayerId: string;
  setTargetPlayerId: (id: string) => void;
  otherPlayers: PlayerState[];
  clearEventLock: () => void;
  info: string;
  activeEvent: ActiveEvent | null;
  continueNextRound: () => void;
  missedRound: number | null;
  isActivePlayer: boolean;
  accentColor: string;
  onMiniGameTap: () => void;
}

function ControllerInGame({
  state,
  me,
  ability,
  abilityUses,
  allowedOptions,
  orderedOptions,
  canAnswer,
  canParticipate,
  freezeActive,
  lockActive,
  eventLock,
  onAnswer,
  categoriesForVote,
  myVote,
  voteForCategory,
  applyAbilityAndConfirm,
  confirmPreQuestion,
  preparedForQuestion,
  targetPlayerId,
  setTargetPlayerId,
  otherPlayers,
  clearEventLock,
  info,
  activeEvent,
  continueNextRound,
  missedRound,
  isActivePlayer,
  accentColor,
  onMiniGameTap,
}: ControllerInGameProps) {
  const { phase, currentQuestion } = state;
  const [localAnswerId, setLocalAnswerId] = useState<string | null>(null);
  const [pressedOptionId, setPressedOptionId] = useState<string | null>(null);

  useEffect(() => {
    setLocalAnswerId(null);
    setPressedOptionId(null);
  }, [currentQuestion?.id]);
  const statusBanner = (
    <>
      {!isActivePlayer && <div className="info-banner">Соединение потеряно, восстанавливаем участие…</div>}
      {missedRound !== null && <div className="info-banner">Вы пропустили этот вопрос. Ждём следующий раунд…</div>}
    </>
  );

  if (phase === 'next_round_confirm') {
    return (
      <div className="controller-stage controller-centered">
        {statusBanner}
        <HoldToConfirmButton label="Продолжить" onConfirm={continueNextRound} holdMs={DEFAULT_HOLD_MS} size={190} />
        <div className="info-banner subtle">Удерживайте, чтобы идти дальше</div>
      </div>
    );
  }

  if (phase === 'category_select') {
    return (
      <div className="controller-stage controller-stage--flow controller-stage--stack">
        {state.phaseStartedAt && state.phaseEndsAt && (
          <TimerBar
            startsAt={state.phaseStartedAt}
            endsAt={state.phaseEndsAt}
            label="Выбор"
            accent={accentColor}
          />
        )}
        {statusBanner}
        <div className="controller-stack">
          <div className="controller-title">Ваш выбор</div>
          <div className="mobile-answer-grid">
            {categoriesForVote.map((cat) => {
              const isMine = myVote === cat.id;
              return (
                <button
                  key={cat.id}
                  className={`option-button mobile-option tappable ${isMine ? 'option-selected' : ''}`}
                  onClick={() => voteForCategory(cat.id)}
                  disabled={phase !== 'category_select' || !canParticipate}
                >
                  <div className="option-title">{cat.icon || '📚'} {cat.title}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'mini_game') {
    const signalAt = state.miniGameState?.signalAt || 0;
    const isSignaled = signalAt > 0 && Date.now() >= signalAt;
    const winners = state.miniGameState?.winners || [];
    const roster = me ? [me, ...otherPlayers] : otherPlayers;
    return (
      <div className="controller-stage controller-centered">
        <div className={`mini-game-prompt ${isSignaled ? 'mini-game-prompt--ready' : ''}`} onClick={onMiniGameTap}>
          <div className="mini-game-prompt__ring" />
          <div className="mini-game-prompt__label">{isSignaled ? 'ЖМИ' : 'Жди'}</div>
        </div>
        {winners.length > 0 && (
          <div className="info-banner subtle">
            Быстрее всех: {winners.map((id) => roster.find((p) => p.id === id)?.nickname || 'Игрок').join(', ')}
          </div>
        )}
      </div>
    );
  }

  if (phase === 'ability_phase') {
    return (
      <div className="controller-stage controller-stage--flow controller-stage--stack">
        <div className="controller-title">Подготовка</div>
        {statusBanner}
        <div className="ability-card mobile-ability">
          <div className="ability-name">{ability ? ability.name : 'Способности недоступны'}</div>
          {ability && <div className="small-muted">{ability.description}</div>}
          {ability && <div className="small-muted">Осталось: {abilityUses}</div>}
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
          <div className="stacked-inputs" style={{ marginTop: 12 }}>
            {ability && ability.id !== 'shield' && (
              <button className="button-primary cta-button controller-main-button tappable" onClick={applyAbilityAndConfirm} disabled={preparedForQuestion || abilityUses <= 0 || !canParticipate}>
                Применить
              </button>
            )}
            <button className="button-primary cta-button controller-main-button tappable" onClick={confirmPreQuestion} disabled={preparedForQuestion || !canParticipate}>
              {preparedForQuestion ? 'Готово' : 'Пропустить'}
            </button>
          </div>
        </div>
        {info && <div className="info-banner">{info}</div>}
      </div>
    );
  }

  if (phase === 'question' && currentQuestion) {
    const timeLimitMs = (currentQuestion.timeLimitSec || 15) * 1000;
    const endsAt = state.questionStartTime ? state.questionStartTime + timeLimitMs : null;
    const selectedOptionId = me.lastAnswer?.optionId || localAnswerId;
    const canTapAnswer = canAnswer && !localAnswerId && !me.lastAnswer;

    const handleAnswerTap = (optionId: string) => {
      if (!canTapAnswer) return;
      setLocalAnswerId(optionId);
      onAnswer(optionId);
    };

    const handlePressStart = (optionId: string, disabled: boolean) => {
      if (disabled) return;
      setPressedOptionId(optionId);
    };

    const handlePressEnd = () => setPressedOptionId(null);

    return (
      <div className="controller-stage controller-stage--flow controller-stage--stack controller-question-stage">
        {endsAt && state.questionStartTime && (
          <TimerBar
            startsAt={state.questionStartTime}
            endsAt={endsAt}
            showTimeText={false}
            className="controller-timer timer-bar--compact"
            accent={accentColor}
          />
        )}
          {statusBanner}
        <div className="controller-question-meta">
          {currentQuestion.text && <div className="question-hint">{currentQuestion.text}</div>}
          <div className="controller-status-row">
            {freezeActive && <span className="status-chip">Заморозка активна</span>}
            {lockActive && (
              <span className="status-chip">
                {eventLock?.type === 'mud' ? 'Экран заляпан' : 'Лёд блокирует ответы'}
                <button className="status-action" onClick={clearEventLock} type="button">
                  Очистить
                </button>
              </span>
            )}
            {info && <span className="status-chip subtle">{info}</span>}
          </div>
        </div>
        <div className="controller-answer-grid">
          {orderedOptions.map((opt, index) => {
            const label = String.fromCharCode(65 + index);
            const blockedByAbility = allowedOptions && !allowedOptions.includes(opt.id);
            const isSelected = selectedOptionId === opt.id;
            const isPressed = pressedOptionId === opt.id;
            const isDisabled = !canTapAnswer || Boolean(blockedByAbility);
            const classNames = [
              'answer-button',
              isSelected ? 'answer-selected' : '',
              isPressed ? 'answer-pressed' : '',
              isDisabled ? 'answer-disabled' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                key={opt.id}
                className={classNames}
                disabled={isDisabled}
                onPointerDown={() => handlePressStart(opt.id, isDisabled)}
                onPointerUp={handlePressEnd}
                onPointerLeave={handlePressEnd}
                onPointerCancel={handlePressEnd}
                onClick={() => handleAnswerTap(opt.id)}
                type="button"
              >
                <div className="answer-label">{label}</div>
                <div className="answer-text">{opt.text}</div>
              </button>
            );
          })}
        </div>
        {selectedOptionId && <div className="info-banner subtle">Ответ принят</div>}
      </div>
    );
  }

  if (phase === 'answer_reveal' || phase === 'score') {
    return (
      <div className="controller-stage controller-centered">
        {statusBanner}
        <div className="wait-text">Ответ принят</div>
        {info && <div className="info-banner" style={{ marginTop: 8 }}>{info}</div>}
      </div>
    );
  }

  return (
    <div className="controller-stage controller-centered">
      {statusBanner}
      <div className="wait-text">Смотрите на экран</div>
      {activeEvent && <div className="info-banner" style={{ marginTop: 10 }}>{activeEvent.title}</div>}
    </div>
  );
}
