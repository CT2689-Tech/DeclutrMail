'use client';

import { Avatar, Pill, tokens } from '@declutrmail/shared';
import type { PillTone } from '@declutrmail/shared';
import { ActionPreview, type PreviewCount } from './action-preview';
import { ActionToolbar } from './action-toolbar';
import type { TriageDecisionRow } from './data';
import { verdictToVerb, type ActionVerb, type TriageVerdict } from './types';
import { TriageRowExpanded } from './triage-row-expanded';

const { color, font } = tokens;

/** Pill tone per verdict — matches the toolbar's highlight semantics. */
const VERDICT_TONE: Record<TriageVerdict, PillTone> = {
  keep: 'primary',
  archive: 'dark',
  unsubscribe: 'amber',
  later: 'default',
};

/**
 * Tight one-line "why" for the collapsed row (D36 — critical info
 * default). Uses `last90dMessages` instead of the derived
 * `monthlyVolume = round(last90 / 3)` so a sender that mailed twice in
 * the last 90d reads as "2 in last 90d", not "0/mo" — the lie pattern
 * founder caught 2026-06-06 (same class as Sender Detail Bug 3).
 *
 * Quiet senders (no mail in 90d but real lifetime presence) get an
 * explicit "Quiet 90d" copy instead of a fabricated "0/mo".
 */
function whyLine(row: TriageDecisionRow): string {
  const pct = Math.round(row.readRate * 100);
  if (row.protectionReason === 'vip') return 'VIP — always kept';
  if (row.protectionReason === 'engagement') return `${pct}% read · engagement-protected`;
  if (row.protectionReason === 'auto-receipts') return 'Auto-protected receipts sender';
  if (row.protectionReason === 'auto-financial') return 'Auto-protected financial sender';
  if (row.last90dMessages === 0) {
    // Quiet within the rolling window — say so plainly. Lifetime total
    // carries the "they DID mail you" context without faking cadence.
    return `Quiet 90d · ${row.totalAllTime.toLocaleString()} lifetime`;
  }
  if (row.readRate === 0 && row.last90dMessages >= 8) {
    return `Never opened · ${row.last90dMessages} in last 90d`;
  }
  if (row.readRate < 0.2) return `${pct}% read · ${row.last90dMessages} in last 90d`;
  if (row.readRate >= 0.7) return `${pct}% read · keep close`;
  return `${pct}% read · ${row.last90dMessages} in last 90d`;
}

/**
 * One row in the triage queue (D36 — collapse/expand pattern).
 *
 * Collapsed: avatar, name, domain, verdict pill, one-line why,
 * recommended-verb hint. Click the row (or hit space/enter when
 * focused) to expand.
 *
 * Expanded: the toolbar (K/A/U/L per D29 / D227) becomes visible,
 * the row body extends with the stats grid + reasoning + signals
 * (via `<TriageRowExpanded>`), and if a pending action is open in
 * inline-preview mode the `<ActionPreview>` strip mounts beneath
 * the toolbar.
 *
 * Per D198 / D36 only one row is expanded at a time — the
 * `expanded` flag is driven from the feature's Zustand store so the
 * queue and the action sheet can both read it.
 */
export function TriageRow({
  row,
  expanded,
  busy = false,
  onToggleExpand,
  onAction,
  inlinePreview,
}: {
  row: TriageDecisionRow;
  expanded: boolean;
  /**
   * True while this row's decision is confirming server-side (D226 —
   * no optimistic removal). The row dims, the toolbar disables, and
   * the K/A/U/L shortcuts release until the server confirms.
   */
  busy?: boolean;
  onToggleExpand: () => void;
  onAction: (verb: ActionVerb) => void;
  /**
   * If present, the inline preview strip renders inside the
   * expanded row body — the D34 remember-preference path where the
   * sheet is suppressed but D226's preview is still mandatory.
   */
  inlinePreview?: { verb: ActionVerb; archiveHistoric: boolean; inboxCount: PreviewCount } | null;
}) {
  const recommendedVerb: ActionVerb | null =
    row.confidence > 0.85 ? verdictToVerb(row.verdict) : null;

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
        aria-controls={`triage-row-body-${row.id}`}
        aria-label={`${row.senderName} — ${expanded ? 'collapse' : 'expand'} triage detail`}
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
            {row.protectionReason !== null && (
              <span
                title="Protected — destructive verbs are disabled for this sender"
                style={{
                  padding: '1px 7px',
                  borderRadius: 4,
                  fontFamily: font.mono,
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  background: color.primarySoft,
                  color: color.primary,
                  border: `1px solid ${color.primaryBorder}`,
                  flexShrink: 0,
                }}
              >
                {row.protectionReason === 'vip' ? 'VIP' : 'Protected'}
              </span>
            )}
          </div>
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 10.5,
              color: color.fgMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.senderDomain}
          </span>
          {/* The why-line wraps below identity on narrow widths; it
              stays on one line on desktop because the grid template
              keeps the identity cell minmax(0, 1fr). */}
          <span
            style={{
              fontSize: 12,
              color: color.fgSoft,
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {whyLine(row)}
          </span>
        </div>

        {/* Verdict pill — the engine's current recommendation. */}
        <Pill tone={VERDICT_TONE[row.verdict]}>
          {verdictToVerb(row.verdict)}
          {recommendedVerb !== null && (
            <span style={{ fontFamily: font.mono, fontSize: 9.5, opacity: 0.85 }}>
              {' · '}
              {Math.round(row.confidence * 100)}%
            </span>
          )}
        </Pill>

        {/* Recommended verb hint — only when D31 highlight applies. */}
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: recommendedVerb !== null ? color.primary : color.fgMuted,
            visibility: recommendedVerb !== null ? 'visible' : 'hidden',
          }}
          aria-hidden={recommendedVerb === null}
        >
          Recommended
        </span>

        {/* Chevron — rotates to indicate expand state. */}
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

      {/* Expanded body — toolbar + stats + reasoning + (maybe) inline preview. */}
      {expanded && (
        <div id={`triage-row-body-${row.id}`} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px 0' }}>
            <ActionToolbar row={row} onAction={onAction} keyboardEnabled={!busy} disabled={busy} />
          </div>
          <TriageRowExpanded row={row} />
          {inlinePreview != null && (
            <div style={{ padding: '0 18px 18px' }}>
              <ActionPreview
                verb={inlinePreview.verb}
                row={row}
                archiveHistoric={inlinePreview.archiveHistoric}
                inboxCount={inlinePreview.inboxCount}
                mode="inline"
              />
            </div>
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
