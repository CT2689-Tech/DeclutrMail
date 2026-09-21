'use client';

import { tokens } from '@declutrmail/shared';
import type { ActionReach } from '@declutrmail/shared/contracts';
import type { ActionVerb } from './types';

const { color, text } = tokens;

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
 * "Where it is now", the Gmail cross-check, and the current-match
 * sample — omitted individually when the caller has no data for them.
 *
 * Renders FLAT, for the inside of a "Details" well (ADR-0042): no boxes,
 * no nested disclosure. The reach CHOICE is not here — it changes the
 * count, so the sheet renders it as its one control (`SheetSegmented`);
 * what stays here is the sentence explaining the widened reach.
 */
export function ActionPreviewDetailBlock({ detail }: { detail: ActionPreviewDetail | undefined }) {
  if (detail === undefined) return null;
  const location = detail.mailLocationLine ?? null;
  const sample = detail.matchSample;
  const allMail = detail.reachControl?.reach === 'all_mail';
  if (
    location === null &&
    sample === undefined &&
    detail.verifyInGmailUrl === undefined &&
    !allMail
  ) {
    return null;
  }
  return (
    <>
      {allMail && (
        <span>
          Includes archived mail. Trash, Spam, Drafts and Chat are never touched. Undo restores
          every email — inbox email to the inbox, archived email to the archive.
        </span>
      )}

      {location !== null && (
        // Static text, not a live region: the sheet owns the one
        // `role="status"`, and two of them make screen readers race.
        <span data-testid="mail-location-line">{location}</span>
      )}

      {sample !== undefined && sample.rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: text.xs, color: color.fgMuted }}>Latest matching email</span>
          {sample.rows.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
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
      {detail.verifyInGmailUrl !== undefined && (
        <a
          href={detail.verifyInGmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ alignSelf: 'flex-start', color: color.fg, fontWeight: 550 }}
        >
          Check these in Gmail
        </a>
      )}
    </>
  );
}
