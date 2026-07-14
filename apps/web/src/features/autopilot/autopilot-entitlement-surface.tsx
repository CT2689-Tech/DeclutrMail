'use client';

import Link from 'next/link';
import { EmptyState, Eyebrow, Pill, tokens } from '@declutrmail/shared';
import { hasCapability, TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { useTier } from '@/features/auth/api/use-tier';

import { useAutopilotRules } from './api/use-autopilot-rules';
import { AutopilotRoute } from './autopilot-screen';
import { presetDisplayName } from './preset-labels';

const { color, font, radius, shadow } = tokens;

/**
 * Entitlement-aware Autopilot entry.
 *
 * Active execution remains a canonical Pro capability. Under-tier users
 * receive read-only value from the real preset catalog already seeded for
 * their mailbox (`GET /autopilot/rules` is deliberately capability-exempt
 * for onboarding). No pending matches, mutations, or action endpoints mount.
 */
export function AutopilotEntitlementSurface() {
  const { tier } = useTier();
  if (hasCapability(tier, 'autopilot')) return <AutopilotRoute />;
  return <AutopilotObservePreview />;
}

export function AutopilotObservePreview() {
  const rules = useAutopilotRules();
  const monthly = TIER_MANIFEST.pro.prices.monthly;
  const price = monthly == null ? null : `$${monthly.usdCents / 100}/mo`;

  return (
    <div
      data-testid="autopilot-observe-preview"
      style={{
        padding: '20px 24px 28px',
        maxWidth: 820,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        fontFamily: font.sans,
      }}
    >
      <div>
        <Eyebrow>Autopilot preview</Eyebrow>
        <h1
          style={{
            margin: '6px 0 4px',
            fontFamily: font.display,
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: '-0.018em',
          }}
        >
          See your preset rules before activating them.
        </h1>
        <p
          style={{
            margin: 0,
            maxWidth: 650,
            color: color.fgMuted,
            fontSize: 13.5,
            lineHeight: 1.6,
          }}
        >
          Observe records matches as suggestions; Active applies future matches automatically. This
          preview only shows the preset rules installed for your mailbox. It does not inspect new
          mail, create suggestions, or change anything.
        </p>
      </div>

      <section
        aria-labelledby="autopilot-preview-rules"
        style={{
          padding: 18,
          border: `1px solid ${color.border}`,
          borderRadius: radius.lg,
          background: color.card,
          boxShadow: shadow.card,
        }}
      >
        <h2 id="autopilot-preview-rules" style={{ margin: '0 0 12px', fontSize: 14 }}>
          Preset rules in your mailbox
        </h2>
        {rules.isLoading && (
          <p role="status" style={{ margin: 0, color: color.fgMuted, fontSize: 13 }}>
            Loading your preset rules…
          </p>
        )}
        {rules.isError && (
          <EmptyState
            title="Couldn't load your preset rules"
            description="Your mailbox was not changed. Try this preview again in a moment."
          />
        )}
        {rules.data && rules.data.length === 0 && (
          <p style={{ margin: 0, color: color.fgMuted, fontSize: 13 }}>
            No preset rules are installed yet. They appear after the first mailbox sync.
          </p>
        )}
        {rules.data && rules.data.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {rules.data.map((rule) => (
              <li
                key={rule.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 12px',
                  border: `1px solid ${color.lineSoft}`,
                  borderRadius: radius.md,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {presetDisplayName(rule.presetKey, rule.name)}
                </span>
                <Pill tone="default">{actionLabel(rule.actionKind)}</Pill>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          padding: '14px 16px',
          border: `1px solid ${color.primaryBorder}`,
          borderRadius: radius.lg,
          background: color.primarySoft,
        }}
      >
        <div>
          <strong style={{ display: 'block', fontSize: 13.5 }}>
            Automatic Active execution is Pro.
          </strong>
          <span style={{ color: color.fgMuted, fontSize: 12.5 }}>
            Custom rule creation remains unavailable; the launch surface uses preset rules only.
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            href="/pricing"
            style={{ color: color.primary, fontSize: 12.5, textDecoration: 'none' }}
          >
            Compare plans
          </Link>
          <Link
            href="/billing"
            style={{
              padding: '9px 14px',
              borderRadius: radius.md,
              background: color.primary,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Upgrade to Pro{price ? ` · ${price}` : ''}
          </Link>
        </div>
      </div>
    </div>
  );
}

function actionLabel(kind: 'archive' | 'unsubscribe' | 'later'): string {
  if (kind === 'archive') return 'Archive';
  if (kind === 'unsubscribe') return 'Unsubscribe';
  return 'Later';
}
