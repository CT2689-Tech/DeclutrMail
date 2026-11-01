'use client';

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
import { DrillRow, SettingsGroup, SettingsRow } from '@/features/settings/settings-list';
import { CAPABILITY_LABELS } from '@/features/marketing/pricing/pricing-model';

import { tierInboxLimit } from './billing-model';

const { color, text } = tokens;
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
  // The server's ceiling: it already knows launch pricing and a Pass's
  // one-account limit, which the manifest's legacy value does not.
  const { connectedInboxes, inboxLimit, pricingV2 } = useTier();
  const plan = TIER_MANIFEST[tier];
  const connected = connectedInboxes ?? 0;
  const included = tools.filter(([capability]) => plan.capabilities.includes(capability));
  return (
    <SettingsGroup
      title="Your plan includes"
      footer={
        connected > inboxLimit ? (
          <p style={{ margin: '10px 0 0', fontSize: text.sm, color: color.fgMuted }}>
            Existing connections continue working. Adding a Gmail account is blocked while you are
            at or above this plan’s limit.
          </p>
        ) : null
      }
    >
      <DrillRow
        href="/settings#mailboxes"
        label="Gmail accounts"
        value={`${connected} of ${inboxLimit} connected`}
      />
      <SettingsRow
        label="Cleanup"
        detail={
          pricingV2 && pass
            ? fillStoryList(
                freeManualPass
                  ? WS1_COPY['pricing.pass.features.granted']
                  : WS1_COPY['pricing.pass.features'],
              ).map((line) => <div key={line}>{line}</div>)
            : plan.cleanupActionsPerMonth === null
              ? `${WS2_COPY.liveFix.billing.limit.unlimited.replace(/\.$/, '')} on emails cleared.`
              : fillStory(WS2_COPY.liveFix.billing.limit.free)
        }
      />
      <SettingsRow
        label="Features"
        detail={
          <ul
            aria-label="Included features"
            style={{ display: 'flex', flexWrap: 'wrap', margin: 0, padding: 0, listStyle: 'none' }}
          >
            {included.map(([capability, label], index) => (
              <li key={capability}>
                {index > 0 ? (
                  <span aria-hidden="true" style={{ margin: '0 8px' }}>
                    ·
                  </span>
                ) : null}
                <span>{label}</span>
              </li>
            ))}
          </ul>
        }
      />
    </SettingsGroup>
  );
}

export function PlanConsequences({
  fromTier,
  toTier,
  pricingV2 = false,
}: {
  fromTier: TierId;
  toTier: TierId;
  pricingV2?: boolean;
}) {
  const from = TIER_MANIFEST[fromTier];
  const to = TIER_MANIFEST[toTier];
  const fromLimit = tierInboxLimit(fromTier, pricingV2);
  const toLimit = tierInboxLimit(toTier, pricingV2);
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
        {to.name} includes {toLimit} connected Gmail {toLimit === 1 ? 'account' : 'accounts'}.{' '}
        {to.cleanupActionsPerMonth === null
          ? WS2_COPY.liveFix.billing.limit.unlimited
          : fillStory(WS2_COPY.liveFix.billing.limit.free)}
      </p>
      {toLimit < fromLimit ? (
        <p>
          Existing connected Gmail accounts continue working, even above the new limit. You cannot
          add another while at or above {toLimit}. Completed email actions stay in place.
        </p>
      ) : null}
    </div>
  );
}
