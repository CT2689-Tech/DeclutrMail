'use client';

import { Button, Eyebrow, tokens } from '@declutrmail/shared';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { observeDigestSummary } from './observe-digest';
import { presetDisplayName } from './preset-labels';

const { color, font } = tokens;

/**
 * D10 day-7 prompt — shown once a rule's 7-day Observe window has
 * elapsed (`observeWindowElapsed`, computed server-side) AND the rule
 * collected at least one pending match (`observeDigest.pendingTotal`,
 * uncapped server count — a silent week earns no prompt).
 *
 * Honest copy contract (D99/D192 locked semantics):
 *
 *   - Observe mode COLLECTS matches without acting. Nothing was
 *     archived, unsubscribed, or moved during the window.
 *   - There is NO auto-promotion. The rule keeps observing forever
 *     until the user explicitly switches it to Active — this banner
 *     is the explicit switch's entry point, not a countdown to one.
 *
 * Dismissible (D10): "Not now" persists `observe_prompt_dismissed_at`
 * on the rule row via PATCH, so the prompt stays gone across reloads.
 * A later mode change clears the dismissal server-side (a fresh
 * Observe window re-arms the prompt).
 *
 * Activation itself goes through the D226 preview modal
 * (`ActivateRuleModal`) — the banner only opens it.
 */
export function ObserveWindowBanner({
  rules,
  onActivate,
  onDismiss,
  dismissingRuleId,
}: {
  /**
   * Rules with `enabled && mode==='observe' && observeWindowElapsed &&
   * observePromptDismissedAt == null && observeDigest.pendingTotal > 0`
   * (the screen derives this set).
   */
  rules: AutopilotRuleDto[];
  /** Opens the activate preview modal for one rule. */
  onActivate: (rule: AutopilotRuleDto) => void;
  /** Persists the D10 prompt dismissal for one rule. */
  onDismiss: (rule: AutopilotRuleDto) => void;
  /** Rule whose dismissal PATCH is in flight (disables its buttons). */
  dismissingRuleId: string | null;
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
            ? 'Autopilot has been watching for a week.'
            : `Autopilot has been watching for a week — ${rules.length} rules are ready.`}
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
          const digest = observeDigestSummary(rule);
          const pending = rule.observeDigest?.pendingTotal ?? 0;
          const isDismissing = dismissingRuleId === rule.id;
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
                {digest != null
                  ? ` — ${lowerFirst(digest)}.`
                  : ` — ${pending} pending suggestion${pending === 1 ? '' : 's'} collected.`}{' '}
                Activate?
              </span>
              <Button
                tone="default"
                size="sm"
                onClick={() => onDismiss(rule)}
                disabled={isDismissing}
                ariaLabel={`Dismiss activation prompt for rule ${name}`}
              >
                {isDismissing ? 'Dismissing…' : 'Not now'}
              </Button>
              <Button
                tone="default"
                size="sm"
                onClick={() => onActivate(rule)}
                disabled={isDismissing}
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

/** "Would have archived…" → "would have archived…" for mid-sentence use. */
function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
