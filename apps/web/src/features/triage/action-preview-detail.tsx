'use client';

import { tokens } from '@declutrmail/shared';
import { useState } from 'react';

import type { ActionVerb } from './types';

const { color, font } = tokens;

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
   * "Where this sender's mail is now" — the inbox/elsewhere split, ALREADY
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
 * "Where this sender's mail is now", the Gmail cross-check, and the current-match
 * sample — omitted individually when the caller has no data for them, so
 * the compact preview renders nothing at all.
 */
export function ActionPreviewDetailBlock({ detail }: { detail: ActionPreviewDetail | undefined }) {
  const [showSubjects, setShowSubjects] = useState(false);
  if (detail === undefined) return null;
  const location = detail.mailLocationLine ?? null;
  const sample = detail.matchSample;
  if (location === null && sample === undefined && detail.verifyInGmailUrl === undefined) {
    return null;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {location !== null && (
        <span
          role="status"
          data-testid="mail-location-line"
          style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.45 }}
        >
          {location}
        </span>
      )}

      {/* Approximate by construction: Gmail's `older_than:` is day-granular
          and resolves live, so its result count can differ from the
          preview's exact filter. Never claim the two match. */}
      {detail.verifyInGmailUrl !== undefined && (
        <a
          href={detail.verifyInGmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            alignSelf: 'flex-start',
            fontFamily: font.mono,
            fontSize: 11,
            color: color.fgSoft,
            letterSpacing: '0.04em',
          }}
        >
          Check these in Gmail first ↗
        </a>
      )}

      {sample !== undefined && sample.rows.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowSubjects((v) => !v)}
            aria-expanded={showSubjects}
            style={{
              alignSelf: 'flex-start',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontFamily: font.mono,
              fontSize: 11,
              color: color.fgMuted,
              letterSpacing: '0.04em',
            }}
          >
            {showSubjects
              ? 'Hide current matches ▴'
              : `Show what currently matches (${sample.rows.length.toLocaleString('en-US')} of ${sample.total.toLocaleString('en-US')}) ▾`}
          </button>
          {showSubjects && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '8px 10px',
                background: color.card,
                border: `1px solid ${color.line}`,
                borderRadius: 6,
              }}
            >
              {sample.rows.map((row, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                    fontFamily: font.mono,
                    fontSize: 11.5,
                    color: color.fgSoft,
                  }}
                >
                  <span style={{ width: 18, color: color.fgMuted }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
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
                  <span style={{ color: color.fg, minWidth: 0 }}>{row.subject}</span>
                </div>
              ))}
              {/* D7 — the trust line goes wherever subjects do. */}
              <div
                style={{
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: `1px dashed ${color.line}`,
                  fontFamily: font.mono,
                  fontSize: 10.5,
                  color: color.fgMuted,
                  letterSpacing: '0.04em',
                }}
              >
                Subjects only · we never fetch or store full email contents
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
