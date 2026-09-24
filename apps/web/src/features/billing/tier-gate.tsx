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

const { color, font, motion, radius, shadow, text } = tokens;

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
        padding: '88px 24px 48px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        fontFamily: font.sans,
      }}
    >
      <style>{`.dm-gate-cta { transition: background ${motion.fast} ${motion.ease}, transform ${motion.fast} ${motion.ease}; }
.dm-gate-cta:hover { background: ${color.primaryDeep} !important; }
.dm-gate-cta:active { transform: scale(0.97); }
.dm-gate-compare { transition: background ${motion.fast} ${motion.ease}; }
.dm-gate-compare:hover { background: ${color.fill}; }`}</style>
      <span
        aria-hidden="true"
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.pill,
          background: color.primarySoft,
          color: color.primary,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <svg
          width={24}
          height={24}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="5" y="11" width="14" height="9" rx="2.5" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
      <h1
        style={{
          margin: 0,
          fontSize: text['2xl'],
          fontWeight: 650,
          letterSpacing: '-0.02em',
          color: color.fg,
        }}
      >
        {title}
      </h1>

      <p
        style={{
          margin: '10px 0 0',
          fontSize: text.md,
          lineHeight: 1.55,
          color: color.fgMuted,
        }}
      >
        {pitch}
      </p>

      <Link
        href={upgradeHref}
        className="dm-gate-cta"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          height: 50,
          marginTop: 28,
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
        Upgrade to {requiredTier}
        {requiredMonthly ? (
          <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>
            {requiredMonthly}
          </span>
        ) : null}
      </Link>

      <Link
        href="/pricing"
        className="dm-gate-compare"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 44,
          marginTop: 8,
          padding: '0 18px',
          borderRadius: radius.pill,
          color: color.fgSoft,
          fontSize: text.md,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        Compare plans
      </Link>

      <p style={{ margin: '12px 0 0', fontSize: text.sm, color: color.fgMuted }}>
        {MONEY_BACK_NOTE}
      </p>

      {footnote ? (
        <p
          style={{ margin: '16px 0 0', fontSize: text.sm, lineHeight: 1.55, color: color.fgMuted }}
        >
          {footnote}
        </p>
      ) : null}
    </div>
  );
}
