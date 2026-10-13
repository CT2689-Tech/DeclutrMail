'use client';

import { tokens } from '@declutrmail/shared';
import { INBOXES, METER, TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { CAPABILITY_LABELS } from '@/features/marketing/pricing/pricing-model';

const { color } = tokens;

const COMPARISON_TIERS = ['free', 'plus', 'pro'] as const;

export interface BillingComparisonRow {
  label: string;
  values: readonly string[];
}

/**
 * Included-features rows. Quotas come from the same config the live
 * allowance uses: `PRICING_V2` reads `INBOXES` and `METER`, and the
 * legacy ladder reads the manifest. Capability rows collapse when two
 * capabilities share a label.
 */
export function billingComparisonRows(pricingV2: boolean): readonly BillingComparisonRow[] {
  const rows: BillingComparisonRow[] = [
    {
      label: 'Connected inboxes',
      values: COMPARISON_TIERS.map((id) =>
        String(pricingV2 ? INBOXES[id] : TIER_MANIFEST[id].inboxLimit),
      ),
    },
    {
      label: 'Cleanup / month',
      values: COMPARISON_TIERS.map((id) => {
        if (pricingV2) return id === 'free' ? String(METER.free.limit) : 'Unlimited';
        const quota = TIER_MANIFEST[id].cleanupActionsPerMonth;
        return quota === null ? 'Unlimited' : String(quota);
      }),
    },
  ];
  const seen = new Set<string>();
  for (const cap of TIER_MANIFEST.pro.capabilities) {
    const label = CAPABILITY_LABELS[cap];
    if (seen.has(label)) continue;
    seen.add(label);
    rows.push({
      label,
      values: COMPARISON_TIERS.map((id) =>
        TIER_MANIFEST[id].capabilities.includes(cap) ? 'Included' : '—',
      ),
    });
  }
  return rows;
}

export function BillingComparison({ pricingV2 = false }: { pricingV2?: boolean }) {
  const rows = billingComparisonRows(pricingV2);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
      <caption style={{ textAlign: 'left', marginBottom: 10 }}>Included features by plan</caption>
      <thead>
        <tr>
          <th scope="col" style={{ textAlign: 'left' }}>
            Includes
          </th>
          {COMPARISON_TIERS.map((id) => (
            <th scope="col" key={id}>
              {TIER_MANIFEST[id].name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr
            key={row.label}
            style={index < 2 ? undefined : { borderTop: `1px solid ${color.border}` }}
          >
            <th scope="row" style={{ textAlign: 'left', padding: '8px 0', fontWeight: 400 }}>
              {row.label}
            </th>
            {row.values.map((value, index) => (
              <td style={{ textAlign: 'center' }} key={COMPARISON_TIERS[index]}>
                {value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
