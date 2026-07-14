'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';

import { Eyebrow, tokens } from '@declutrmail/shared';
import {
  hasCapability,
  minimumTierForCapability,
  TIER_MANIFEST,
  type Capability,
} from '@declutrmail/shared/entitlements';

import { useTier } from '@/features/auth/api/use-tier';
import { track } from '@/lib/posthog';

import { MONEY_BACK_NOTE, planPriceLabel } from './billing-model';

const { color, font, radius, shadow } = tokens;

/**
 * TierGate (D19/D68/D77) — entitlement gate for paid feature screens.
 *
 * Wraps a feature screen; renders the children only when the workspace
 * tier grants the capability (D19 manifest — the same source the BE
 * gates on, so FE and BE can never disagree). Under-tier workspaces
 * see the D68 placeholder: feature name, what it does, and the upgrade
 * CTA with the manifest price + the D121 money-back note.
 *
 * The gate also short-circuits the feature's data fetching: the
 * children never mount, so an under-tier workspace never issues the
 * feature's reads.
 */
export function TierGate({
  capability,
  title,
  pitch,
  bullets,
  footnote,
  children,
}: {
  capability: Capability;
  /** Feature display name ("Daily Brief"). */
  title: string;
  /** One-paragraph pitch — what the feature does (D68 placeholder body). */
  pitch: ReactNode;
  /** Optional short feature lines (D68's REPLY/FYI/NOISE-style rows). */
  bullets?: readonly string[];
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

  if (granted) return <>{children}</>;

  const requiredMonthly = planPriceLabel(requiredTierId, 'monthly');
  const requiredTier = TIER_MANIFEST[requiredTierId].name;

  return (
    <div
      data-testid="tier-gate-placeholder"
      style={{
        padding: '20px 24px 28px',
        maxWidth: 920,
        fontFamily: font.sans,
      }}
    >
      <div
        style={{
          maxWidth: 560,
          margin: '48px auto 0',
          padding: '28px 30px 26px',
          background: color.card,
          border: `1px solid ${color.border}`,
          borderRadius: radius.lg,
          boxShadow: shadow.card,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div>
          <Eyebrow>{requiredTier} feature</Eyebrow>
          <h1
            style={{
              margin: '8px 0 0',
              fontFamily: font.display,
              fontSize: 22,
              fontWeight: 650,
              letterSpacing: '-0.015em',
              color: color.fg,
            }}
          >
            {title}
          </h1>
        </div>

        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: color.fgSoft }}>{pitch}</p>

        {bullets && bullets.length > 0 ? (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {bullets.map((line) => (
              <li
                key={line}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'baseline',
                  fontSize: 13,
                  color: color.fgSoft,
                  lineHeight: 1.5,
                }}
              >
                <span aria-hidden style={{ color: color.primary, fontWeight: 700 }}>
                  ✓
                </span>
                {line}
              </li>
            ))}
          </ul>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <Link
            href="/billing"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 36,
              padding: '0 16px',
              background: color.primary,
              color: '#FFFFFF',
              borderRadius: radius.md,
              fontSize: 13.5,
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Upgrade to {requiredTier}
            {requiredMonthly ? ` → ${requiredMonthly}` : ''}
          </Link>
          <Link
            href="/pricing"
            style={{ fontSize: 12.5, color: color.primary, textDecoration: 'none' }}
          >
            Compare plans →
          </Link>
        </div>

        <p style={{ margin: 0, fontSize: 11.5, color: color.fgMuted }}>{MONEY_BACK_NOTE}</p>

        {footnote ? (
          <p
            style={{
              margin: 0,
              paddingTop: 10,
              borderTop: `1px solid ${color.lineSoft}`,
              fontSize: 12.5,
              lineHeight: 1.55,
              color: color.fgSoft,
            }}
          >
            {footnote}
          </p>
        ) : null}
      </div>
    </div>
  );
}
