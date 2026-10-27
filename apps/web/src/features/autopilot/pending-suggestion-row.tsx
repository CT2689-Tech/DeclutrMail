'use client';

import { Button, tokens } from '@declutrmail/shared';
import type { AutopilotMatchDto, AutopilotRuleDto } from '@/lib/api/autopilot';
import { resolveSenderIdentity, SENDER_SYNCING_LABEL } from './sender-label';
import { MatchReasonCopy } from './match-reason-copy';
import styles from './review-queue.module.css';

const { color, font, text } = tokens;

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
  rule: _rule,
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
  const identity = resolveSenderIdentity(match);
  const senderLabel = identity.label;
  const isIdentified = identity.source !== 'unknown';

  return (
    <li
      className={styles.row}
      data-selected={selected ? 'true' : undefined}
      style={{
        position: 'relative',
        minHeight: 68,
        boxSizing: 'border-box',
        padding: '16px 0',
        fontFamily: font.sans,
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(match.id)}
        aria-label={`Select suggestion for ${senderLabel}`}
        style={{ accentColor: color.primary, width: 18, height: 18, flexShrink: 0, margin: 0 }}
      />
      <div className={styles.identity} style={{ minWidth: 0 }}>
        <div
          className={styles.identityHeading}
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {isIdentified ? (
            <span
              className={styles.name}
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
                borderRadius: 8,
              }}
              title={SENDER_SYNCING_LABEL}
            >
              {SENDER_SYNCING_LABEL}
            </span>
          )}
        </div>
        <div
          className={styles.metadata}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            marginTop: 4,
            fontSize: text.sm,
            color: color.fgMuted,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {identity.source === 'name' && match.senderEmail != null && (
            <>
              <span
                className={styles.email}
                style={{
                  fontFamily: font.sans,
                }}
              >
                {match.senderEmail}
              </span>
            </>
          )}
          <div className={styles.evidence}>
            <MatchReasonCopy reason={match.reason} />
          </div>
          {Number.isFinite(Date.parse(match.matchedAt)) && (
            <time dateTime={match.matchedAt}>
              Matched {new Date(match.matchedAt).toISOString().slice(0, 10)} UTC
            </time>
          )}
        </div>
      </div>
      <div className={styles.skip}>
        <Button
          tone="ghost"
          size="sm"
          onClick={() => onDismiss(match.id)}
          disabled={isDismissing}
          ariaLabel={`Skip suggestion for ${senderLabel} without changing Gmail`}
        >
          {isDismissing ? 'Skipping…' : 'Skip'}
        </Button>
      </div>
    </li>
  );
}
