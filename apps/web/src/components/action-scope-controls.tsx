'use client';

import { SheetSegmented, tokens } from '@declutrmail/shared';
import type { ActionReach } from '@declutrmail/shared/contracts';

const { color, radius, space, text } = tokens;

export const DELETE_ARCHIVED_HINT = 'Choose Inbox + archived to include archived email.';

/** The same explicit, counted scope choice for every manual Delete preview. */
export function ActionReachControl({
  value,
  inboxCount,
  allMailCount,
  onChange,
}: {
  value: ActionReach;
  inboxCount: number | null | undefined;
  allMailCount: number | null | undefined;
  onChange: (reach: ActionReach) => void;
}) {
  return (
    <>
      <SheetSegmented
        label="Where it applies"
        value={value}
        onChange={onChange}
        options={[
          { value: 'inbox_only', label: 'Inbox only', count: inboxCount ?? undefined },
          {
            value: 'all_mail',
            label: allMailCount == null ? 'Inbox + archived (unavailable)' : 'Inbox + archived',
            count: allMailCount ?? undefined,
            disabled: allMailCount == null && value !== 'all_mail',
          },
        ]}
      />
      {inboxCount != null && allMailCount != null && inboxCount === allMailCount && (
        <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
          Both choices cover the same emails right now.
        </p>
      )}
    </>
  );
}

/** Date selector shared by standalone cleanup and Unsubscribe's cleanup add-on. */
export function ActionWindowControl({
  value,
  options,
  onChange,
}: {
  value: number | null;
  options: readonly { days: number | null; label: string; count?: number | undefined }[];
  onChange: (days: number | null) => void;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[3],
        minHeight: 48,
        padding: `0 ${space[2]}px 0 ${space[4]}px`,
        borderRadius: radius.lg,
        background: color.fill,
        fontSize: text.md,
        fontWeight: 500,
        textAlign: 'left',
      }}
    >
      <span>How far back</span>
      <select
        aria-label="How far back to act on"
        value={value === null ? 'all' : String(value)}
        onChange={(event) => {
          const next = event.currentTarget.value;
          onChange(next === 'all' ? null : Number(next));
        }}
        className="dm-field"
        style={{ ...tokens.field, width: '100%', minWidth: 0 }}
      >
        {options.map((option) => (
          <option
            key={option.days ?? 'all'}
            value={option.days ?? 'all'}
            disabled={option.count === undefined}
          >
            {option.label} ·{' '}
            {option.count === undefined ? 'unavailable' : option.count.toLocaleString('en-US')}
          </option>
        ))}
      </select>
    </label>
  );
}
