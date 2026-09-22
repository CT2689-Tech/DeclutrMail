'use client';

import { tokens } from '@declutrmail/shared';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { CAPABILITY_LABELS } from '@/features/marketing/pricing/pricing-model';

const { color } = tokens;

export function BillingComparison() {
  const tiers = ['free', 'plus', 'pro'] as const;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
      <caption style={{ textAlign: 'left', marginBottom: 10 }}>Included features by plan</caption>
      <thead>
        <tr>
          <th scope="col" style={{ textAlign: 'left' }}>
            Includes
          </th>
          {tiers.map((id) => (
            <th scope="col" key={id}>
              {TIER_MANIFEST[id].name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row" style={{ textAlign: 'left' }}>
            Connected inboxes
          </th>
          {tiers.map((id) => (
            <td style={{ textAlign: 'center' }} key={id}>
              {TIER_MANIFEST[id].inboxLimit}
            </td>
          ))}
        </tr>
        <tr>
          <th scope="row" style={{ textAlign: 'left' }}>
            Cleanup / month
          </th>
          {tiers.map((id) => (
            <td style={{ textAlign: 'center' }} key={id}>
              {TIER_MANIFEST[id].cleanupActionsPerMonth ?? 'Unlimited'}
            </td>
          ))}
        </tr>
        {TIER_MANIFEST.pro.capabilities.map((cap) => (
          <tr key={cap} style={{ borderTop: `1px solid ${color.border}` }}>
            <th scope="row" style={{ textAlign: 'left', padding: '8px 0', fontWeight: 400 }}>
              {CAPABILITY_LABELS[cap]}
            </th>
            {tiers.map((id) => (
              <td style={{ textAlign: 'center' }} key={id}>
                {TIER_MANIFEST[id].capabilities.includes(cap) ? 'Included' : '—'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
