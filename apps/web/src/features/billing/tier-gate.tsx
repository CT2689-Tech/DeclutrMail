'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';

import { tokens } from '@declutrmail/shared';
import {
  hasCapability,
  minimumTierForCapability,
  TIER_MANIFEST,
  type Capability,
} from '@declutrmail/shared/entitlements';

import { useTier } from '@/features/auth/api/use-tier';
import { track } from '@/lib/posthog';

import { billingIntentPath } from './billing-intent';
import { MONEY_BACK_NOTE, quotedPlanPrice } from './billing-model';
import { useRegionProvider } from './billing-currency';

const { color, font, radius, text } = tokens;

/**
 * TierGate (D19/D68/D77) — entitlement gate for paid feature screens.
 *
 * Wraps a feature screen; renders the children only when the workspace
 * tier grants the capability (D19 manifest — the same source the BE
 * gates on, so FE and BE can never disagree). Under-tier workspaces
 * see the D68 placeholder: feature name, one sentence, ONE button with
 * the manifest price, and the D121 money-back note — stated once.
 *
 * The gate also short-circuits the feature's data fetching: the
 * children never mount, so an under-tier workspace never issues the
 * feature's reads.
 */
export function TierGate({
  capability,
  title,
  pitch,
  footnote,
  children,
}: {
  capability: Capability;
  /** Feature display name ("Daily Brief"). */
  title: string;
  /** ONE sentence — what the feature does (D68 placeholder body). */
  pitch: ReactNode;
  /**
   * Optional trust line under the CTA — what the CURRENT plan still
   * lets the user do (e.g. Snoozed: where their Later mail lives).
   * Never hide where a user's mail went behind a paywall.
   */
  footnote?: ReactNode;
  children: ReactNode;
}) {
  const { tier } = useTier();
  const granted = hasCapability(tier, capability);
  const requiredTierId = minimumTierForCapability(capability);

  useEffect(() => {
    if (granted) return;
    void track('upgrade_prompt_shown', {
      reason: requiredTierId === 'pro' ? 'pro_feature' : 'feature_tier',
      source: 'tier_gate',
    });
  }, [granted, requiredTierId]);

  const regionProvider = useRegionProvider();

  if (granted) return <>{children}</>;

  // Quote the rail this visitor will actually be charged on — the CTA
  // below deep-links straight into checkout (D117).
  const requiredMonthly = quotedPlanPrice(requiredTierId, 'monthly', regionProvider);
  const requiredTier = TIER_MANIFEST[requiredTierId].name;
  // ONE checkout path (D117): deep-link the required plan into
  // /billing's confirm step via the validated intent — same funnel as
  // the pricing page and the 402 UpgradeModal. Monthly matches the
  // quoted price; the billing screen's toggle flips it in place.
  const upgradeHref =
    requiredTierId === 'plus' || requiredTierId === 'pro'
      ? billingIntentPath({ plan: requiredTierId, cycle: 'monthly' })
      : '/billing';

  return (
    <div
      data-testid="tier-gate-placeholder"
      style={{
        boxSizing: 'border-box',
        maxWidth: 480,
        margin: '0 auto',
        padding: '72px 24px 40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        textAlign: 'center',
        fontFamily: font.sans,
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: text['2xl'],
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: color.fg,
        }}
      >
        {title}
      </h1>

      <p style={{ margin: 0, fontSize: text.md, lineHeight: 1.55, color: color.fgSoft }}>{pitch}</p>

      <Link
        href={upgradeHref}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 44,
          marginTop: 12,
          padding: '0 20px',
          background: color.primary,
          color: color.fgInverse,
          borderRadius: radius.md,
          fontSize: text.md,
          fontWeight: 600,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        Upgrade to {requiredTier}
        {requiredMonthly ? (
          <span style={{ fontFamily: font.mono, marginLeft: 8 }}>{requiredMonthly}</span>
        ) : null}
      </Link>

      <p style={{ margin: 0, fontSize: text.sm, color: color.fgMuted }}>
        {MONEY_BACK_NOTE} ·{' '}
        <Link href="/pricing" style={{ color: color.fgMuted }}>
          Compare plans
        </Link>
      </p>

      {footnote ? (
        <p
          style={{ margin: '12px 0 0', fontSize: text.sm, lineHeight: 1.55, color: color.fgMuted }}
        >
          {footnote}
        </p>
      ) : null}
    </div>
  );
}
