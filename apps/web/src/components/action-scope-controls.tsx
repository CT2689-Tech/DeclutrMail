'use client';

import { SheetCheckbox, tokens } from '@declutrmail/shared';
import type { ActionReach } from '@declutrmail/shared/contracts';
import { WS2_COPY, WS5_COPY } from '@declutrmail/shared/copy/launch';
import { CleanupSelect } from './cleanup-select';

const { color, radius, space, text } = tokens;

export const DELETE_ARCHIVED_HINT = WS5_COPY['f1.preview.archived.hint'];

/** The same explicit scope choice for every manual Delete preview. */
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
  const countsMatch =
    typeof inboxCount === 'number' &&
    typeof allMailCount === 'number' &&
    inboxCount === allMailCount;
  // Equal counts describe this age-filtered snapshot, not whether the
  // reader should be able to choose a scope (or change the age next).

  const archivedUnavailable = allMailCount == null;
  return (
    <>
      <SheetCheckbox
        label={WS2_COPY.simplify.confirm.includeArchived}
        checked={value === 'all_mail'}
        disabled={archivedUnavailable && value !== 'all_mail'}
        onChange={(checked) => onChange(checked ? 'all_mail' : 'inbox_only')}
      />
      {archivedUnavailable || countsMatch ? (
        <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
          {archivedUnavailable
            ? WS5_COPY['f1.preview.archived.unavailable']
            : WS2_COPY.simplify.confirm.sameScope}
        </p>
      ) : null}
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
      <CleanupSelect
        aria-label="How far back to act on"
        value={value === null ? 'all' : String(value)}
        onChange={(event) => {
          const next = event.currentTarget.value;
          onChange(next === 'all' ? null : Number(next));
        }}
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
      </CleanupSelect>
    </label>
  );
}
