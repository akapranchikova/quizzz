import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';

export const DEFAULT_HOLD_MS = 1100;

interface Props {
  label: string;
  onConfirm: () => void;
  holdMs?: number;
  disabled?: boolean;
  size?: number;
}

export default function HoldToConfirmButton({ label, onConfirm, holdMs = DEFAULT_HOLD_MS, disabled, size = 190 }: Props) {
  const [progress, setProgress] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  const circumference = useMemo(() => {
    const radius = 45;
    return 2 * Math.PI * radius;
  }, []);

  const resetHold = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    startTimeRef.current = null;
    setIsHolding(false);
    setProgress(0);
  };

  const step = (timestamp: number) => {
    if (!startTimeRef.current) {
      startTimeRef.current = timestamp;
    }
    const elapsed = timestamp - startTimeRef.current;
    const nextProgress = Math.min(1, elapsed / holdMs);
    setProgress(nextProgress);

    if (nextProgress >= 1) {
      onConfirm();
      resetHold();
      return;
    }

    rafRef.current = requestAnimationFrame(step);
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsHolding(true);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(step);
  };

  const handlePointerEnd = (event?: PointerEvent<HTMLButtonElement>) => {
    event?.currentTarget.releasePointerCapture?.(event.pointerId);
    resetHold();
  };

  useEffect(() => {
    resetHold();
  }, [holdMs]);

  useEffect(
    () => () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    },
    []
  );

  const showRing = isHolding && progress > 0;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div className={`hold-button ${isHolding ? 'is-holding' : ''} ${disabled ? 'is-disabled' : ''}`} style={{ ['--hold-size' as string]: `${size}px` }}>
      <button
        type="button"
        className="hold-button__core"
        disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={label}
      >
        {label}
      </button>
      {showRing ? (
        <svg className="hold-button__ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="hold-button__ring-track" cx="50" cy="50" r="45" />
          <circle
            className="hold-button__ring-progress"
            cx="50"
            cy="50"
            r="45"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
      ) : null}
    </div>
  );
}
