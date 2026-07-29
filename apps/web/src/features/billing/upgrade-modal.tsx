'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import { Button, Eyebrow, tokens, useFocusTrap } from '@declutrmail/shared';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { useTier } from '@/features/auth/api/use-tier';
import {
  useUpgradeGateStore,
  type ActionTierDetails,
  type FreeCapDetails,
  type InboxLimitDetails,
} from '@/lib/entitlements/upgrade-gate';
import { track } from '@/lib/posthog';

import { billingIntentPath } from './billing-intent';
import { MONEY_BACK_NOTE, quotedPlanPrice } from './billing-model';
import { useRegionProvider } from './billing-currency';

const { color, font, radius } = tokens;

/**
 * UpgradeModal (D19/D77/D81 — the U13 modal-grade upgrade flow).
 *
 * Renders when the global MutationCache handler (lib/query-client)
 * reports an entitlement 402 into the upgrade-gate store:
 *
 *   - `FREE_CAP_REACHED` — the Free tier's monthly cleanup-action
 *     quota is spent (or the attempted bulk needs more than remain).
 *   - `INBOX_LIMIT_REACHED` — connecting another Gmail account would
 *     exceed the tier's inbox limit.
 *   - `ACTION_TIER_REQUIRED` — an Action Registry selector requires a
 *     higher plan (A3: only all-matching cleanup sits above Free).
 *
 * Copy is tier-appropriate per D123's nudge ladder: Free hears what
 * Plus/Pro unlock, Plus hears the Pro automation set, Pro gets the
 * honest limit statement with NO upgrade nudge (nothing to sell).
 * Pro pricing lines carry the D121 30-day money-back note.
 *
 * Mounted once in the authed app chrome — never per feature screen.
 */
export function UpgradeModal() {
  const hit = useUpgradeGateStore((s) => s.hit);
  const dismiss = useUpgradeGateStore((s) => s.dismiss);
  const { tier } = useTier();

  useEffect(() => {
    if (!hit) return;
    void track('upgrade_prompt_shown', { reason: hit.reason, source: 'upgrade_modal' });
  }, [hit]);

  useEffect(() => {
    if (!hit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hit, dismiss]);

  const trapRef = useFocusTrap<HTMLDivElement>(hit != null);
  // Hooks before the early return — calling useRegionProvider below
  // `if (!hit) return null` fired a hook-order violation the moment a
  // 402 flipped `hit` on a mounted modal (billing audit 2026-07-28).
  const regionProvider = useRegionProvider();

  if (!hit) return null;

  // Pro+ tiers have no upgrade path to offer (Team isn't purchasable)
  // — the honest limit statement with no nudge (D123's Pro rung).
  const nudge = tier === 'free' || tier === 'plus';
  const proMonthly = quotedPlanPrice('pro', 'monthly', regionProvider);
  const actionTier = hit.reason === 'action_tier' ? hit.details.requiredTier : null;
  const actionTierName = actionTier ? TIER_MANIFEST[actionTier].name : null;
  const actionTierMonthly = actionTier
    ? quotedPlanPrice(actionTier, 'monthly', regionProvider)
    : null;

  // ONE checkout path (D117): the CTA deep-links the nudged plan into
  // /billing's confirm step via the same validated intent the pricing
  // page uses — the copy above quotes monthly prices, so the intent
  // carries `monthly` (the billing screen's toggle flips it in place).
  const targetPlan: 'plus' | 'pro' = hit.reason === 'free_cap' ? 'plus' : (actionTier ?? 'pro');
  const upgradeHref = billingIntentPath({ plan: targetPlan, cycle: 'monthly' });
  const upgradeLabel = `Upgrade to ${TIER_MANIFEST[targetPlan].name}`;

  return (
    <>
      <div
        onClick={dismiss}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 150,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-upgrade-title"
        data-testid="upgrade-modal"
        style={{
          position: 'fixed',
          top: '18vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(460px, calc(100vw - 32px))',
          maxHeight: '70vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: 14,
          border: `1px solid ${color.border}`,
          boxShadow: '0 24px 60px rgba(14,20,19,0.30)',
          zIndex: 151,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '20px 24px 16px' }}>
          <Eyebrow>
            {hit.reason === 'free_cap'
              ? 'Free plan limit'
              : hit.reason === 'action_tier'
                ? `${actionTierName} workflow`
                : 'Inbox limit'}
          </Eyebrow>
          <h2
            id="dm-upgrade-title"
            style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.014em', margin: '6px 0 0' }}
          >
            {hit.reason === 'free_cap'
              ? freeCapTitle(hit.details)
              : hit.reason === 'action_tier'
                ? actionTierTitle(hit.details)
                : inboxLimitTitle(hit.details, tierName(tier))}
          </h2>
          <p style={{ fontSize: 13, color: color.fgSoft, margin: '8px 0 0', lineHeight: 1.55 }}>
            {hit.reason === 'free_cap' ? (
              <>
                Completed mail actions stay in place
                {hit.details.resetsAt
                  ? ` — your quota resets on ${resetDateLabel(hit.details.resetsAt)}`
                  : ''}
                . {TIER_MANIFEST.plus.name} unlocks unlimited cleanup for{' '}
                {quotedPlanPrice('plus', 'monthly', regionProvider)}. {TIER_MANIFEST.pro.name} could
                do this for you automatically &mdash; Autopilot, Daily Brief, and Quiet Hours for{' '}
                {proMonthly}.
              </>
            ) : hit.reason === 'action_tier' ? (
              <>
                Your plan covers every selection this size and smaller. {actionTierName} unlocks{' '}
                {hit.details.selector === 'sender-filter'
                  ? 'all-matching cleanup'
                  : 'this workflow'}
                {actionTierMonthly ? ` for ${actionTierMonthly}` : ''}.
              </>
            ) : nudge ? (
              <>
                Your existing connection{hit.details.connected === 1 ? ' keeps' : 's keep'} working
                &mdash; only adding is blocked. {TIER_MANIFEST.pro.name} raises the limit to{' '}
                {TIER_MANIFEST.pro.inboxLimit} connected inboxes for {proMonthly}.
              </>
            ) : (
              <>
                All {hit.details.connected} in use. Disconnect an account from the account menu to
                connect a different one.
              </>
            )}
          </p>
          {nudge ? (
            <p style={{ fontSize: 12, color: color.fgMuted, margin: '10px 0 0' }}>
              {proMonthly} &mdash; {MONEY_BACK_NOTE}
            </p>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '14px 24px 18px',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          {nudge ? (
            <>
              <Button tone="default" onClick={dismiss}>
                Not now
              </Button>
              <Link
                href={upgradeHref}
                onClick={dismiss}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  height: 32,
                  padding: '0 14px',
                  background: color.primary,
                  color: '#FFFFFF',
                  borderRadius: radius.md,
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                {upgradeLabel}
              </Link>
            </>
          ) : (
            <Button tone="default" onClick={dismiss}>
              Keep current inboxes
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function freeCapTitle(d: FreeCapDetails): string {
  return d.requiredUnits > 1 && d.remaining > 0
    ? `That needs ${d.requiredUnits} cleanup actions — only ${d.remaining} of your ${d.limit} are left this month`
    : `You've used all ${d.limit} cleanup actions for this month`;
}

/** Short, locale-stable "Aug 27" label for the server's reset instant. */
function resetDateLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'your next monthly reset'
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function inboxLimitTitle(d: InboxLimitDetails, tierLabel: string): string {
  return `Your ${tierLabel} plan includes ${d.limit} connected ${d.limit === 1 ? 'inbox' : 'inboxes'}`;
}

function actionTierTitle(d: ActionTierDetails): string {
  const plan = TIER_MANIFEST[d.requiredTier].name;
  return d.selector === 'sender-filter'
    ? `All-matching actions are part of ${plan}`
    : d.selector === 'multi-sender'
      ? `Multi-sender actions are part of ${plan}`
      : `This action is part of ${plan}`;
}

function tierName(tier: string): string {
  return tier === 'free' ||
    tier === 'plus' ||
    tier === 'pro' ||
    tier === 'team' ||
    tier === 'enterprise'
    ? TIER_MANIFEST[tier].name
    : tier.charAt(0).toUpperCase() + tier.slice(1);
}
