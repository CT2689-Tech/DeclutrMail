'use client';

import {
  SheetFactList,
  SheetLinks,
  SheetTextAction,
  tokens,
  type SheetFactItem,
} from '@declutrmail/shared';
import type { ActionReach } from '@declutrmail/shared/contracts';
import type { ActionVerb } from './types';

const { color, space, text } = tokens;

/**
 * The verification detail the senders confirm modal has always shown and
 * the triage preview never did (founder review 2026-08-27: "I in fact
 * liked sender preview since it has more details").
 *
 * Lives in its OWN module, and reaches the preview as a rendered node
 * rather than as data, because tree-shaking is per-module: while this
 * component was referenced from `action-preview-presentation.tsx`, its
 * code landed in the public inbox simulator's route chunk too and put
 * `/inbox-simulator` at 175.5 kB against a 175 kB budget — despite the
 * simulator passing no detail at all.
 *
 * Every field is plain data: no hooks, no queries, and no date math (the
 * caller formats dates), so nothing here can pull a local-calendar
 * render or an auth edge into a host that server-renders.
 */
export interface ActionPreviewDetail {
  /**
   * "Where it is now" — the inbox/elsewhere split, ALREADY
   * rendered by the caller via `mailLocationCopy`.
   *
   * Passed as a finished string rather than its inputs so this module
   * never imports `@declutrmail/shared/actions/inbox-scope`. Tree-shaking
   * is per-MODULE: one eager import here would drag that whole file into
   * the public inbox simulator's route chunk, which is the leak class
   * this repo has already paid for once.
   */
  mailLocationLine?: string;
  /**
   * Sample of what currently matches. `date` is ALREADY FORMATTED by the
   * caller — this component does no date math, so no local-calendar
   * render can reach a server-rendered host.
   */
  matchSample?: {
    rows: readonly { subject: string; date: string | null }[];
    total: number;
  };
  /** Gmail search mirroring this preview's scope; approximate by construction. */
  verifyInGmailUrl?: string;
  /**
   * ADR-0028 — the Delete-only "Where it applies" choice. Present only
   * when the screen can honour it: a Delete preview whose wire response
   * carried the all-mail block. Absent everywhere else (every other verb,
   * onboarding's first cleanup, an API predating the field), so the pair
   * simply does not render.
   */
  reachControl?: {
    reach: ActionReach;
    inboxCount: number;
    allMailCount: number;
    onChange: (reach: ActionReach) => void;
  };
}

/**
 * Whether an action's verification detail is worth showing.
 *
 * Mirrors the senders modal: a panel counting what "currently matches",
 * with a Gmail search and a subject sample over it, under an action that
 * moves no mail invites the reader to inspect mail nothing will touch.
 * Unsubscribe moves mail only when a backlog verb rides along.
 */
export function actionMovesMail(verb: ActionVerb, archiveHistoric: boolean): boolean {
  return (
    verb === 'Archive' ||
    verb === 'Later' ||
    verb === 'Delete' ||
    (verb === 'Unsubscribe' && archiveHistoric)
  );
}

/**
 * `mailLocationCopy`'s sentence as a Details value:
 * `Where it is now: 0 emails in your inbox · 6,275 emails elsewhere in Gmail.`
 * → `0 in your inbox · 6,275 elsewhere in Gmail`.
 *
 * Only the lead-in, the period and the repeated unit are cut. "elsewhere
 * in Gmail" stays — never "archived": `mail_messages` has no label
 * history, so all that is provable is that these do not carry INBOX now
 * (see `mailLocationCopy`). A sentence this does not recognise passes
 * through whole.
 */
export function mailLocationValue(line: string): string {
  return line
    .replace(/^Where it is now: /, '')
    .replace(/\.$/, '')
    .replace(/ emails? (in your inbox|elsewhere in Gmail|in Trash or Spam)/g, ' $1');
}

/**
 * The facts of the Details well — `leadFacts` first (the caller's account
 * and count lines), then "Where it is now" and the widened-reach facts —
 * followed by the current-match sample and the Gmail cross-check link.
 * Parts are omitted individually when there is no data for them.
 *
 * Renders FLAT, for the inside of a "Details" well (ADR-0042): no boxes,
 * no nested disclosure. The reach CHOICE is not here — it changes the
 * count, so the sheet renders it as its one control (`SheetSegmented`).
 */
export function ActionPreviewDetailBlock({
  detail,
  leadFacts = [],
  trailingFacts = [],
}: {
  detail: ActionPreviewDetail | undefined;
  leadFacts?: readonly SheetFactItem[];
  trailingFacts?: readonly SheetFactItem[];
}) {
  const location = detail?.mailLocationLine ?? null;
  const sample = detail?.matchSample;
  const allMail = detail?.reachControl?.reach === 'all_mail';
  const facts: SheetFactItem[] = [
    ...leadFacts,
    ...(location === null
      ? []
      : [
          {
            label: 'Where it is now',
            value: <span data-testid="mail-location-line">{mailLocationValue(location)}</span>,
          },
        ]),
    ...(allMail
      ? [
          { label: 'Never touched', value: 'Trash, Spam, Drafts, Chat' },
          { label: 'Undo', value: 'Puts each email back where it was' },
        ]
      : []),
    ...trailingFacts,
  ];
  const hasSample = sample !== undefined && sample.rows.length > 0;
  const verifyUrl = detail?.verifyInGmailUrl;
  if (facts.length === 0 && !hasSample && verifyUrl === undefined) return null;
  return (
    <>
      {facts.length > 0 && (
        // Static text, not a live region: the sheet owns the one
        // `role="status"`, and two of them make screen readers race.
        <SheetFactList facts={facts} />
      )}

      {hasSample && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[2], minWidth: 0 }}>
          <span style={{ fontSize: text.sm, color: color.fgMuted }}>
            Recent matches · showing {sample.rows.length} of {sample.total.toLocaleString('en-US')}
          </span>
          {sample.rows.map((row, i) => (
            <div
              key={i}
              style={{ display: 'flex', gap: space[3], alignItems: 'baseline', minWidth: 0 }}
            >
              {row.date !== null && (
                <span
                  style={{
                    color: color.fgMuted,
                    flex: '0 0 auto',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {row.date}
                </span>
              )}
              <span style={{ color: color.fg, minWidth: 0, overflowWrap: 'anywhere' }}>
                {row.subject}
              </span>
            </div>
          ))}
          {/* D7 — the trust line goes wherever subjects do. */}
          <span style={{ fontSize: text.xs, color: color.fgMuted }}>
            Subjects only. We never fetch or store full email contents.
          </span>
        </div>
      )}

      {/* Approximate by construction: Gmail's `older_than:` is day-granular
          and resolves live, so its result count can differ from the
          preview's exact filter. Never claim the two match. */}
      {verifyUrl !== undefined && (
        <SheetLinks>
          <SheetTextAction href={verifyUrl} title="Approximate — Gmail filters by whole days.">
            Check in Gmail <span aria-hidden="true">↗</span>
          </SheetTextAction>
        </SheetLinks>
      )}
    </>
  );
}
