'use client';

import { useState } from 'react';
import { Button, tokens } from '@declutrmail/shared';
import { useNow } from '@/lib/use-now';
import type { AutopilotMatchDto, AutopilotRuleDto } from '@/lib/api/autopilot';
import { PendingSuggestionRow } from './pending-suggestion-row';
import { presetDisplayName } from './preset-labels';
import styles from './review-queue.module.css';

const { color, text } = tokens;

/**
 * D104 — one rule's slice of the pending-suggestions buffer:
 *
 *   Pending suggestions from "Auto-archive low-engagement" (3 days left)
 *   ─────────────────────────────────────────────────────────────────
 *   [rows…]
 *   [ Approve all ]  [ Approve selected (n) ]
 *
 * Both approve buttons only OPEN the D226 preview modal (the screen
 * owns it); the mutation never fires from here. Orphan groups (rule
 * missing from the rules list) render rows + dismiss only — without
 * the rule we can't render a truthful verb preview, so no approve.
 */
export function SuggestionGroup({
  rule,
  matches,
  pendingApproximate = false,
  selectedIds,
  onToggleSelect,
  onDismiss,
  dismissingMatchId,
  onApproveAll,
  onApproveSelected,
}: {
  rule: AutopilotRuleDto | null;
  matches: AutopilotMatchDto[];
  pendingApproximate?: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (matchId: string) => void;
  onDismiss: (matchId: string) => void;
  dismissingMatchId: string | null;
  /** Opens the approve preview covering every match in this group. */
  onApproveAll: (rule: AutopilotRuleDto, matches: AutopilotMatchDto[]) => void;
  /** Opens the approve preview covering the selected subset. */
  onApproveSelected: (rule: AutopilotRuleDto, matches: AutopilotMatchDto[]) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const now = useNow();
  const name = rule == null ? 'Unknown rule' : presetDisplayName(rule.presetKey, rule.name);
  const selectedInGroup = matches.filter((m) => selectedIds.has(m.id));
  const daysLeft = observeDaysLeft(rule, now);
  const reviewAllLabel = pendingApproximate
    ? rule?.observeDigest?.pendingTotal != null
      ? `Review all ~${Math.max(rule.observeDigest.pendingTotal, matches.length)}`
      : 'Review all pending'
    : `Review all ${matches.length}`;

  return (
    <section aria-label={`Pending suggestions from ${name}`} className={styles.group}>
      <div className={styles.groupHeader}>
        <div>
          <h3>{name}</h3>
          <p>
            {rule
              ? {
                  archive: 'Archive',
                  later: 'Later',
                  unsubscribe: 'Unsubscribe',
                  delete: 'Delete',
                }[rule.actionKind]
              : 'Rule unavailable'}
            {' · '}
            {matches.length}{' '}
            {pendingApproximate
              ? 'sender matches on this page'
              : `sender match${matches.length === 1 ? '' : 'es'}`}
          </p>
          {daysLeft && <small>{daysLeft}</small>}
        </div>
        {rule != null && ruleCanApprove(rule) && (
          <div className={styles.groupActions}>
            <Button
              tone="default"
              size="sm"
              disabled={selectedInGroup.length === 0}
              onClick={() => onApproveSelected(rule, selectedInGroup)}
              ariaLabel={`Review selected suggestions from rule ${name}`}
            >
              Review selected{selectedInGroup.length > 0 ? ` (${selectedInGroup.length})` : ''}
            </Button>
            <Button
              tone="primary"
              size="sm"
              onClick={() => onApproveAll(rule, matches)}
              ariaLabel={`Review all suggestions from rule ${name}${pendingApproximate ? ' (including those not shown)' : ` (${matches.length})`}`}
            >
              {reviewAllLabel}
            </Button>
          </div>
        )}
      </div>

      <ul
        aria-label={`Pending suggestions from ${name} — rows`}
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {(showAll ? matches : matches.slice(0, 8)).map((match) => (
          <PendingSuggestionRow
            key={match.id}
            match={match}
            rule={rule}
            selected={selectedIds.has(match.id)}
            onToggleSelect={onToggleSelect}
            onDismiss={onDismiss}
            isDismissing={dismissingMatchId === match.id}
          />
        ))}
      </ul>

      {matches.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          style={{
            alignSelf: 'flex-start',
            border: 0,
            background: 'none',
            color: color.primary,
            cursor: 'pointer',
            fontSize: text.sm,
            padding: '10px 0',
          }}
        >
          {showAll ? 'Show fewer matches' : `Show all ${matches.length} matches`}
        </button>
      )}

      {/* Founder decision 2026-09-29 (a): approving is blocked while the
          rule is off or paused — resuming would otherwise run every
          waiting approval with no preview. Resume/turn it on from the
          rules list above. */}
      {rule != null && !ruleCanApprove(rule) && (
        <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted, textAlign: 'right' }}>
          {rule.mode === 'paused'
            ? 'Paused — resume this rule before approving.'
            : 'Off — enable this rule before approving.'}
        </p>
      )}
    </section>
  );
}

/** Approving is blocked while the rule is off or paused (founder decision 2026-09-29). */
function ruleCanApprove(rule: AutopilotRuleDto): boolean {
  return rule.enabled && rule.mode !== 'paused';
}

/** "(N days left)" while the rule's observe window is running (D104 header). */
function observeDaysLeft(rule: AutopilotRuleDto | null, now: number | null): string | null {
  if (rule == null || rule.mode !== 'observe' || rule.observeWindowEndsAt == null) return null;
  if (rule.observeWindowElapsed) return null;
  if (now === null) return null;
  const ends = new Date(rule.observeWindowEndsAt).getTime();
  if (Number.isNaN(ends)) return null;
  const days = Math.max(1, Math.ceil((ends - now) / (24 * 60 * 60 * 1000)));
  return `Watching period: ${days} day${days === 1 ? '' : 's'} remaining. You can review matches now.`;
}
