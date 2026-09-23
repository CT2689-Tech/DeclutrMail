'use client';

import Link from 'next/link';
import { Avatar, Kbd, Pill, tokens, useIsAtMost } from '@declutrmail/shared';
import type { PillTone } from '@declutrmail/shared';
import { unsubscribeUnavailableReason } from '@declutrmail/shared/actions';
import { confidenceBand, scoredAgeLabel } from '@declutrmail/shared/copy';
import { useNow } from '@/lib/use-now';

import type { ActionReach } from '@/lib/api/actions';

import {
  canScreenerUnsubscribe,
  firstSeenLabel,
  type ScreenerDecideVerb,
  type ScreenerQueueRow,
} from './data';
import { DecidePreview, type DecidePreviewCount } from './decide-preview';
import { VERB_KEY_HINT, VERB_LABEL, VERB_ORDER, verdictLabel } from './verbs';
import './screener-row.css';

const { color, font, motion, radius, shadow, text } = tokens;

/** Pill tone per engine verdict — matches the Triage row semantics. */
const VERDICT_TONE: Record<'keep' | 'archive' | 'unsubscribe' | 'later', PillTone> = {
  keep: 'primary',
  archive: 'dark',
  unsubscribe: 'amber',
  later: 'default',
};

/**
 * One row in the Screener queue — the D73 accordion (same
 * collapse/expand pattern as Triage D36 / Senders D50).
 *
 * Collapsed: avatar, sender name + domain, sample subject, first-seen,
 * engine recommendation pip (`Archive · 65%`) — the D71 row content.
 * Expanded: the K/A/U/L/D toolbar, first-seen + message count so far,
 * engine reasoning, "Open sender →" link, and — when a verb is
 * pending — the mandatory D226 preview with Confirm/Cancel.
 */
export function ScreenerRow({
  row,
  expanded,
  busy = false,
  pendingVerb = null,
  previewInboxCount = 'loading',
  previewInboxTotal = null,
  previewWindowDays = null,
  previewAllMailCount = null,
  previewAllMailTotal = null,
  pendingReach = 'inbox_only',
  onReachChange,
  onWindowChange,
  wakeAt = null,
  onToggleExpand,
  onVerbClick,
  onConfirm,
  onCancel,
}: {
  row: ScreenerQueueRow;
  expanded: boolean;
  /** True while this row's decision is confirming server-side. */
  busy?: boolean;
  /** Verb awaiting confirmation in this row's preview (D226). */
  pendingVerb?: ScreenerDecideVerb | null;
  previewInboxCount?: DecidePreviewCount;
  /**
   * QA-delete-20260829-01 — the TRUE un-windowed inbox count, for the
   * empty-window notice when Delete's default window excludes everything.
   */
  previewInboxTotal?: number | null;
  /** QA-delete-20260829-01 — the window days active on `previewInboxCount`, if any. */
  previewWindowDays?: number | null;
  onWindowChange?: ((days: number | null) => void) | undefined;
  /** ADR-0028 all-mail count — `null` hides the Delete reach chips. */
  previewAllMailCount?: number | null;
  /**
   * Codex review 2026-09-03 (QA-delete-20260903-01, round 2): the TRUE
   * un-windowed all-mail total — `previewAllMailCount` is windowed
   * identically to `previewInboxCount` for a pending Delete, so it
   * cannot answer "is all-mail reach truly empty" on its own, the same
   * gap `previewInboxTotal` already closes for inbox-only reach.
   */
  previewAllMailTotal?: number | null;
  /** ADR-0028 — the pending Delete's selected reach. */
  pendingReach?: ActionReach;
  onReachChange?: ((reach: ActionReach) => void) | undefined;
  wakeAt?: string | null;
  onToggleExpand: () => void;
  onVerbClick: (verb: ScreenerDecideVerb) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Hydration-safe clock — `null` on the server and the first client
  // render, so a day-boundary crossing can't make the server and the
  // browser disagree about "3 days ago" vs "4 days ago".
  const now = useNow();
  const scoredAt = row.recommendation?.scoredAt;
  const ageLabel =
    scoredAt !== undefined && now !== null ? scoredAgeLabel(scoredAt, new Date(now)) : null;
  // The queue is prefetched for SSR. A render-time clock can make the
  // server's relative age differ from the first browser render.
  const firstSeenAge = now === null ? null : firstSeenLabel(row.firstSeenAt, new Date(now));
  const isPhone = useIsAtMost('xs');
  const compactHeader = useIsAtMost('sm');

  return (
    <div
      aria-busy={busy}
      className="dm-screener-row"
      data-expanded={expanded ? 'true' : undefined}
      style={{
        // Flat list row — no card chrome; the open row is marked by a
        // wash, not a border + shadow.
        opacity: busy ? 0.6 : 1,
      }}
    >
      {/* Collapsed header — always rendered. */}
      <div
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={`screener-row-body-${row.id}`}
        aria-label={`${row.senderName} — ${expanded ? 'collapse' : 'expand'} sender detail`}
        style={{
          display: 'grid',
          gridTemplateColumns: compactHeader
            ? '44px minmax(0, 1fr) 18px'
            : '44px minmax(0, 1fr) auto auto 18px',
          gap: isPhone ? 10 : 12,
          alignItems: 'center',
          minHeight: 72,
          boxSizing: 'border-box',
          padding: '12px',
          borderRadius: radius.lg,
          cursor: 'pointer',
        }}
      >
        <Avatar name={row.senderName} domain={row.senderDomain} size={44} hasMark={row.brandMark} />

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: compactHeader ? 'column' : 'row',
              alignItems: compactHeader ? 'stretch' : 'baseline',
              gap: compactHeader ? 2 : 8,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: text.md,
                letterSpacing: '-0.005em',
                color: color.fg,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: compactHeader ? 'normal' : 'nowrap',
                overflowWrap: compactHeader ? 'anywhere' : undefined,
                minWidth: 0,
              }}
            >
              {row.senderName}
            </span>
            <span
              style={{
                fontSize: text.sm,
                color: color.fgMuted,
                flexShrink: compactHeader ? 1 : 0,
                overflowWrap: compactHeader ? 'anywhere' : undefined,
              }}
            >
              {row.senderDomain}
            </span>
            {compactHeader && (
              <span style={{ fontSize: text.xs, color: color.fgMuted }}>
                First seen {firstSeenAge ?? '…'}
              </span>
            )}
          </div>
          {/* Sample subject — the latest message (D71). */}
          <span
            style={{
              fontSize: text.sm,
              color: color.fgMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.sampleSubject || 'No subject'}
          </span>
        </div>

        {/* First seen — relative (D71). Hidden in the collapsed header at
            phone width to fit the grid; still shown in the expanded
            detail body below. */}
        {!compactHeader && (
          <span
            style={{
              fontSize: text.sm,
              color: color.fgMuted,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {firstSeenAge ?? '…'}
          </span>
        )}

        {/* Engine recommendation pip — verdict + confidence (D71).
            No category labels here, ever (D71 honours D22).

            The confidence reads as a WORD, not a rounded percentage —
            same source as Triage's pill, so the two surfaces cannot
            describe the same read differently. See
            `@declutrmail/shared/copy/engine-confidence` for why the
            cascade's number does not support two digits. */}
        <div
          style={{
            display: 'inline-flex',
            minWidth: 0,
            ...(compactHeader ? { gridColumn: 2, gridRow: 2 } : {}),
          }}
        >
          {row.recommendation != null ? (
            <Pill tone={VERDICT_TONE[row.recommendation.verdict]}>
              {verdictLabel(row.recommendation.verdict)}
              {(() => {
                const band = confidenceBand(
                  row.recommendation.verdict,
                  row.recommendation.confidence,
                );
                return band === null ? null : (
                  <span style={{ opacity: 0.85 }}>
                    {' · '}
                    {band}
                  </span>
                );
              })()}
            </Pill>
          ) : (
            <Pill>New</Pill>
          )}
        </div>
        {/* Chevron. */}
        <span
          aria-hidden="true"
          style={{
            ...(compactHeader ? { gridColumn: 3, gridRow: '1 / 3' } : {}),
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: color.fgMuted,
            fontSize: text.md,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: `transform ${motion.fast} ${motion.ease}`,
          }}
        >
          ›
        </span>
      </div>

      {/* Expanded body (D73) — toolbar + detail + (maybe) the preview. */}
      {expanded && (
        <div
          id={`screener-row-body-${row.id}`}
          style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 12px 16px 68px' }}
        >
          {/* K/A/U/L/D toolbar. */}
          <div
            role="toolbar"
            aria-label={`Decide ${row.senderName}`}
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
          >
            {VERB_ORDER.map((verb) => {
              const active = pendingVerb === verb;
              // D248 — the tooltip names WHICH capability state the
              // sender is in. "No unsubscribe channel found" is only
              // true once the index has looked; a sender it has not
              // derived a method for reads as not-yet-checked.
              const unsubscribeBlockedReason =
                verb === 'unsubscribe' && !canScreenerUnsubscribe(row)
                  ? unsubscribeUnavailableReason(row.unsubscribeMethod)
                  : null;
              const noUnsubscribeChannel = unsubscribeBlockedReason !== null;
              return (
                <button
                  key={verb}
                  type="button"
                  className="dm-screener-verb"
                  disabled={busy || noUnsubscribeChannel}
                  onClick={() => onVerbClick(verb)}
                  aria-pressed={active}
                  title={unsubscribeBlockedReason ?? undefined}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 36,
                    padding: '0 8px 0 14px',
                    borderRadius: radius.pill,
                    fontFamily: font.sans,
                    fontSize: text.base,
                    fontWeight: 600,
                    cursor: busy || noUnsubscribeChannel ? 'not-allowed' : 'pointer',
                    opacity: noUnsubscribeChannel ? 0.45 : 1,
                    border: 'none',
                    // Pressed = tinted fill + a ring in the verb's colour.
                    boxShadow: active
                      ? `inset 0 0 0 1.5px ${verb === 'delete' ? color.danger : color.primary}`
                      : shadow.card,
                    background: active
                      ? verb === 'delete'
                        ? color.dangerBg
                        : color.primarySoft
                      : color.card,
                    color: active
                      ? verb === 'delete'
                        ? color.danger
                        : color.primary
                      : verb === 'delete'
                        ? color.danger
                        : color.fg,
                  }}
                >
                  {VERB_LABEL[verb]}
                  <span aria-hidden="true">
                    <Kbd>{VERB_KEY_HINT[verb]}</Kbd>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Detail grid — first seen, count so far, engine reasoning. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: text.sm, color: color.fgSoft }}>
              <span style={{ fontWeight: 600 }}>First seen:</span> {firstSeenAge ?? '…'} ·{' '}
              {/* `senders.total_received` — every label, not inbox-only.
                  Named so it cannot be read as the denominator of the
                  INBOX-now count in the decide preview below: "40"
                  beside "2 emails currently match in Inbox" reads as 38
                  lost messages (findings doc 5.11).

                  "received" is MANDATED, not chosen: ADR-0014 §Neutral
                  — "`total_received` is 'within retention,' not
                  'all-time in Gmail.' UI copy says 'received', never
                  'all-time'." The counter is recounted from
                  `mail_messages` nightly by
                  `SendersCounterReconciliationWorker` (its docstring
                  names the "retention-prune drift case") and rebuilt on
                  every connect / reconnect / OAuth re-grant, so it is
                  not a lifetime total — verified 2026-07-27: 0 of 7,902
                  senders diverge from COUNT(mail_messages). */}
              <span
                style={{ fontWeight: 600 }}
                title="Messages received from this sender, within DeclutrMail's retention — archived mail included. The second number is how many are in your inbox now."
              >
                Messages received:
              </span>{' '}
              {row.messageCount.toLocaleString('en-US')} · {row.inboxCount.toLocaleString('en-US')}{' '}
              in inbox
            </span>
            {row.recommendation != null && (
              <span style={{ fontSize: text.sm, color: color.fgMuted, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600, color: color.fgSoft }}>
                  Why this is suggested:{' '}
                </span>
                {row.recommendation.reasoning}
                {/* The sentence was written at score time; the counts
                    above it ("N · M in inbox") are recomputed on every
                    request. Stating the age keeps the two from reading
                    as one self-contradicting measurement (D25). Silent
                    when unknown — the fixtures have no engine run. */}
                {ageLabel !== null && (
                  <span
                    style={{ fontSize: text.xs, color: color.fgMuted }}
                  >{` · ${ageLabel}`}</span>
                )}
              </span>
            )}
            <Link
              href={`/senders/${row.senderId}`}
              style={{
                fontSize: text.sm,
                fontWeight: 600,
                color: color.primary,
                textDecoration: 'none',
                width: 'fit-content',
              }}
            >
              Open sender
            </Link>
          </div>

          {/* The mandatory D226 preview — mounts when a verb is pending. */}
          {pendingVerb != null && (
            <DecidePreview
              verb={pendingVerb}
              row={row}
              inboxCount={previewInboxCount}
              inboxTotal={previewInboxTotal}
              windowDays={previewWindowDays}
              onWindowChange={onWindowChange}
              allMailCount={previewAllMailCount}
              allMailTotal={previewAllMailTotal}
              reach={pendingReach}
              onReachChange={onReachChange}
              wakeAt={wakeAt}
              confirming={busy}
              onConfirm={onConfirm}
              onCancel={onCancel}
            />
          )}
        </div>
      )}

      {/* SR announcement while the decision confirms server-side. */}
      {busy && (
        <span role="status" style={{ position: 'absolute', left: -9999 }}>
          Applying your decision for {row.senderName}
        </span>
      )}
    </div>
  );
}
