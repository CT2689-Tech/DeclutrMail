'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, Eyebrow, tokens } from '@declutrmail/shared';
import {
  hasCapability,
  minimumTierForCapability,
  TIER_MANIFEST,
} from '@declutrmail/shared/entitlements';

import { useTier } from '@/features/auth/api/use-tier';
import { useRegionProvider } from '@/features/billing/billing-currency';
import { billingIntentPath } from '@/features/billing/billing-intent';
import { currencyForPricePoint, formatMoney } from '@/features/marketing/pricing/pricing-model';

import { useAutopilotRules } from './api/use-autopilot-rules';
import { useRulePreview } from './api/use-rule-preview';
import { AutopilotRoute } from './autopilot-screen';
import { presetDisplayName } from './preset-labels';
import { RulePreviewPanel } from './rule-preview-panel';
import type { RulePreviewState } from './types';

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
  const preview = useRulePreview();
  const [previewRuleId, setPreviewRuleId] = useState<string | null>(null);
  // D251 — this preview renders to workspaces WITHOUT `autopilot`,
  // i.e. Free only. The cheapest plan that unlocks the screen they are
  // looking at is therefore the review capability's granting tier (Plus),
  // NOT Pro. Quoting Pro here sent a Free user to a $19 plan for a $9
  // surface — same bug class as the hardcoded `$` this file already
  // records below. Derived so the next ladder move rewrites it.
  const grantingTier = minimumTierForCapability('autopilot');
  const grantingPlan = grantingTier === 'pro' ? ('pro' as const) : ('plus' as const);
  const grantingName = TIER_MANIFEST[grantingTier].name;
  const monthly = TIER_MANIFEST[grantingTier].prices.monthly;
  // Was a hardcoded `$` template — an India-bound user read "$19/mo"
  // here and was charged ₹1,599 at the checkout this nudge leads to.
  const regionProvider = useRegionProvider();
  const price =
    monthly == null
      ? null
      : `${formatMoney(monthly, currencyForPricePoint(monthly, regionProvider))}/mo`;

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
          Observe records matches as suggestions; Active applies future matches automatically.
          Review the preset rules installed for your mailbox, then run a read-only current-match
          preview. Preview does not create suggestions or change Gmail.
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Descriptive label (which verb the preset applies), never a
                      control on any tier — a Pill here read as clickable next
                      to the real preview Button. */}
                  <span style={{ fontSize: 12, color: color.fgMuted, whiteSpace: 'nowrap' }}>
                    {actionLabel(rule.actionKind)}
                  </span>
                  <Button
                    size="sm"
                    tone="default"
                    disabled={preview.isPending}
                    onClick={() => {
                      setPreviewRuleId(rule.id);
                      preview.mutate(rule.id);
                    }}
                  >
                    Preview current matches
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {previewRuleId != null && rules.data != null && (
          <div style={{ marginTop: 12 }}>
            <RulePreviewPanel
              ruleName={presetDisplayName(
                rules.data.find((rule) => rule.id === previewRuleId)?.presetKey ?? null,
                rules.data.find((rule) => rule.id === previewRuleId)?.name ?? 'Preset rule',
              )}
              state={previewState(preview, previewRuleId)}
              onRetry={() => preview.mutate(previewRuleId)}
            />
          </div>
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
            Rule matching and batch approval are part of {grantingName}.
          </strong>
          <span style={{ color: color.fgMuted, fontSize: 12.5 }}>
            Letting rules act without per-batch approval is Pro. Custom rule creation remains
            unavailable; the launch surface uses preset rules only.
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
            href={billingIntentPath({ plan: grantingPlan, cycle: 'monthly' })}
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
            Upgrade to {grantingName}
            {price ? ` · ${price}` : ''}
          </Link>
        </div>
      </div>
    </div>
  );
}

function previewState(
  preview: {
    isPending: boolean;
    isError: boolean;
    data: ReturnType<typeof useRulePreview>['data'];
  },
  ruleId: string,
): RulePreviewState {
  if (preview.isPending) return { status: 'loading' };
  if (preview.isError) {
    return { status: 'error', message: 'Preview failed. Your mailbox was not changed.' };
  }
  if (preview.data?.ruleId === ruleId) return { status: 'ready', result: preview.data };
  return { status: 'loading' };
}

function actionLabel(kind: 'archive' | 'unsubscribe' | 'later'): string {
  if (kind === 'archive') return 'Archive';
  if (kind === 'unsubscribe') return 'Unsubscribe';
  return 'Later';
}
