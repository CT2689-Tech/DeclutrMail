'use client';

import linkStyles from './billing-links.module.css';

import Link from 'next/link';
import { tokens } from '@declutrmail/shared';
import { TIER_MANIFEST, type TierId } from '@declutrmail/shared/entitlements';
import { useTier } from '@/features/auth/api/use-tier';
import { CAPABILITY_LABELS } from '@/features/marketing/pricing/pricing-model';

const { color } = tokens;
const tools = [
  ['senders', '/senders', 'Senders'],
  ['screener', '/screener', 'Screener'],
  ['autopilot', '/autopilot', 'Autopilot'],
  ['quiet', '/quiet', 'Quiet hours'],
  ['brief', '/brief', 'Daily Brief'],
  ['followups', '/followups', 'Follow-ups'],
] as const;

export function PlanCoverage({ tier }: { tier: TierId }) {
  const { connectedInboxes } = useTier();
  const plan = TIER_MANIFEST[tier];
  return (
    <section
      aria-label="Your plan includes"
      style={{ borderTop: `1px solid ${color.border}`, paddingTop: 16, display: 'grid', gap: 12 }}
    >
      <h2 style={{ fontSize: 18, margin: 0 }}>Your plan includes</h2>
      <div>
        {connectedInboxes ?? 0} of {plan.inboxLimit} connected inboxes ·{' '}
        <Link className={linkStyles.link} href="/settings">
          Manage inboxes
        </Link>
      </div>
      {(connectedInboxes ?? 0) > plan.inboxLimit ? (
        <p style={{ margin: 0 }}>
          Existing connections continue working. Adding an inbox is blocked while you are at or
          above this plan’s limit.
        </p>
      ) : null}
      <div>
        {plan.cleanupActionsPerMonth === null
          ? 'Unlimited cleanup'
          : `${plan.cleanupActionsPerMonth} cleanup actions per month`}
        . One cleanup action counts one sender acted on, not one email. Keep and Unarchive do not
        use this allowance.
      </div>
      <nav
        aria-label="Included tools"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}
      >
        {tools
          .filter(([capability]) => plan.capabilities.includes(capability))
          .map(([, href, label]) => (
            <Link className={linkStyles.link} key={href} href={href}>
              {label}
            </Link>
          ))}
      </nav>
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
    return <p style={{ margin: 0 }}>Your included features and inbox allowance stay the same.</p>;
  return (
    <div style={{ fontSize: 14, lineHeight: 1.6 }}>
      {gained.length ? <p>Added: {labelsFor(gained)}.</p> : null}
      {lost.length ? <p>No longer included after the change: {labelsFor(lost)}.</p> : null}
      <p>
        {to.name} includes {to.inboxLimit} connected {to.inboxLimit === 1 ? 'inbox' : 'inboxes'} and{' '}
        {to.cleanupActionsPerMonth === null
          ? 'unlimited cleanup'
          : `${to.cleanupActionsPerMonth} cleanup actions per month`}
        .
      </p>
      {to.inboxLimit < from.inboxLimit ? (
        <p>
          Existing connected inboxes continue working, even above the new limit. You cannot add
          another while at or above {to.inboxLimit}. Completed email actions stay in place.
        </p>
      ) : null}
    </div>
  );
}
