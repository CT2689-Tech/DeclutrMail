'use client';

import { useId, type ReactNode } from 'react';
import { SheetSegmented } from '@declutrmail/shared';
import { useNow } from '@/lib/use-now';
import { CleanupSelect } from './cleanup-select';
import styles from './cleanup-preview.module.css';

export interface CleanupAgeControl {
  olderThanDays: number | null;
  options: readonly { days: number | null; disabled?: boolean }[];
  onChange: (days: number | null) => void;
}

export type UnsubscribeCleanupMode = 'unsub_only' | 'archive' | 'delete';

/** Choices name the action; the live count belongs in the impact summary. */
export function UnsubscribeChoices({
  value,
  onChange,
  archiveDisabled,
  deleteDisabled,
}: {
  value: UnsubscribeCleanupMode;
  onChange: (mode: UnsubscribeCleanupMode) => void;
  archiveDisabled: boolean;
  deleteDisabled: boolean;
}) {
  return (
    <SheetSegmented
      label="Email you already have"
      value={value}
      onChange={onChange}
      options={[
        { value: 'unsub_only', label: 'Unsubscribe only' },
        { value: 'archive', label: '+ Archive', disabled: archiveDisabled },
        { value: 'delete', label: '+ Delete', disabled: deleteDisabled },
      ]}
    />
  );
}

export function UnsubscribeImpact({
  mode,
  count,
  olderThanDays,
  includesArchived = false,
  note,
}: {
  mode: UnsubscribeCleanupMode;
  count: number | null;
  olderThanDays: number | null;
  includesArchived?: boolean;
  note: string;
}) {
  return mode === 'unsub_only' ? (
    <>
      <div className={styles.impact} role="region" aria-label="Unsubscribe impact">
        <p>Existing email stays where it is.</p>
      </div>
      <p className={styles.recovery}>{note}</p>
    </>
  ) : (
    <CleanupImpact
      action={mode === 'archive' ? 'Archive' : 'Delete'}
      count={count}
      olderThanDays={olderThanDays}
      includesArchived={includesArchived}
      note={note}
    />
  );
}

/** Presentation only. The existing confirmation owns scope, counts and submission. */
export function CleanupPreview({
  olderThanDays,
  options,
  onWindowChange,
  showWindow,
  children,
}: {
  olderThanDays: number | null;
  options: readonly { days: number | null; disabled?: boolean }[];
  onWindowChange: (days: number | null) => void;
  showWindow: boolean;
  children: ReactNode;
}) {
  const now = useNow(60_000);
  const cutoffId = useId();
  const cutoff =
    now !== null && olderThanDays !== null ? new Date(now - olderThanDays * 86_400_000) : null;

  return (
    <div className={styles.body}>
      {showWindow && (
        <label className={styles.age}>
          <span>Email age</span>
          <CleanupSelect
            aria-label="Email age"
            aria-describedby={olderThanDays === null || cutoff !== null ? cutoffId : undefined}
            value={olderThanDays ?? 'all'}
            onChange={(event) =>
              onWindowChange(
                event.currentTarget.value === 'all' ? null : Number(event.currentTarget.value),
              )
            }
          >
            {options.map((option) => (
              <option
                key={option.days ?? 'all'}
                value={option.days ?? 'all'}
                disabled={option.disabled}
              >
                {cleanupAgeLabel(option.days)}
                {option.disabled ? ' (unavailable)' : ''}
              </option>
            ))}
          </CleanupSelect>
          {olderThanDays === null ? (
            <small id={cutoffId}>No date limit.</small>
          ) : (
            cutoff !== null && (
              <small id={cutoffId}>
                Approximate cutoff:{' '}
                <time dateTime={cutoff.toISOString()}>
                  {new Intl.DateTimeFormat('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: Intl.DateTimeFormat('en-US').resolvedOptions().timeZone,
                  }).format(cutoff)}
                </time>
                .
              </small>
            )
          )}
        </label>
      )}
      {children}
    </div>
  );
}

/** The affected count and recovery stay visible beside the final cleanup action. */
export function CleanupImpact({
  action,
  count,
  includesArchived,
  olderThanDays,
  note,
}: {
  action: 'Archive' | 'Delete' | 'Later';
  count: number | null;
  includesArchived: boolean;
  olderThanDays: number | null;
  note: string;
}) {
  const destination =
    action === 'Archive'
      ? 'leave your inbox and stay in Gmail'
      : action === 'Later'
        ? 'move to Gmail’s DeclutrMail/Later label'
        : 'move to Gmail Trash';
  return (
    <>
      {count === null && (
        <p className={styles.recovery}>Matching emails {destination} after you confirm.</p>
      )}
      {count !== null && (
        <div
          className={styles.impact}
          role="region"
          aria-label={`${action} impact`}
          aria-live="polite"
          aria-atomic="true"
        >
          <p>
            {count === 0
              ? 'No emails match this scope.'
              : `${count.toLocaleString('en-US')} ${count === 1 ? 'email' : 'emails'} will ${destination}.`}
          </p>
          <span>
            {includesArchived ? 'Inbox and archived email' : 'Inbox only'} ·{' '}
            {cleanupAgeLabel(olderThanDays)}
          </span>
        </div>
      )}
      {note !== '' && <p className={styles.recovery}>{note}</p>}
    </>
  );
}

export function cleanupAgeLabel(days: number | null): string {
  if (days === null) return 'Any age';
  return days === 365 ? 'Older than 1 year' : `Older than ${days} days`;
}
