'use client';

import { useCallback, useEffect, useState } from 'react';
import { WS5_COPY } from '@declutrmail/shared/copy/launch';
import { useNow } from '@/lib/use-now';
import styles from './cleanup-preview.module.css';

export function isFutureReturnTime(value: string | null | undefined): value is string {
  return value != null && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
}

/** Keep confirmation current when the chosen return expires while the preview is idle. */
export function useFutureReturnTime(value: string | null | undefined, enabled: boolean) {
  const [valid, setValid] = useState(() => isFutureReturnTime(value));
  const recheck = useCallback(() => {
    const nextValid = enabled && isFutureReturnTime(value);
    setValid(nextValid);
    return nextValid;
  }, [enabled, value]);
  useEffect(() => {
    if (!enabled) {
      setValid(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      if (recheck() && value != null) {
        timer = setTimeout(refresh, Math.min(Date.parse(value) - Date.now(), 2_147_483_647));
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, value, recheck]);
  // A changed/cleared value must fail closed before the effect refreshes its timer.
  return { valid: enabled && valid && isFutureReturnTime(value), recheck };
}

/** The same local-clock return picker in every Later preview. */
export function LaterReturnControl({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const now = useNow(60_000);
  return (
    <label className={styles.age}>
      <span>{WS5_COPY['preview.later.returnLabel']}</span>
      <input
        className="dm-field"
        type="datetime-local"
        value={value === null ? '' : toLocalDateTimeInput(value)}
        min={now === null ? undefined : toLocalDateTimeInput(new Date(now + 60_000).toISOString())}
        onChange={(event) => {
          const date = new Date(event.currentTarget.value);
          onChange(Number.isNaN(date.getTime()) ? null : date.toISOString());
        }}
      />
    </label>
  );
}

function toLocalDateTimeInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}
