'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useUpgradeReturnTo } from '@/features/billing/use-upgrade-return-to';

import { Button, tokens } from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';
import { WS1_COPY } from '@declutrmail/shared/copy/launch';
import { fillStory, TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { useTier } from '@/features/auth/api/use-tier';
import {
  useUpgradeGateStore,
  type ActionTierDetails,
  type FreeCapDetails,
  type InboxLimitDetails,
  type ProFeatureDetails,
} from '@/lib/entitlements/upgrade-gate';
import { track } from '@/lib/posthog';

import { billingIntentPath } from './billing-intent';
import {
  formatBillingMonthDay,
  launchPlusQuote,
  moneyBackNote,
  quotedPlanPrice,
} from './billing-model';
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
 *   - `PRO_FEATURE_REQUIRED` — a capability-gated route (Quiet, Screener,
 *     Autopilot, Briefs, Follow-ups) sits above the workspace tier.
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
  const applyWindowPreset = useUpgradeGateStore((s) => s.applyWindowPreset);
  const { tier, pricingV2, passEnabled } = useTier();
  const from = useUpgradeReturnTo();

  useEffect(() => {
    if (!hit) return;
    void track('upgrade_prompt_shown', { reason: hit.reason, source: 'upgrade_modal' });
    if (hit.reason === 'free_cap' && typeof hit.details.requested === 'number') {
      void track('free_cap_hit', {
        requested: hit.details.requested,
        remaining: hit.details.remaining,
      });
    }
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
  // action_tier and pro_feature both carry a manifest-derived requiredTier;
  // free_cap and inbox_limit don't name one (free_cap always nudges Plus,
  // inbox_limit always nudges Pro — see targetPlan below).
  const requiredTier =
    hit.reason === 'action_tier' || hit.reason === 'pro_feature' ? hit.details.requiredTier : null;
  const requiredTierName = requiredTier ? TIER_MANIFEST[requiredTier].name : null;

  // ONE checkout path (D117): the CTA deep-links the nudged plan into
  // /billing's confirm step via the same validated intent the pricing
  // page uses. Launch pricing sells Plus annual. Flags off still quotes
  // the monthly price the link buys.
  const targetPlan: 'plus' | 'pro' = hit.reason === 'free_cap' ? 'plus' : (requiredTier ?? 'pro');
  const checkoutCycle = pricingV2 ? 'annual' : 'monthly';
  const upgradeHref = billingIntentPath({
    plan: targetPlan,
    cycle: checkoutCycle,
    ...(from ? { from } : {}),
  });
  const freeCap = hit.reason === 'free_cap' ? hit.details : null;
  const meteredCap = freeCap !== null && typeof freeCap.requested === 'number';
  // The emails-cleared popup already uses deck buttons. This is the
  // other free-cap confirm, whose old label was not a deck string.
  const limitConfirmLabel =
    pricingV2 && freeCap !== null && !meteredCap
      ? fillStory(passEnabled ? WS1_COPY['cap.pass.button'] : WS1_COPY['cap.plus.button'])
      : null;
  const upgradeLabel = limitConfirmLabel ?? `Upgrade to ${TIER_MANIFEST[targetPlan].name}`;
  const targetQuote =
    limitConfirmLabel !== null
      ? null
      : pricingV2 && targetPlan === 'plus'
        ? launchPlusQuote(regionProvider)
        : quotedPlanPrice(targetPlan, 'monthly', regionProvider);

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
            ...tokens.typography.dialogTitle,
            letterSpacing: '-0.022em',
            lineHeight: 1.2,
            margin: 0,
            textWrap: 'balance',
          }}
        >
          {hit.reason === 'free_cap'
            ? WS1_COPY['cap.title']
            : hit.reason === 'action_tier'
              ? actionTierTitle(hit.details)
              : hit.reason === 'pro_feature'
                ? proFeatureTitle(hit.details)
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
          {hit.reason === 'free_cap' && typeof hit.details.requested === 'number' ? (
            capBody(hit.details)
          ) : hit.reason === 'free_cap' ? (
            <>
              {TIER_MANIFEST.plus.name} removes the monthly cap
              {hit.details.resetsAt
                ? `; otherwise your quota resets on ${resetDateLabel(hit.details.resetsAt)}`
                : ''}
              .
            </>
          ) : hit.reason === 'action_tier' ? (
            <>
              {requiredTierName} unlocks{' '}
              {hit.details.selector === 'sender-filter' ? 'all-matching cleanup' : 'this workflow'}.
            </>
          ) : hit.reason === 'pro_feature' ? (
            <>{requiredTierName} unlocks this feature.</>
          ) : nudge ? (
            <>
              {TIER_MANIFEST.pro.name} raises the limit to {TIER_MANIFEST.pro.inboxLimit} connected
              Gmail accounts.
            </>
          ) : (
            <>Disconnect an account from the account menu to connect a different one.</>
          )}
        </p>
        {hit.reason === 'free_cap' && (pricingV2 || meteredCap) ? (
          <p
            style={{
              fontSize: text.md,
              color: color.fgSoft,
              margin: `${space[2]}px 0 0`,
              lineHeight: 1.45,
              maxWidth: '34ch',
            }}
          >
            {WS1_COPY['cap.free.line']}
          </p>
        ) : null}

        <div
          style={{
            marginTop: space[6],
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: space[2],
          }}
        >
          {nudge && hit.reason === 'free_cap' && typeof hit.details.requested === 'number' ? (
            <>
              {pricingV2 && passEnabled ? (
                <Link
                  href={billingIntentPath({
                    plan: 'plus',
                    cycle: 'annual',
                    offer: 'pass_onetime',
                    ...(from ? { from } : {}),
                  })}
                  onClick={() => {
                    void track('upgrade_cta_clicked', { source: 'upgrade_modal', plan: 'pass' });
                    void track('pass_selected', { source: 'upgrade_modal' });
                    dismiss();
                  }}
                  data-dm-button=""
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 50,
                    padding: '0 28px',
                    background: color.primary,
                    color: color.fgInverse,
                    borderRadius: radius.pill,
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  {fillStory(WS1_COPY['cap.pass.button'])}
                </Link>
              ) : null}
              {pricingV2 && passEnabled ? (
                <span style={{ fontSize: text.sm, color: color.fgMuted }}>
                  {fillStory(WS1_COPY['cap.pass.sublabel'])}
                </span>
              ) : null}
              {typeof hit.details.suggestedPreset === 'number' ? (
                <>
                  <Button
                    tone="default"
                    size="lg"
                    onClick={() => {
                      if (typeof hit.details.suggestedPreset === 'number') {
                        applyWindowPreset(hit.details.suggestedPreset);
                      }
                    }}
                    style={{ width: '100%' }}
                  >
                    {WS1_COPY['cap.fit.button']}
                  </Button>
                  <span style={{ fontSize: text.sm, color: color.fgMuted }}>
                    {fillStory(WS1_COPY['cap.fit.sublabel.noCount'], 'usd', {
                      presetDays: hit.details.suggestedPreset,
                    })}
                  </span>
                </>
              ) : null}
              <Link
                href={billingIntentPath({
                  plan: 'plus',
                  cycle: 'annual',
                  ...(from ? { from } : {}),
                })}
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
                {fillStory(WS1_COPY['cap.plus.button'])}
              </Link>
              <span style={{ fontSize: text.sm, color: color.fgMuted }}>
                {fillStory(WS1_COPY['cap.plus.sublabel'])}
              </span>
              <Button tone="ghost" size="lg" onClick={dismiss} style={{ width: '100%' }}>
                {WS1_COPY['cap.dismiss']}
              </Button>
            </>
          ) : nudge ? (
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
                {targetQuote ? (
                  <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>
                    {' '}
                    {targetQuote}
                  </span>
                ) : null}
              </Link>
              {limitConfirmLabel !== null ? (
                <span style={{ fontSize: text.sm, color: color.fgMuted }}>
                  {fillStory(
                    passEnabled ? WS1_COPY['cap.pass.sublabel'] : WS1_COPY['cap.plus.sublabel'],
                  )}
                </span>
              ) : null}
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
            {moneyBackNote(pricingV2)} ·{' '}
            <Link
              href={`/billing${from ? `?${new URLSearchParams({ from })}` : ''}`}
              onClick={dismiss}
              style={{ color: color.fgMuted }}
            >
              Compare plans
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function capBody(d: FreeCapDetails): string {
  const resetDate = d.resetsAt
    ? (formatBillingMonthDay(d.resetsAt) ?? 'your next monthly reset')
    : 'your next monthly reset';
  const allowance = d.limit.toLocaleString('en-US');
  if (d.remaining <= 0) {
    return fillStory(WS1_COPY['cap.body.zero'], 'usd', { allowance, resetDate });
  }
  const requestedCount = d.requested ?? d.requiredUnits;
  // cap.body has no singular sibling. meter.noun.one is the approved "1 email".
  const template =
    requestedCount === 1
      ? WS1_COPY['cap.body'].replace('{requested} emails', WS1_COPY['meter.noun.one'])
      : WS1_COPY['cap.body'];
  return fillStory(template, 'usd', {
    requested: requestedCount.toLocaleString('en-US'),
    remaining: d.remaining.toLocaleString('en-US'),
    allowance,
    resetDate,
  });
}

/** Short, locale-stable "Aug 27" label for the server's reset instant. */
function resetDateLabel(iso: string): string {
  return formatBillingMonthDay(iso) ?? 'your next monthly reset';
}

function inboxLimitTitle(d: InboxLimitDetails, tierLabel: string): string {
  return `Your ${tierLabel} plan includes ${d.limit} connected Gmail ${d.limit === 1 ? 'account' : 'accounts'}`;
}

function actionTierTitle(d: ActionTierDetails): string {
  const plan = TIER_MANIFEST[d.requiredTier].name;
  return d.selector === 'sender-filter'
    ? `All-matching actions are part of ${plan}`
    : `This action is part of ${plan}`;
}

function proFeatureTitle(d: ProFeatureDetails): string {
  return `This feature is part of ${TIER_MANIFEST[d.requiredTier].name}`;
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
