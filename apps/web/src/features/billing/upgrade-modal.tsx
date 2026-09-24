'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import { Button, tokens } from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';
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

const { color, font, radius, shadow, space, text } = tokens;

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
 * Shape: the limit as the title, ONE sentence, ONE button carrying the
 * nudged plan's price, and a quiet line with the D121 money-back note
 * + Compare plans. D123's ladder still holds: Pro gets the honest
 * limit statement with NO upgrade nudge (nothing to sell).
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
  const actionTier = hit.reason === 'action_tier' ? hit.details.requiredTier : null;
  const actionTierName = actionTier ? TIER_MANIFEST[actionTier].name : null;

  // ONE checkout path (D117): the CTA deep-links the nudged plan into
  // /billing's confirm step via the same validated intent the pricing
  // page uses — the copy above quotes monthly prices, so the intent
  // carries `monthly` (the billing screen's toggle flips it in place).
  const targetPlan: 'plus' | 'pro' = hit.reason === 'free_cap' ? 'plus' : (actionTier ?? 'pro');
  const upgradeHref = billingIntentPath({ plan: targetPlan, cycle: 'monthly' });
  const upgradeLabel = `Upgrade to ${TIER_MANIFEST[targetPlan].name}`;
  const targetMonthly = quotedPlanPrice(targetPlan, 'monthly', regionProvider);

  return (
    // The PreviewSheet grammar and classes — a centred dialog on desktop,
    // a bottom sheet on phones (pure CSS) — but its own markup: the one
    // action here is a LINK into /billing, not a button.
    <div
      className="dm-scrim dm-sheet-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 150,
        display: 'flex',
        justifyContent: 'center',
        padding: space[4],
        overflowY: 'auto',
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-upgrade-title"
        data-testid="upgrade-modal"
        className="dm-sheet dm-sheet-panel"
        style={{
          width: '100%',
          maxWidth: 440,
          background: color.card,
          boxShadow: shadow.modal,
          fontFamily: font.sans,
          color: color.fg,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          padding: `${space[8]}px ${space[6]}px ${space[6]}px`,
        }}
      >
        <h2
          id="dm-upgrade-title"
          style={{
            fontSize: text['2xl'],
            fontWeight: 650,
            letterSpacing: '-0.022em',
            lineHeight: 1.2,
            margin: 0,
            textWrap: 'balance',
          }}
        >
          {hit.reason === 'free_cap'
            ? freeCapTitle(hit.details)
            : hit.reason === 'action_tier'
              ? actionTierTitle(hit.details)
              : inboxLimitTitle(hit.details, tierName(tier))}
        </h2>
        <p
          style={{
            fontSize: text.md,
            color: color.fgSoft,
            margin: `${space[2]}px 0 0`,
            lineHeight: 1.45,
            maxWidth: '34ch',
            textWrap: 'pretty',
          }}
        >
          {hit.reason === 'free_cap' ? (
            <>
              {TIER_MANIFEST.plus.name} removes the monthly cap
              {hit.details.resetsAt
                ? `; otherwise your quota resets on ${resetDateLabel(hit.details.resetsAt)}`
                : ''}
              .
            </>
          ) : hit.reason === 'action_tier' ? (
            <>
              {actionTierName} unlocks{' '}
              {hit.details.selector === 'sender-filter' ? 'all-matching cleanup' : 'this workflow'}.
            </>
          ) : nudge ? (
            <>
              {TIER_MANIFEST.pro.name} raises the limit to {TIER_MANIFEST.pro.inboxLimit} connected
              Gmail accounts.
            </>
          ) : (
            <>Disconnect an account from the account menu to connect a different one.</>
          )}
        </p>

        <div
          style={{
            marginTop: space[6],
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: space[2],
          }}
        >
          {nudge ? (
            <>
              <Link
                href={upgradeHref}
                onClick={dismiss}
                data-dm-button=""
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  height: 50,
                  padding: '0 28px',
                  background: color.primary,
                  color: color.fgInverse,
                  borderRadius: radius.pill,
                  boxShadow: shadow.button,
                  fontSize: text.lg,
                  fontWeight: 600,
                  letterSpacing: '-0.006em',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {upgradeLabel}
                {targetMonthly ? (
                  <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>
                    {' '}
                    {targetMonthly}
                  </span>
                ) : null}
              </Link>
              <Button tone="ghost" size="lg" onClick={dismiss} style={{ width: '100%' }}>
                Not now
              </Button>
            </>
          ) : (
            <Button tone="default" size="xl" onClick={dismiss} style={{ width: '100%' }}>
              Keep current inboxes
            </Button>
          )}
        </div>

        {/* The money-back note and the plan comparison — once, quiet. */}
        {nudge ? (
          <p style={{ margin: `${space[3]}px 0 0`, fontSize: text.sm, color: color.fgMuted }}>
            {MONEY_BACK_NOTE} ·{' '}
            <Link href="/pricing" onClick={dismiss} style={{ color: color.fgMuted }}>
              Compare plans
            </Link>
          </p>
        ) : null}
      </div>
    </div>
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
  return `Your ${tierLabel} plan includes ${d.limit} connected Gmail ${d.limit === 1 ? 'account' : 'accounts'}`;
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
