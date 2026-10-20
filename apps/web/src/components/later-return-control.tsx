'use client';

import { useNow } from '@/lib/use-now';
import styles from './cleanup-preview.module.css';

export function isFutureReturnTime(value: string | null | undefined): value is string {
  return value != null && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
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
      <span>Return to inbox</span>
      <input
        className="dm-field"
        type="datetime-local"
        aria-label="Later return time"
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
