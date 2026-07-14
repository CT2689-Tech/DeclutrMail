'use client';

import Link from 'next/link';
import { Avatar, Pill, tokens } from '@declutrmail/shared';
import type { PillTone } from '@declutrmail/shared';

import { firstSeenLabel, type ScreenerDecideVerb, type ScreenerQueueRow } from './data';
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
  wakeAt?: string | null;
  onToggleExpand: () => void;
  onVerbClick: (verb: ScreenerDecideVerb) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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
        <Avatar name={row.senderName} domain={row.senderDomain} size={32} />

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
            No category labels here, ever (D71 honours D22). */}
        {row.recommendation != null ? (
          <Pill tone={VERDICT_TONE[row.recommendation.verdict]}>
            {verdictLabel(row.recommendation.verdict)}
            <span style={{ fontFamily: font.mono, fontSize: 9.5, opacity: 0.85 }}>
              {' · '}
              {Math.round(row.recommendation.confidence * 100)}%
            </span>
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
              return (
                <button
                  key={verb}
                  type="button"
                  disabled={busy}
                  onClick={() => onVerbClick(verb)}
                  aria-pressed={active}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderRadius: 7,
                    fontFamily: font.sans,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: busy ? 'default' : 'pointer',
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
              · <span style={{ fontWeight: 600 }}>Messages so far:</span> {row.messageCount}
            </span>
            {row.recommendation != null && (
              <span style={{ fontSize: 12, color: color.fgMuted, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600, color: color.fgSoft }}>
                  Why this is suggested:{' '}
                </span>
                {row.recommendation.reasoning}
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
