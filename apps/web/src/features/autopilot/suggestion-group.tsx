'use client';

import { Button, tokens } from '@declutrmail/shared';
import type { AutopilotMatchDto, AutopilotRuleDto } from '@/lib/api/autopilot';
import { PendingSuggestionRow } from './pending-suggestion-row';
import { presetDisplayName } from './preset-labels';

const { color, font } = tokens;

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
  selectedIds,
  onToggleSelect,
  onDismiss,
  dismissingMatchId,
  onApproveAll,
  onApproveSelected,
}: {
  rule: AutopilotRuleDto | null;
  matches: AutopilotMatchDto[];
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (matchId: string) => void;
  onDismiss: (matchId: string) => void;
  dismissingMatchId: string | null;
  /** Opens the approve preview covering every match in this group. */
  onApproveAll: (rule: AutopilotRuleDto, matches: AutopilotMatchDto[]) => void;
  /** Opens the approve preview covering the selected subset. */
  onApproveSelected: (rule: AutopilotRuleDto, matches: AutopilotMatchDto[]) => void;
}) {
  const name = rule == null ? 'Unknown rule' : presetDisplayName(rule.presetKey, rule.name);
  const selectedInGroup = matches.filter((m) => selectedIds.has(m.id));
  const daysLeft = observeDaysLeft(rule);

  return (
    <section
      aria-label={`Pending suggestions from ${name}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <h3
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: '-0.008em',
            margin: 0,
            color: color.fgSoft,
          }}
        >
          From <span style={{ color: color.fg }}>“{name}”</span>
          {daysLeft != null && (
            <span style={{ fontWeight: 400, color: color.fgMuted }}> · {daysLeft}</span>
          )}
        </h3>
        <span style={{ fontSize: 11, color: color.fgMuted, fontFamily: font.mono }}>
          {matches.length} waiting
        </span>
      </div>

      <ul
        aria-label={`Pending suggestions from ${name} — rows`}
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {matches.map((match) => (
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

      {rule != null && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button
            tone="default"
            size="sm"
            onClick={() => onApproveSelected(rule, selectedInGroup)}
            disabled={selectedInGroup.length === 0}
            ariaLabel={`Approve selected suggestions from rule ${name}`}
          >
            Approve selected{selectedInGroup.length > 0 ? ` (${selectedInGroup.length})` : ''}
          </Button>
          <Button
            tone="default"
            size="sm"
            onClick={() => onApproveAll(rule, matches)}
            ariaLabel={`Approve all suggestions from rule ${name}`}
          >
            Approve all
          </Button>
        </div>
      )}
    </section>
  );
}

/** "(N days left)" while the rule's observe window is running (D104 header). */
function observeDaysLeft(rule: AutopilotRuleDto | null): string | null {
  if (rule == null || rule.mode !== 'observe' || rule.observeWindowEndsAt == null) return null;
  if (rule.observeWindowElapsed) return 'observe window complete';
  const ends = new Date(rule.observeWindowEndsAt).getTime();
  if (Number.isNaN(ends)) return null;
  const days = Math.max(1, Math.ceil((ends - Date.now()) / (24 * 60 * 60 * 1000)));
  return `${days} day${days === 1 ? '' : 's'} left`;
}
