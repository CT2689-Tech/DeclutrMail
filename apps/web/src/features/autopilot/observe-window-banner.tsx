'use client';

import { Button, Eyebrow, tokens } from '@declutrmail/shared';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { presetDisplayName } from './preset-labels';

const { color, font } = tokens;

/**
 * D104 day-7 prompt — shown once a rule's 7-day Observe window has
 * elapsed (`observeWindowElapsed`, computed server-side).
 *
 * Honest copy contract (D99/D192 locked semantics):
 *
 *   - Observe mode COLLECTS matches without acting. Nothing was
 *     archived, unsubscribed, or moved during the window.
 *   - There is NO auto-promotion. The rule keeps observing forever
 *     until the user explicitly switches it to Active — this banner
 *     is the explicit switch's entry point, not a countdown to one.
 *
 * Activation itself goes through the D226 preview modal
 * (`ActivateRuleModal`) — the banner only opens it.
 */
export function ObserveWindowBanner({
  rules,
  pendingCountByRule,
  pendingApproximate,
  onActivate,
}: {
  /** Rules with `observeWindowElapsed && mode==='observe' && enabled`. */
  rules: AutopilotRuleDto[];
  pendingCountByRule: Map<string, number>;
  /**
   * True when the pending buffer hit the BE's 50-row page cap — the
   * per-rule counts are then floors, not totals (honest copy below).
   */
  pendingApproximate: boolean;
  /** Opens the activate preview modal for one rule. */
  onActivate: (rule: AutopilotRuleDto) => void;
}) {
  if (rules.length === 0) return null;

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        background: color.paper,
        border: `1px solid ${color.border}`,
        borderRadius: 10,
        fontFamily: font.sans,
      }}
    >
      <div>
        <Eyebrow>Observe window complete</Eyebrow>
        <div style={{ fontSize: 13, fontWeight: 600, color: color.fg, margin: '2px 0 0' }}>
          {rules.length === 1
            ? '1 rule finished its 7-day observe window.'
            : `${rules.length} rules finished their 7-day observe windows.`}
        </div>
        <div style={{ fontSize: 11.5, color: color.fgMuted, marginTop: 4, lineHeight: 1.5 }}>
          During the window, matches were collected as suggestions without touching your mail.
          Nothing switches on by itself — each rule keeps observing until you explicitly switch it
          to Active.
        </div>
      </div>

      <ul
        aria-label="Rules ready to activate"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {rules.map((rule) => {
          const name = presetDisplayName(rule.presetKey, rule.name);
          const pending = pendingCountByRule.get(rule.id) ?? 0;
          return (
            <li
              key={rule.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 12.5,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, color: color.fgSoft }}>
                <strong style={{ color: color.fg, fontWeight: 600 }}>{name}</strong>
                {pendingApproximate
                  ? ` has ${pending} pending suggestion${pending === 1 ? '' : 's'} in the latest 50 below.`
                  : ` collected ${pending} pending suggestion${pending === 1 ? '' : 's'} during its window.`}
              </span>
              <Button
                tone="default"
                size="sm"
                onClick={() => onActivate(rule)}
                ariaLabel={`Switch rule ${name} to Active`}
              >
                Switch to Active…
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
