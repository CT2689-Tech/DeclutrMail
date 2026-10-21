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
    <div className={`${styles.unsubscribeChoices} dm-unsub-choice`}>
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
      <div
        className={styles.impact}
        role="region"
        aria-label={WS5_COPY['preview.impact.aria.unsub']}
      >
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
          <span>{WS5_COPY['preview.age.label']}</span>
          <CleanupSelect
            aria-label={WS5_COPY['preview.age.label']}
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
                {option.disabled ? WS5_COPY['preview.age.unavailable'] : ''}
              </option>
            ))}
          </CleanupSelect>
          {olderThanDays === null ? (
            <small id={cutoffId}>{WS5_COPY['preview.age.noLimit']}</small>
          ) : (
            cutoff !== null && <AgeCutoff id={cutoffId} cutoff={cutoff} />
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
  return (
    <>
      {count === null && <p className={styles.recovery}>{pendingImpact(action)}</p>}
      {count !== null && (
        <div
          className={styles.impact}
          role="region"
          aria-label={impactAria(action)}
          aria-live="polite"
          aria-atomic="true"
        >
          <p>
            {count === 0 ? WS5_COPY['preview.impact.none'] : positiveCleanupLine(action, count)}
          </p>
          <span>
            {fillCopy(
              includesArchived
                ? WS5_COPY['preview.impact.facts.allMail']
                : WS5_COPY['preview.impact.facts.inbox'],
              { age: cleanupAgeLabel(olderThanDays) },
            )}
          </span>
        </div>
      )}
      {note !== '' && <p className={styles.recovery}>{note}</p>}
    </>
  );
}

function impactAria(action: 'Archive' | 'Delete' | 'Later'): string {
  switch (action) {
    case 'Archive':
      return WS5_COPY['preview.impact.aria.archive'];
    case 'Delete':
      return WS5_COPY['preview.impact.aria.delete'];
    case 'Later':
      return WS5_COPY['preview.impact.aria.later'];
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

export function cleanupAgeLabel(days: number | null): string {
  if (days === null) return WS5_COPY['preview.age.any'];
  if (days === 365) return WS5_COPY['preview.age.olderThanYear'];
  return fillCopy(WS5_COPY['preview.age.olderThanDays'], { n: days });
}

/** `{age}` in `preview.zero.*` — the option label without its "Older than " lead. */
export function cleanupZeroAge(days: number): string {
  return cleanupAgeLabel(days).replace(/^Older than /, '');
}

type CleanupVerb = 'Archive' | 'Delete' | 'Later';

export function cleanupActionTitle(verb: CleanupVerb, sender: string): string {
  const key =
    verb === 'Later'
      ? 'preview.title.later'
      : verb === 'Delete'
        ? 'preview.title.delete'
        : 'preview.title.archive';
  return fillCopy(WS5_COPY[key], { Sender: sender });
}

export function cleanupBulkTitle(verb: CleanupVerb, senderCount: number): string {
  const key =
    verb === 'Later'
      ? 'preview.title.bulk.later'
      : verb === 'Delete'
        ? 'preview.title.bulk.delete'
        : 'preview.title.bulk.archive';
  return pluralCopy(WS5_COPY[key], senderCount, {
    k: senderCount.toLocaleString('en-US'),
  });
}

export function cleanupNothingTitle(input: {
  olderThanDays: number | null;
  sender: string;
  allMail: boolean;
  bulkTheseSenders?: boolean;
}): string {
  if (input.olderThanDays !== null) {
    const age = cleanupZeroAge(input.olderThanDays);
    if (input.bulkTheseSenders) {
      return fillCopy(WS5_COPY['preview.zero.olderThan.bulk'], { age });
    }
    return fillCopy(WS5_COPY['preview.zero.olderThan'], { age, Sender: input.sender });
  }
  if (input.allMail) {
    return fillCopy(WS5_COPY['preview.zero.nothing.allMail'], { Sender: input.sender });
  }
  if (input.bulkTheseSenders) return WS5_COPY['preview.zero.nothing.bulk'];
  return fillCopy(WS5_COPY['preview.zero.nothing'], { Sender: input.sender });
}

export function cleanupInboxHasNone(count: number, sender: string, olderThanDays: number): string {
  return pluralCopy(WS5_COPY['preview.zero.inboxHasNone'], count, {
    n: count.toLocaleString('en-US'),
    Sender: sender,
    age: cleanupZeroAge(olderThanDays),
  });
}

function pendingImpact(action: CleanupVerb): string {
  switch (action) {
    case 'Archive':
      return WS5_COPY['preview.impact.pending.archive'];
    case 'Later':
      return WS5_COPY['preview.impact.pending.later'];
    case 'Delete':
      return WS5_COPY['preview.impact.pending.delete'];
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

function positiveCleanupLine(action: CleanupVerb, count: number): string {
  const shown = count.toLocaleString('en-US');
  switch (action) {
    case 'Archive':
      return pluralCopy(WS5_COPY['preview.impact.archive'], count, { n: shown });
    case 'Later':
      return pluralCopy(WS5_COPY['preview.impact.later'], count, { n: shown });
    case 'Delete':
      return pluralCopy(WS5_COPY['preview.impact.delete'], count, { n: shown });
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

function AgeCutoff({ id, cutoff }: { id: string; cutoff: Date }) {
  const template = WS5_COPY['preview.age.cutoff'];
  const token = '{date}';
  const at = template.indexOf(token);
  const formatted = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: Intl.DateTimeFormat('en-US').resolvedOptions().timeZone,
  }).format(cutoff);
  const time = <time dateTime={cutoff.toISOString()}>{formatted}</time>;
  if (at === -1) {
    return <small id={id}>{template}</small>;
  }
  return (
    <small id={id}>
      {template.slice(0, at)}
      {time}
      {template.slice(at + token.length)}
    </small>
  );
}
