'use client';

import Link from 'next/link';
import { Avatar, Pill, tokens } from '@declutrmail/shared';
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

const { color, font } = tokens;

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
  previewAllMailCount = null,
  pendingReach = 'inbox_only',
  onReachChange,
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
  /** ADR-0028 all-mail count — `null` hides the Delete reach chips. */
  previewAllMailCount?: number | null;
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

  return (
    <div
      aria-busy={busy}
      style={{
        background: color.card,
        border: `1px solid ${expanded ? color.primaryBorder : color.line}`,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: expanded
          ? '0 8px 24px -8px rgba(20,30,50,0.10), 0 2px 6px -2px rgba(20,30,50,0.05)'
          : '0 1px 2px rgba(20,30,50,0.04)',
        transition: 'border-color 0.15s, box-shadow 0.15s, opacity 0.15s',
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
        aria-label={`${row.senderName} — ${expanded ? 'collapse' : 'expand'} new-sender detail`}
        style={{
          display: 'grid',
          gridTemplateColumns: '32px minmax(0, 1fr) auto auto 18px',
          gap: 12,
          alignItems: 'center',
          padding: '12px 14px',
          cursor: 'pointer',
          background: expanded ? 'rgba(0,107,95,0.04)' : 'transparent',
        }}
        onMouseEnter={(e) => {
          if (!expanded) e.currentTarget.style.background = 'rgba(14,20,19,0.018)';
        }}
        onMouseLeave={(e) => {
          if (!expanded) e.currentTarget.style.background = 'transparent';
        }}
      >
        <Avatar name={row.senderName} domain={row.senderDomain} size={32} hasMark={row.brandMark} />

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: 14,
                letterSpacing: '-0.005em',
                color: color.fg,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {row.senderName}
            </span>
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 10.5,
                color: color.fgMuted,
                flexShrink: 0,
              }}
            >
              {row.senderDomain}
            </span>
          </div>
          {/* Sample subject — the latest message (D71). */}
          <span
            style={{
              fontSize: 12,
              color: color.fgSoft,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.sampleSubject || 'No subject'}
          </span>
        </div>

        {/* First seen — relative (D71). */}
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10.5,
            color: color.fgMuted,
            whiteSpace: 'nowrap',
          }}
        >
          {firstSeenLabel(row.firstSeenAt)}
        </span>

        {/* Engine recommendation pip — verdict + confidence (D71).
            No category labels here, ever (D71 honours D22).

            The confidence reads as a WORD, not a rounded percentage —
            same source as Triage's pill, so the two surfaces cannot
            describe the same read differently. See
            `@declutrmail/shared/copy/engine-confidence` for why the
            cascade's number does not support two digits. */}
        {row.recommendation != null ? (
          <Pill tone={VERDICT_TONE[row.recommendation.verdict]}>
            {verdictLabel(row.recommendation.verdict)}
            {(() => {
              const band = confidenceBand(
                row.recommendation.verdict,
                row.recommendation.confidence,
              );
              return band === null ? null : (
                <span style={{ fontFamily: font.mono, fontSize: 9.5, opacity: 0.85 }}>
                  {' · '}
                  {band}
                </span>
              );
            })()}
          </Pill>
        ) : (
          <span style={{ fontFamily: font.mono, fontSize: 10, color: color.fgMuted }}>New</span>
        )}

        {/* Chevron. */}
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: color.fgMuted,
            fontFamily: font.mono,
            fontSize: 14,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        >
          ›
        </span>
      </div>

      {/* Expanded body (D73) — toolbar + detail + (maybe) the preview. */}
      {expanded && (
        <div
          id={`screener-row-body-${row.id}`}
          style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px 16px' }}
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
                  disabled={busy || noUnsubscribeChannel}
                  onClick={() => onVerbClick(verb)}
                  aria-pressed={active}
                  title={unsubscribeBlockedReason ?? undefined}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderRadius: 7,
                    fontFamily: font.sans,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: busy || noUnsubscribeChannel ? 'not-allowed' : 'pointer',
                    opacity: noUnsubscribeChannel ? 0.55 : 1,
                    border: `1px solid ${
                      active ? (verb === 'delete' ? color.red : color.primary) : color.line
                    }`,
                    background: active
                      ? verb === 'delete'
                        ? 'rgba(190,30,30,0.08)'
                        : color.primarySoft
                      : color.card,
                    color: active
                      ? verb === 'delete'
                        ? color.red
                        : color.primary
                      : verb === 'delete'
                        ? color.red
                        : color.fg,
                  }}
                >
                  {VERB_LABEL[verb]}
                  <span
                    aria-hidden="true"
                    style={{
                      fontFamily: font.mono,
                      fontSize: 9.5,
                      color: color.fgMuted,
                      border: `1px solid ${color.lineSoft}`,
                      borderRadius: 4,
                      padding: '0 4px',
                    }}
                  >
                    {VERB_KEY_HINT[verb]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Detail grid — first seen, count so far, engine reasoning. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: color.fgSoft }}>
              <span style={{ fontWeight: 600 }}>First seen:</span> {firstSeenLabel(row.firstSeenAt)}{' '}
              ·{' '}
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
                title="Inbound messages received from this sender and still within DeclutrMail's retention — archived mail included, not inbox-only. Mail deleted from Gmail drops out of this count. The second number is how many are in your inbox right now — mail in the archive, Spam, or Trash is received but not in the inbox, so an inbox action can find fewer matches than were received."
              >
                Messages received:
              </span>{' '}
              {row.messageCount.toLocaleString('en-US')} · {row.inboxCount.toLocaleString('en-US')}{' '}
              in inbox
            </span>
            {row.recommendation != null && (
              <span style={{ fontSize: 12, color: color.fgMuted, lineHeight: 1.5 }}>
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
                    style={{ fontFamily: font.mono, fontSize: 9.5, color: color.fgMuted }}
                  >{` · ${ageLabel}`}</span>
                )}
              </span>
            )}
            <Link
              href={`/senders/${row.senderId}`}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: color.primary,
                textDecoration: 'none',
                width: 'fit-content',
              }}
            >
              Open sender →
            </Link>
          </div>

          {/* The mandatory D226 preview — mounts when a verb is pending. */}
          {pendingVerb != null && (
            <DecidePreview
              verb={pendingVerb}
              row={row}
              inboxCount={previewInboxCount}
              allMailCount={previewAllMailCount}
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
