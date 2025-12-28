import { useEffect, useState } from 'react';

interface Props {
  startsAt?: number | null;
  endsAt: number | null;
  label?: string;
  showTimeText?: boolean;
}

export default function TimerBar({ startsAt, endsAt, label, showTimeText = true }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [endsAt]);

  if (!endsAt || !startsAt) {
    return null;
  }

  const total = Math.max(1000, endsAt - startsAt);
  const remaining = Math.max(0, endsAt - now);
  const progress = Math.max(0, Math.min(1, remaining / total));
  const seconds = Math.ceil(remaining / 1000);

  return (
    <div className="timer-bar" aria-label="timer">
      <div className="timer-inner" style={{ width: `${progress * 100}%` }} />
      {showTimeText && (
        <div className="small-muted" style={{ marginTop: 6 }}>
          {label || 'Таймер'}: осталось {seconds} сек
        </div>
      )}
    </div>
  );
}
