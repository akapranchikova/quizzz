import { useEffect, useMemo, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { Ability, QuestionOption } from '../types';
import PlayerList from '../components/PlayerList';

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
  const [info, setInfo] = useState('');

  const me = state?.players.find((p) => p.id === socket?.id);
  const myCharacter = state?.characters.find((c) => c.id === (me?.characterId || characterId));
  const ability: Ability | undefined = myCharacter?.ability;
  const abilityUses = me?.abilityUses?.[ability?.id || ''] ?? ability?.usesPerGame ?? 0;
  const hasAnswered = Boolean(me?.lastAnswer);

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

    socket.on('ability:fifty', handleFifty);
    socket.on('ability:shuffleOptions', handleShuffle);
    socket.on('ability:freeze', handleFreeze);
    socket.on('ability:shieldTriggered', handleShield);
    socket.on('player:blocked', handleBlocked);

    return () => {
      socket.off('ability:fifty', handleFifty);
      socket.off('ability:shuffleOptions', handleShuffle);
      socket.off('ability:freeze', handleFreeze);
      socket.off('ability:shieldTriggered', handleShield);
      socket.off('player:blocked', handleBlocked);
    };
  }, [socket]);

  useEffect(() => {
    setAllowedOptions(null);
    setOptionOrder(null);
    setFreezeUntil(0);
    setInfo('');
  }, [state?.currentQuestion?.id, state?.phase]);

  useEffect(() => {
    if (!state?.characters.length) return;
    const first = state.characters[0];
    setCharacterId((prev) => prev || first.id);
  }, [state?.characters]);

  const joinGame = () => {
    if (!socket || !nickname) return;
    socket.emit('player:join', { nickname, characterId });
  };

  const toggleReady = () => {
    socket?.emit('player:ready', !me?.ready);
  };

  const currentQuestion = state?.currentQuestion;
  const orderedOptions = currentQuestion ? reorderOptions(currentQuestion.options, optionOrder) : [];
  const freezeActive = freezeUntil > Date.now();

  const canAnswer = state?.phase === 'question' && !hasAnswered && !freezeActive && Boolean(me);

  const onAnswer = (optionId: string) => {
    if (!canAnswer) return;
    socket?.emit('player:answer', { optionId });
  };

  const useAbility = () => {
    if (!ability || abilityUses <= 0 || state?.phase !== 'question') return;
    if (ability.id === 'shuffle_enemy' || ability.id === 'freeze_enemy') {
      if (!targetPlayerId) {
        setInfo('Выберите цель для способности.');
        return;
      }
    }
    socket?.emit('player:useAbility', { abilityId: ability.id, targetPlayerId });
  };

  const renderQuestion = () => {
    if (!currentQuestion) return null;
    return (
      <div className="mobile-card" style={{ marginTop: 16 }}>
        <p className="question-title">{currentQuestion.text}</p>
        {state?.phase === 'question' && freezeActive && (
          <div className="alert-warning" style={{ marginBottom: 8, padding: 10 }}>Заморозка активна</div>
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

  const statusMessage = () => {
    if (state?.phase === 'category_pick') return 'Ожидайте: на экране выбирают категорию';
    if (state?.phase === 'question') return 'Смотрите на варианты ниже и жмите быстрее!';
    if (state?.phase === 'reveal') return 'Смотрите на экран: показываются ответы';
    return 'Ждём остальных игроков и старт';
  };

  const isHost = state?.hostPlayerId === me?.id;
  const everyoneReady = (state?.players || []).length > 0 && (state?.players || []).every((p) => p.ready);

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
          </div>
        )}

        {me && (
          <div className="stacked-inputs">
            <button className="button-primary cta-button" onClick={toggleReady} disabled={state?.phase !== 'lobby'}>
              {me.ready ? 'Не готов' : 'Готов'}
            </button>
            {isHost && state?.phase === 'lobby' && (
              <button className="button-primary cta-button" disabled={!everyoneReady} onClick={() => socket?.emit('player:startGame')}>
                Начать игру (я первый)
              </button>
            )}
            <div className="small-muted">{statusMessage()}</div>
          </div>
        )}

        {ability && me && (
          <div className="ability-card mobile-ability">
            <div style={{ fontWeight: 700 }}>{ability.name}</div>
            <div className="small-muted">{ability.description}</div>
            <div className="small-muted">Осталось использований: {abilityUses}</div>
            {(ability.id === 'shuffle_enemy' || ability.id === 'freeze_enemy') && (
              <select className="input" value={targetPlayerId} onChange={(e) => setTargetPlayerId(e.target.value)} style={{ marginTop: 8 }}>
                <option value="">Выберите цель</option>
                {otherPlayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nickname}
                  </option>
                ))}
              </select>
            )}
            {ability.id === 'shield' ? (
              <div className="alert" style={{ marginTop: 8 }}>
                Пассивно: срабатывает при первой пакости.
              </div>
            ) : (
              <button className="button-primary cta-button" style={{ marginTop: 8 }} onClick={useAbility} disabled={abilityUses <= 0 || state?.phase !== 'question'}>
                Использовать способность
              </button>
            )}
          </div>
        )}

        {info && <div className="alert" style={{ marginTop: 10 }}>{info}</div>}
      </div>

      {renderQuestion()}

      {state?.phase !== 'question' && (
        <div className="mobile-card" style={{ marginTop: 16 }}>
          <div className="small-muted">Смотрите на экран: {state?.phase === 'category_pick' ? 'идёт выбор категории' : 'ожидаем следующий вопрос'}</div>
          {state?.players?.length ? (
            <PlayerList players={state.players || []} characters={state.characters || []} showReady={true} showScore={true} />
          ) : null}
        </div>
      )}
    </div>
  );
}
