'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { tokens } from '@declutrmail/shared';
import type { TierDefinition } from '@declutrmail/shared/entitlements';

import { navigateToCheckout, oauthStartUrl } from './cta';
import {
  cardBullets,
  formatUsd,
  priceLineFor,
  TIER_JOBS,
  type BillingInterval,
} from './pricing-model';

const { color, font, radius, shadow } = tokens;

/**
 * One purchasable-tier card (D19). Every number on the card comes off
 * the manifest via the pricing model — no literals here.
 *
 * CTA semantics (per the D17 pricing leg):
 *   - Free   → OAuth start (signup IS login; no checkout exists for $0).
 *   - Plus/Pro → lazy auth probe: authed lands on /billing, unauthed on
 *     OAuth start (see cta.ts).
 */
export function TierCard({
  tier,
  interval,
  highlighted = false,
}: {
  tier: TierDefinition;
  interval: BillingInterval;
  highlighted?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const price = priceLineFor(tier, interval);
  const promoActive = interval === 'annual' && tier.promo != null;
  const isFree = tier.prices.monthly?.usdCents === 0;

  async function onCta() {
    if (busy) return;
    if (isFree) {
      window.location.assign(oauthStartUrl());
      return;
    }
    setBusy(true);
    try {
      await navigateToCheckout((path) => router.push(path));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        flex: '1 1 240px',
        minWidth: 230,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: '22px 22px 20px',
        background: color.card,
        border: `1px solid ${highlighted ? color.primaryBorder : color.line}`,
        borderRadius: radius.lg,
        boxShadow: highlighted ? shadow.lift : shadow.card,
        position: 'relative',
      }}
    >
      {highlighted ? (
        <span
          style={{
            position: 'absolute',
            top: -11,
            left: 20,
            padding: '3px 10px',
            fontFamily: font.sans,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: '#FFFFFF',
            background: color.primary,
            borderRadius: radius.pill,
          }}
        >
          Most popular
        </span>
      ) : null}

      <div>
        <h3
          style={{
            margin: 0,
            fontFamily: font.display,
            fontSize: 19,
            fontWeight: 650,
            color: color.fg,
          }}
        >
          {tier.name}
        </h3>
        <p style={{ margin: '4px 0 0', fontFamily: font.sans, fontSize: 13, color: color.fgSoft }}>
          {TIER_JOBS[tier.id]}
        </p>
      </div>

      <div style={{ minHeight: 64 }}>
        {promoActive && tier.promo ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                style={{
                  fontFamily: font.display,
                  fontSize: 32,
                  fontWeight: 700,
                  color: color.fg,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatUsd(tier.promo.annual.usdCents)}
              </span>
              <span style={{ fontFamily: font.sans, fontSize: 14, color: color.fgMuted }}>/yr</span>
              {price ? (
                <s style={{ fontFamily: font.sans, fontSize: 14, color: color.fgMuted }}>
                  {price.amount}
                </s>
              ) : null}
            </div>
            <p
              style={{
                margin: '4px 0 0',
                fontFamily: font.sans,
                fontSize: 12,
                color: color.primary,
                fontWeight: 600,
              }}
            >
              {tier.promo.name} — first {tier.promo.maxRedemptions}, price locked
            </p>
          </>
        ) : price ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span
                style={{
                  fontFamily: font.display,
                  fontSize: 32,
                  fontWeight: 700,
                  color: color.fg,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {price.amount}
              </span>
              {price.per ? (
                <span style={{ fontFamily: font.sans, fontSize: 14, color: color.fgMuted }}>
                  {price.per}
                </span>
              ) : null}
            </div>
            {price.note ? (
              <p
                style={{
                  margin: '4px 0 0',
                  fontFamily: font.sans,
                  fontSize: 12,
                  color: color.fgMuted,
                }}
              >
                {price.note}
              </p>
            ) : (
              <p
                style={{
                  margin: '4px 0 0',
                  fontFamily: font.sans,
                  fontSize: 12,
                  color: color.fgMuted,
                }}
              >
                No card required
              </p>
            )}
          </>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => void onCta()}
        disabled={busy}
        style={{
          height: 38,
          padding: '0 16px',
          fontFamily: font.sans,
          fontSize: 14,
          fontWeight: 600,
          color: highlighted ? '#FFFFFF' : color.fg,
          background: busy ? color.fgMuted : highlighted ? color.primary : color.card,
          border: `1px solid ${highlighted ? color.primary : color.border}`,
          borderRadius: radius.md,
          cursor: busy ? 'wait' : 'pointer',
          transition: 'background 0.12s',
        }}
      >
        {busy ? 'One moment…' : isFree ? 'Start free' : `Get ${tier.name}`}
      </button>

      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {cardBullets(tier).map((line) => (
          <li
            key={line}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'baseline',
              fontFamily: font.sans,
              fontSize: 13,
              color: color.fgSoft,
              lineHeight: 1.45,
            }}
          >
            <span aria-hidden style={{ color: color.primary, fontWeight: 700 }}>
              ✓
            </span>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
