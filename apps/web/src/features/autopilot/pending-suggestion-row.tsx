'use client';

import { Button, tokens } from '@declutrmail/shared';
import type { AutopilotMatchDto, AutopilotRuleDto } from '@/lib/api/autopilot';
import { describeWouldAction } from './action-label';
import { resolveSenderIdentity, SENDER_SYNCING_LABEL } from './sender-label';

const { color, font, motion, radius, text } = tokens;

/** Flat list on desktop; a readable, stacked decision on narrow screens. */
const SUGGESTION_ROW_CSS = `.dm-suggestion-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  margin: 0 -12px;
  transition: background ${motion.fast} ${motion.ease};
}
.dm-suggestion-heading { align-items: baseline; }
.dm-suggestion-metadata { align-items: center; }
.dm-suggestion-name { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dm-suggestion-email { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dm-suggestion-row + .dm-suggestion-row::before { content: ''; position: absolute; top: 0; left: 42px; right: 12px; height: 1px; background: ${color.lineSoft}; }
.dm-suggestion-row:hover { background: ${color.fill}; }
.dm-suggestion-row[data-selected='true'] { background: ${color.primarySoft}; }
.dm-suggestion-row:hover::before, .dm-suggestion-row:hover + .dm-suggestion-row::before,
.dm-suggestion-row[data-selected='true']::before, .dm-suggestion-row[data-selected='true'] + .dm-suggestion-row::before { opacity: 0; }
@media (max-width: 600px) {
  .dm-suggestion-row { grid-template-columns: 18px minmax(0, 1fr); align-items: start; margin: 0; }
  .dm-suggestion-content { min-width: 0; }
  .dm-suggestion-heading, .dm-suggestion-metadata { flex-direction: column; align-items: flex-start; }
  .dm-suggestion-name, .dm-suggestion-email {
    min-width: 0;
    max-width: 100%;
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .dm-suggestion-email { width: 100%; }
  .dm-suggestion-separator { display: none; }
  .dm-suggestion-reason { overflow-wrap: anywhere; }
  .dm-suggestion-skip { grid-column: 2; width: 100%; }
  .dm-suggestion-skip button { width: 100%; }
}`;

/**
 * One row in a D104 "Pending Autopilot suggestions" group.
 *
 * Each row is one (rule, sender) pair: a select checkbox (feeds the
 * group's "Approve selected"), sender identity + the verb phrase the
 * rule would emit ("would archive") + a per-row Skip suggestion. Approving
 * goes through the group's Approve buttons + the D226 preview modal —
 * never a one-click mutation on the row itself. The rule name renders
 * once in the group header, not per row.
 *
 * Privacy: `senderKey` is the sha256 hex digest (D7). `senderName` +
 * `senderEmail` come from the senders table — both ARE on the D7
 * storage allowlist (sender identity is the FIRST item). We render
 * name + email when present, fall back to the address alone when the
 * `From` header carried no display name, and only claim "still
 * syncing" when neither exists (see `sender-label.ts`).
 */
export function PendingSuggestionRow({
  match,
  rule,
  selected,
  onToggleSelect,
  onDismiss,
  isDismissing,
}: {
  match: AutopilotMatchDto;
  rule: AutopilotRuleDto | null;
  selected: boolean;
  onToggleSelect: (matchId: string) => void;
  onDismiss: (matchId: string) => void;
  isDismissing: boolean;
}) {
  const wouldVerb = rule ? describeWouldAction(rule.actionKind) : 'would act';
  const identity = resolveSenderIdentity(match);
  const senderLabel = identity.label;
  const isIdentified = identity.source !== 'unknown';

  return (
    <li
      className="dm-suggestion-row"
      data-selected={selected ? 'true' : undefined}
      style={{
        position: 'relative',
        minHeight: 68,
        boxSizing: 'border-box',
        padding: '12px',
        borderRadius: radius.lg,
        fontFamily: font.sans,
      }}
    >
      <style>{SUGGESTION_ROW_CSS}</style>
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(match.id)}
        aria-label={`Select suggestion for ${senderLabel}`}
        style={{ accentColor: color.primary, width: 18, height: 18, flexShrink: 0, margin: 0 }}
      />
      <div className="dm-suggestion-content" style={{ minWidth: 0 }}>
        <div
          className="dm-suggestion-heading"
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {isIdentified ? (
            <span
              className="dm-suggestion-name"
              style={{
                fontSize: text.md,
                fontWeight: 600,
                color: color.fg,
              }}
              title={match.senderEmail ?? senderLabel}
            >
              {senderLabel}
            </span>
          ) : (
            <span
              style={{
                fontSize: text.xs,
                fontWeight: 600,
                color: color.fgSoft,
                padding: '2px 8px',
                background: color.fill,
                borderRadius: radius.pill,
              }}
              title={SENDER_SYNCING_LABEL}
            >
              {SENDER_SYNCING_LABEL}
            </span>
          )}
          <span style={{ fontSize: text.md, color: color.fg, fontWeight: 500 }}>{wouldVerb}</span>
        </div>
        <div
          className="dm-suggestion-metadata"
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 2,
            fontSize: text.sm,
            color: color.fgMuted,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {identity.source === 'name' && match.senderEmail != null && (
            <>
              <span
                className="dm-suggestion-email"
                style={{
                  fontFamily: font.sans,
                }}
              >
                {match.senderEmail}
              </span>
              <span className="dm-suggestion-separator" aria-hidden="true">
                ·
              </span>
            </>
          )}
          <span className="dm-suggestion-reason">Why suggested: {match.reason}</span>
        </div>
      </div>
      <div className="dm-suggestion-skip">
        <Button
          tone="ghost"
          size="sm"
          onClick={() => onDismiss(match.id)}
          disabled={isDismissing}
          ariaLabel={`Skip suggestion for ${senderLabel} without changing Gmail`}
        >
          {isDismissing ? 'Skipping…' : 'Skip suggestion'}
        </Button>
      </div>
    </li>
  );
}
