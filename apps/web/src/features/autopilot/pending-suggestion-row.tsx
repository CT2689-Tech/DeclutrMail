'use client';

import { Button, Pill, tokens } from '@declutrmail/shared';
import type { AutopilotMatchDto, AutopilotRuleDto } from '@/lib/api/autopilot';
import { describeWouldAction } from './action-label';
import { presetDisplayName } from './preset-labels';

const { color, font } = tokens;

/**
 * One row in the D104 "Pending Autopilot suggestions" list.
 *
 * Each row is one (rule, sender) pair: rule name + short sender-key
 * preview + the verb phrase the rule would emit ("would archive") +
 * a single Dismiss action. There is no Approve button at V2 — the
 * Observe-mode prompt for activation lives in the per-rule day-7
 * banner, NOT on individual rows (per D10/D104). Approving a single
 * sender out of Observe is intentionally not exposed; the user either
 * lets the rule keep observing, dismisses individual matches that look
 * wrong, or flips the whole rule to Active.
 *
 * Privacy: `senderKey` is the sha256 hex digest (D7). We surface the
 * first 8 chars as a stable identifier so the founder can correlate
 * rows across sessions without ever exposing the underlying email.
 */
export function PendingSuggestionRow({
  match,
  rule,
  onDismiss,
  isDismissing,
}: {
  match: AutopilotMatchDto;
  rule: AutopilotRuleDto | null;
  onDismiss: (matchId: string) => void;
  isDismissing: boolean;
}) {
  const ruleName = rule == null ? 'Unknown rule' : presetDisplayName(rule.presetKey, rule.name);
  const wouldVerb = rule ? describeWouldAction(rule.actionKind) : 'would act';
  const senderPreview = match.senderKey.slice(0, 8);
  const confidencePct = Math.round(match.confidence * 100);

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: color.card,
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 10,
        fontFamily: font.sans,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 11.5,
              fontWeight: 600,
              color: color.fg,
              padding: '2px 7px',
              background: color.paper,
              border: `1px solid ${color.line}`,
              borderRadius: 5,
            }}
            title={`Sender key (sha256, truncated): ${match.senderKey}`}
          >
            sender·{senderPreview}
          </span>
          <span style={{ fontSize: 13, color: color.fg, fontWeight: 500 }}>{wouldVerb}</span>
          <Pill tone="default">{ruleName}</Pill>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 4,
            fontSize: 11.5,
            color: color.fgMuted,
          }}
        >
          <span title="Engine confidence at match time">{confidencePct}% confidence</span>
          <span aria-hidden="true">·</span>
          <span>{match.reason}</span>
        </div>
      </div>
      <Button
        tone="default"
        size="sm"
        onClick={() => onDismiss(match.id)}
        disabled={isDismissing}
        ariaLabel={`Dismiss suggestion for sender ${senderPreview}`}
      >
        {isDismissing ? 'Dismissing…' : 'Dismiss'}
      </Button>
    </li>
  );
}
