'use client';

import { tokens } from '@declutrmail/shared';
import { INBOXES, METER, TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { CAPABILITY_LABELS } from '@/features/marketing/pricing/pricing-model';

const { color } = tokens;

const COMPARISON_TIERS = ['free', 'plus', 'pro'] as const;

/** Same grouping the meter uses (`1,000 of 1,000 left`). */
function formatQuota(value: number): string {
  return value.toLocaleString('en-US');
}

export interface BillingComparisonRow {
  label: string;
  values: readonly string[];
}

/**
 * Included-features rows. Inbox counts follow `PRICING_V2` (`INBOXES`)
 * or the manifest. Emails cleared come from `METER`: Free is the
 * configured limit, and paid plans have no monthly limit. Capability
 * rows collapse when two capabilities share a label.
 */
export function billingComparisonRows(pricingV2: boolean): readonly BillingComparisonRow[] {
  const rows: BillingComparisonRow[] = [
    {
      label: 'Gmail accounts',
      values: COMPARISON_TIERS.map((id) =>
        formatQuota(pricingV2 ? INBOXES[id] : TIER_MANIFEST[id].inboxLimit),
      ),
    },
    {
      label: 'Emails cleared a month',
      values: COMPARISON_TIERS.map((id) =>
        id === 'free' ? formatQuota(METER.free.limit) : 'No monthly limit',
      ),
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
  const allRows = billingComparisonRows(pricingV2);
  const shared = allRows.filter((row) => row.values.every((value) => value === 'Included'));
  const rows = allRows.filter((row) => !shared.includes(row));
  return (
    <div>
      <p style={{ margin: '0 0 16px', lineHeight: 1.6 }}>
        <strong>Included on every plan:</strong> {shared.map((row) => row.label).join('; ')}.
      </p>
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
    </div>
  );
}
