'use client';

import { useId, type ReactNode } from 'react';
import { SheetSegmented } from '@declutrmail/shared';
import { fillCopy, pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';
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
    <div className={styles.unsubscribeChoices}>
      <SheetSegmented
        label={WS5_COPY['f1.preview.existing.label']}
        value={value}
        onChange={onChange}
        options={[
          { value: 'unsub_only', label: WS5_COPY['f1.segment.unsubOnly'] },
          {
            value: 'archive',
            label: pluralCopy(WS5_COPY['f1.segment.archive'], 2),
            disabled: archiveDisabled,
          },
          {
            value: 'delete',
            label: pluralCopy(WS5_COPY['f1.segment.delete'], 2),
            disabled: deleteDisabled,
          },
        ]}
      />
    </div>
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
        <p>{WS5_COPY['f1.preview.backlog.unsubOnly']}</p>
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

/** The affected count and recovery stay visible beside the final confirmation. */
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
              : positiveCleanupLine(action, count, destination)}
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
  if (days === null) return WS5_COPY['f1.preview.age.any'];
  if (days === 365) return WS5_COPY['f1.preview.age.year'];
  return fillCopy(WS5_COPY['f1.preview.age.days'], { n: days });
}

function positiveCleanupLine(
  action: 'Archive' | 'Delete' | 'Later',
  count: number,
  destination: string,
): string {
  const shown = count.toLocaleString('en-US');
  switch (action) {
    case 'Archive':
      return pluralCopy(WS5_COPY['f1.preview.backlog.archive'], count, { n: shown });
    case 'Delete':
      return pluralCopy(WS5_COPY['f1.preview.backlog.delete'], count, { n: shown });
    case 'Later':
      return `${shown} ${count === 1 ? 'email' : 'emails'} will ${destination}.`;
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
