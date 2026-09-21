'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, tokens } from '@declutrmail/shared';
import {
  hasCapability,
  minimumTierForCapability,
  TIER_MANIFEST,
} from '@declutrmail/shared/entitlements';

import { useTier } from '@/features/auth/api/use-tier';
import { useRegionProvider } from '@/features/billing/billing-currency';
import { billingIntentPath } from '@/features/billing/billing-intent';
import { MONEY_BACK_NOTE } from '@/features/billing/billing-model';
import { currencyForPricePoint, formatMoney } from '@/features/marketing/pricing/pricing-model';

import { useAutopilotRules } from './api/use-autopilot-rules';
import { useRulePreview } from './api/use-rule-preview';
import { AutopilotRoute } from './autopilot-screen';
import { presetDisplayName } from './preset-labels';
import { RulePreviewPanel } from './rule-preview-panel';
import type { RulePreviewState } from './types';

const { color, font, radius, text } = tokens;

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
  // The plan granting unattended action — derived, never hardcoded.
  const actName = TIER_MANIFEST[minimumTierForCapability('autopilot-active')].name;
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
        padding: '20px clamp(16px, 4vw, 24px) 28px',
        width: '100%',
        boxSizing: 'border-box',
        maxWidth: 880,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        fontFamily: font.sans,
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: text['2xl'],
            fontWeight: 600,
            letterSpacing: '-0.015em',
            color: color.fg,
          }}
        >
          Autopilot
        </h1>
        <p style={{ margin: '4px 0 0', color: color.fgMuted, fontSize: text.md, lineHeight: 1.5 }}>
          See what each preset rule would match right now. Previews are read-only.
        </p>
      </div>

      <section
        aria-labelledby="autopilot-preview-rules"
        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <h2
          id="autopilot-preview-rules"
          style={{ margin: 0, fontSize: text.sm, fontWeight: 600, color: color.fgSoft }}
        >
          Rules
        </h2>
        {rules.isLoading && (
          <p role="status" style={{ margin: 0, color: color.fgMuted, fontSize: text.md }}>
            Loading your preset rules…
          </p>
        )}
        {rules.isError && (
          <EmptyState
            title="Couldn't load your preset rules"
            description="Try again in a moment."
          />
        )}
        {rules.data && rules.data.length === 0 && (
          <p style={{ margin: 0, color: color.fgMuted, fontSize: text.md }}>
            Rules appear after the first mailbox sync.
          </p>
        )}
        {rules.data && rules.data.length > 0 && (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              borderBottom: `1px solid ${color.line}`,
            }}
          >
            {rules.data.map((rule) => (
              <li
                key={rule.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  padding: '12px 0',
                  borderTop: `1px solid ${color.line}`,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: text.md, fontWeight: 600, color: color.fg }}>
                    {presetDisplayName(rule.presetKey, rule.name)}
                  </span>
                  {/* Descriptive label (which verb the preset applies), never a
                      control on any tier. */}
                  <span style={{ fontSize: text.sm, color: color.fgMuted, whiteSpace: 'nowrap' }}>
                    {actionLabel(rule.actionKind)}
                  </span>
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

      {/* Same shape as the shared paywall: one sentence, one priced
          button, a quiet compare link, the money-back note once. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontSize: text.md, color: color.fgSoft, lineHeight: 1.5 }}>
          Matching and batch approval are part of {grantingName}
          {actName === grantingName ? ', and so are' : `; ${actName} adds`} rules that act without
          asking.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Link
            href={billingIntentPath({ plan: grantingPlan, cycle: 'monthly' })}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 36,
              padding: '0 16px',
              borderRadius: radius.md,
              background: color.primary,
              color: color.fgInverse,
              fontSize: text.md,
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Upgrade to {grantingName}
            {price ? ` · ${price}` : ''}
          </Link>
          <Link
            href="/pricing"
            style={{ color: color.primary, fontSize: text.sm, textDecoration: 'none' }}
          >
            Compare plans
          </Link>
        </div>
        <p style={{ margin: 0, fontSize: text.xs, color: color.fgMuted }}>{MONEY_BACK_NOTE}</p>
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
    return { status: 'error', message: 'Preview failed. Please retry.' };
  }
  if (preview.data?.ruleId === ruleId) return { status: 'ready', result: preview.data };
  return { status: 'loading' };
}

function actionLabel(kind: 'archive' | 'unsubscribe' | 'later'): string {
  if (kind === 'archive') return 'Archive';
  if (kind === 'unsubscribe') return 'Unsubscribe';
  return 'Later';
}
