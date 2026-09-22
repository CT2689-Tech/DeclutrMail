'use client';

import Link from 'next/link';

import { Button, tokens } from '@declutrmail/shared';
import { TIER_MANIFEST, minimumTierForCapability } from '@declutrmail/shared/entitlements';

import { billingIntentPath } from '@/features/billing/billing-intent';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { bannerSurface } from './autopilot-banner-stack';
import { observeDigestSummary } from './observe-digest';
import { presetDisplayName } from './preset-labels';
import styles from './observe-window-banner.module.css';

const { color, text } = tokens;

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
  canActivate,
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
  /**
   * D251 — whether this workspace may let rules act unattended
   * (`autopilot-active` capability, Pro). Plus reaches this screen with
   * `autopilot` and can review and approve matches, but MUST NOT
   * be offered Activate: the PATCH would 402 and the modal would quote
   * Pro's undo window. REQUIRED and undefaulted on purpose — a
   * permissive default would hand the Activate button back to any new
   * call site that forgets the prop, silently (design-gate S2).
   */
  canActivate: boolean;
}) {
  // Derived, not hand-rolled (design-gate S3): the plan that grants
  // unattended action, and the canonical checkout path for it. B4/B5 in
  // the same review are what one hardcoded "Pro" looks like a ladder-move
  // later.
  const actTier = minimumTierForCapability('autopilot-active');
  const actPlan = actTier === 'pro' ? ('pro' as const) : ('plus' as const);
  const actName = TIER_MANIFEST[actTier].name;
  const upgradeHref = billingIntentPath({ plan: actPlan, cycle: 'monthly' });
  if (rules.length === 0) return null;

  return (
    <div
      role="status"
      style={{ ...bannerSurface, display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {/* Under-tier and entitled alike get no sub-line: each row below
          already says what to do next. */}
      <div style={{ fontSize: text.md, fontWeight: 600, color: color.fg }}>
        {rules.length === 1
          ? 'Autopilot has collected matches for a week.'
          : `Autopilot has collected matches for a week — ${rules.length} rules are ready.`}
      </div>

      <ul
        aria-label={canActivate ? 'Rules ready to activate' : 'Rules with matches ready to review'}
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
            <li key={rule.id} className={styles.rule} style={{ fontSize: text.sm }}>
              <span className={styles.copy} style={{ color: color.fgSoft }}>
                <strong style={{ color: color.fg, fontWeight: 600 }}>{name}</strong>
                {digest != null
                  ? ` — ${lowerFirst(digest)}.`
                  : ` — ${pending} pending suggestion${pending === 1 ? '' : 's'} collected.`}{' '}
                {canActivate ? 'Activate?' : 'Approve or dismiss them below.'}
              </span>
              <div className={styles.actions}>
                <Button
                  tone="default"
                  size="sm"
                  onClick={() => onDismiss(rule)}
                  disabled={isDismissing}
                  ariaLabel={
                    canActivate
                      ? `Dismiss activation prompt for rule ${name}`
                      : `Dismiss this prompt for rule ${name}`
                  }
                >
                  {isDismissing ? 'Dismissing…' : 'Not now'}
                </Button>
                {canActivate ? (
                  <Button
                    tone="default"
                    size="sm"
                    onClick={() => onActivate(rule)}
                    disabled={isDismissing}
                    ariaLabel={`Switch rule ${name} to Active`}
                  >
                    Switch to Active…
                  </Button>
                ) : (
                  // D251 — a link to the upgrade, never a disabled Activate
                  // button. A greyed-out control reads as "temporarily
                  // unavailable"; this states the actual reason and where to
                  // go, and it can never fire a request that 402s.
                  <Link
                    href={upgradeHref}
                    style={{
                      fontSize: text.sm,
                      fontWeight: 600,
                      color: color.fg,
                      textDecoration: 'underline',
                    }}
                    aria-label={`Run rule ${name} without asking — requires ${actName}`}
                  >
                    Run without asking → {actName}
                  </Link>
                )}
              </div>
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
