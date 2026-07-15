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

import { MONEY_BACK_NOTE, planPriceLabel } from './billing-model';

const { color, font, radius } = tokens;

/**
 * UpgradeModal (D19/D77/D81 — the U13 modal-grade upgrade flow).
 *
 * Renders when the global MutationCache handler (lib/query-client)
 * reports an entitlement 402 into the upgrade-gate store:
 *
 *   - `FREE_CAP_REACHED` — the Free tier's 5 lifetime cleanup actions
 *     are spent (or the attempted bulk needs more than remain).
 *   - `INBOX_LIMIT_REACHED` — connecting another Gmail account would
 *     exceed the tier's inbox limit.
 *   - `ACTION_TIER_REQUIRED` — an Action Registry selector requires a
 *     higher plan (Free multi-sender actions require Plus).
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

  if (!hit) return null;

  // Pro+ tiers have no upgrade path to offer (Team isn't purchasable)
  // — the honest limit statement with no nudge (D123's Pro rung).
  const nudge = tier === 'free' || tier === 'plus';
  const proMonthly = planPriceLabel('pro', 'monthly');
  const actionTier = hit.reason === 'action_tier' ? hit.details.requiredTier : null;
  const actionTierName = actionTier ? TIER_MANIFEST[actionTier].name : null;
  const actionTierMonthly = actionTier ? planPriceLabel(actionTier, 'monthly') : null;

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
                Completed mail actions stay in place. Plus unlocks unlimited sender actions for{' '}
                {planPriceLabel('plus', 'monthly')}. Pro could do this for you automatically &mdash;
                Autopilot, Daily Brief, and Quiet Hours for {proMonthly}.
              </>
            ) : hit.reason === 'action_tier' ? (
              <>
                Free still includes five lifetime cleanup actions, one sender at a time. Select one
                sender to continue, or {actionTierName} unlocks multi-sender cleanup
                {actionTierMonthly ? ` for ${actionTierMonthly}` : ''}.
              </>
            ) : nudge ? (
              <>
                Your existing connection{hit.details.connected === 1 ? ' keeps' : 's keep'} working
                &mdash; only adding is blocked. Pro raises the limit to{' '}
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
                href="/billing"
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
                See plans
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
    ? `That needs ${d.requiredUnits} sender actions — only ${d.remaining} of your ${d.limit} free ones are left`
    : `You've used all ${d.limit} free sender actions`;
}

function inboxLimitTitle(d: InboxLimitDetails, tierLabel: string): string {
  return `Your ${tierLabel} plan includes ${d.limit} connected ${d.limit === 1 ? 'inbox' : 'inboxes'}`;
}

function actionTierTitle(d: ActionTierDetails): string {
  const plan = tierName(d.requiredTier);
  return d.selector === 'multi-sender'
    ? `Multi-sender actions are part of ${plan}`
    : `This action is part of ${plan}`;
}

function tierName(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
