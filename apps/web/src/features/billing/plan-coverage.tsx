'use client';

import linkStyles from './billing-links.module.css';

import Link from 'next/link';
import { tokens } from '@declutrmail/shared';
import { WS1_COPY, WS2_COPY } from '@declutrmail/shared/copy/launch';
import { BRIEF_NAME } from '@declutrmail/shared/copy/screen-decisions';
import {
  fillStory,
  fillStoryList,
  TIER_MANIFEST,
  type TierId,
} from '@declutrmail/shared/entitlements';
import { useTier } from '@/features/auth/api/use-tier';
import { CAPABILITY_LABELS } from '@/features/marketing/pricing/pricing-model';

const { color } = tokens;
const tools = [
  ['senders', 'Sender cleanup'],
  ['screener', 'New-sender review'],
  ['autopilot', 'Autopilot'],
  ['quiet', 'Quiet hours'],
  ['brief', BRIEF_NAME],
  ['followups', 'Follow-ups'],
] as const;

export function PlanCoverage({
  tier,
  pass = false,
  freeManualPass = false,
}: {
  tier: TierId;
  pass?: boolean;
  /** Free hand-granted Pass: `pricing.pass.features.granted`, which has no buy-again line. */
  freeManualPass?: boolean;
}) {
  const { connectedInboxes, pricingV2 } = useTier();
  const plan = TIER_MANIFEST[tier];
  return (
    <section
      aria-label="Your plan includes"
      style={{ borderTop: `1px solid ${color.border}`, paddingTop: 16, display: 'grid', gap: 12 }}
    >
      <h2 style={{ ...tokens.typography.sectionTitle, margin: 0 }}>Your plan includes</h2>
      <div>
        {connectedInboxes ?? 0} of {plan.inboxLimit} connected Gmail accounts ·{' '}
        <Link className={`${linkStyles.link} dm-tap-target`} href="/settings#mailboxes">
          Manage Gmail accounts
        </Link>
      </div>
      {(connectedInboxes ?? 0) > plan.inboxLimit ? (
        <p style={{ margin: 0 }}>
          Existing connections continue working. Adding a Gmail account is blocked while you are at
          or above this plan’s limit.
        </p>
      ) : null}
      <div>
        {pricingV2 && pass
          ? fillStoryList(
              freeManualPass
                ? WS1_COPY['pricing.pass.features.granted']
                : WS1_COPY['pricing.pass.features'],
            ).map((line) => <div key={line}>{line}</div>)
          : plan.cleanupActionsPerMonth === null
            ? `${WS2_COPY.liveFix.billing.limit.unlimited.replace(/\.$/, '')} on emails cleared.`
            : fillStory(WS2_COPY.liveFix.billing.limit.free)}
      </div>
      <ul
        aria-label="Included features"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', margin: 0, paddingLeft: 20 }}
      >
        {tools
          .filter(([capability]) => plan.capabilities.includes(capability))
          .map(([capability, label]) => (
            <li key={capability}>{label}</li>
          ))}
      </ul>
    </section>
  );
}

export function PlanConsequences({ fromTier, toTier }: { fromTier: TierId; toTier: TierId }) {
  const from = TIER_MANIFEST[fromTier];
  const to = TIER_MANIFEST[toTier];
  const lost = from.capabilities.filter((cap) => !to.capabilities.includes(cap));
  const gained = to.capabilities.filter((cap) => !from.capabilities.includes(cap));
  const labelsFor = (capabilities: typeof lost) =>
    [...new Set(capabilities.map((cap) => CAPABILITY_LABELS[cap]))].join(', ');
  if (fromTier === toTier)
    return <p style={{ margin: 0 }}>Your features and number of Gmail accounts stay the same.</p>;
  return (
    <div style={{ fontSize: 14, lineHeight: 1.6 }}>
      {gained.length ? <p>Added: {labelsFor(gained)}.</p> : null}
      {lost.length ? <p>No longer included after the change: {labelsFor(lost)}.</p> : null}
      <p>
        {to.name} includes {to.inboxLimit} connected Gmail{' '}
        {to.inboxLimit === 1 ? 'account' : 'accounts'} and{' '}
        {to.cleanupActionsPerMonth === null
          ? WS2_COPY.liveFix.billing.limit.unlimited
          : fillStory(WS2_COPY.liveFix.billing.limit.free)}
        .
      </p>
      {to.inboxLimit < from.inboxLimit ? (
        <p>
          Existing connected Gmail accounts continue working, even above the new limit. You cannot
          add another while at or above {to.inboxLimit}. Completed email actions stay in place.
        </p>
      ) : null}
    </div>
  );
}
