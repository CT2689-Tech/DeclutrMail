'use client';

import { createContext, useContext } from 'react';

import { tokens } from '@declutrmail/shared';
import { getActionSemantics } from '@declutrmail/shared/actions';

const { color, font } = tokens;

/** The mail-moving verbs a sender row can be busy with. */
export type RowActivityVerb = 'archive' | 'later' | 'delete';

/**
 * What a sender row says about the action taken ON it (founder report
 * 2026-09-20: after confirming, rows sat unchanged for the whole job —
 * seconds to minutes — with a 3.6s toast as the only sign of life).
 *
 *   - `working`      accepted by the server, job not terminal yet.
 *   - `done`         terminal. `affectedCount` is `null` when no
 *                    per-sender figure exists (a bulk reports totals
 *                    only) — then the label carries no number at all.
 *   - `failed`       the job ended `failed`.
 *   - `unconfirmed`  past the overdue deadline, or its status poll was lost.
 *   - `mixed`        its bulk ended with SOME failures. A batch does not say
 *                    which sender failed, so the row claims no outcome —
 *                    it points at the one place that knows.
 *
 * Unsubscribe is absent on purpose: it already owns a lifecycle pill
 * driven by server state (`UNSUB_PILL`).
 */
export type SenderRowActivity =
  | { phase: 'working'; verb: RowActivityVerb }
  | { phase: 'done'; verb: RowActivityVerb; affectedCount: number | null }
  | { phase: 'failed'; verb: RowActivityVerb }
  | { phase: 'unconfirmed'; verb: RowActivityVerb }
  | { phase: 'mixed'; verb: RowActivityVerb };

export type RowActivityById = ReadonlyMap<string, SenderRowActivity>;

const WORKING: Record<RowActivityVerb, string> = {
  archive: 'Archiving…',
  later: 'Moving to Later…',
  delete: 'Moving to Trash…',
};

const DONE: Record<RowActivityVerb, string> = {
  archive: 'Archived',
  later: 'Moved to Later',
  delete: 'Deleted',
};

export function rowActivityLabel(activity: SenderRowActivity): string {
  const verbLabel = getActionSemantics(activity.verb).label;
  switch (activity.phase) {
    case 'working':
      return WORKING[activity.verb];
    case 'failed':
      return `${verbLabel} failed`;
    case 'mixed':
      return `${verbLabel}: see Activity`;
    case 'unconfirmed':
      // True of BOTH ways a row gets here: the job ran past the overdue
      // deadline, or its status poll was lost. Neither knows it finished.
      return `${verbLabel} not confirmed`;
    case 'done': {
      if (activity.affectedCount === 0) return 'Nothing to change';
      // Short form: the pill shares a ≤320px name cell. The full result
      // label ("Deleted to Gmail Trash") is the pill's tooltip.
      const result = DONE[activity.verb];
      if (activity.affectedCount === null) return result;
      const n = activity.affectedCount;
      return `${result} · ${n.toLocaleString('en-US')} email${n === 1 ? '' : 's'}`;
    }
  }
}

const EMPTY: RowActivityById = new Map();
const RowActivityContext = createContext<RowActivityById>(EMPTY);

/**
 * Activity by sender id, for every row layout at once. A context rather
 * than a prop: the table, the grid card, the domain-group card and the
 * phone row all end in the same `SenderActionRow`, and threading one map
 * through each of them (and their stories) is four chances to forget one
 * — the table had no busy state at all for exactly that reason.
 */
export const RowActivityProvider = RowActivityContext.Provider;

export function useRowActivity(senderId: string): SenderRowActivity | undefined {
  return useContext(RowActivityContext).get(senderId);
}

/**
 * One line for a COLLAPSED group of senders (the grid's brand card): how
 * many members are working, else how their actions ended. `null` when no
 * member was acted on. Counts only — a group card names no single verb.
 */
export function useGroupActivitySummary(
  senderIds: readonly string[],
): { busy: boolean; label: string } | null {
  const map = useContext(RowActivityContext);
  let working = 0;
  let unconfirmed = 0;
  let done = 0;
  let failed = 0;
  let mixed = 0;
  for (const id of senderIds) {
    const phase = map.get(id)?.phase;
    if (phase === 'working') working += 1;
    else if (phase === 'unconfirmed') unconfirmed += 1;
    else if (phase === 'done') done += 1;
    else if (phase === 'failed') failed += 1;
    else if (phase === 'mixed') mixed += 1;
  }
  if (working > 0) return { busy: true, label: `${working} working…` };
  const parts = [
    ...(done > 0 ? [`${done} done`] : []),
    ...(failed > 0 ? [`${failed} failed`] : []),
    ...(unconfirmed > 0 ? [`${unconfirmed} not confirmed`] : []),
    ...(mixed > 0 ? [`${mixed} in Activity`] : []),
  ];
  return parts.length === 0 ? null : { busy: unconfirmed > 0, label: parts.join(' · ') };
}

/** True while the row must not take another action (and reads as busy). */
export const isRowBusy = (activity: SenderRowActivity | undefined): boolean =>
  activity?.phase === 'working' || activity?.phase === 'unconfirmed';

/**
 * The pill — same footprint as the unsubscribe lifecycle pill it sits
 * beside, so table, grid and phone rows share one grammar.
 */
export function RowActivityPill({ activity }: { activity: SenderRowActivity }) {
  const tone =
    activity.phase === 'failed'
      ? { fg: color.red, bg: color.redBg, border: color.redBorder }
      : activity.phase === 'done'
        ? { fg: color.primary, bg: color.primarySoft, border: color.primaryBorder }
        : // Full-strength text on the card surface: the busy row is tinted,
          // never faded, so this stays at body-text contrast.
          { fg: color.fg, bg: color.card, border: color.line };
  return (
    // No live-region role: a 50-sender bulk would be 50 of them. The
    // screen's toast already announces the action once.
    <span
      data-dm-row-activity={activity.phase}
      title={
        activity.phase === 'done' && activity.affectedCount !== 0
          ? getActionSemantics(activity.verb).resultLabel
          : undefined
      }
      style={{
        fontFamily: font.mono,
        fontSize: 9.5,
        letterSpacing: '0.10em',
        textTransform: 'uppercase',
        color: tone.fg,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 999,
        padding: '1px 6px',
        flex: '0 0 auto',
        whiteSpace: 'nowrap',
      }}
    >
      {rowActivityLabel(activity)}
    </span>
  );
}
