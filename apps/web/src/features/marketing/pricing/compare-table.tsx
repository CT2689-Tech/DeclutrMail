'use client';

import { comparablePricingTiers, compareRows } from './pricing-model';
import { CheckGlyph } from './tier-card';

/**
 * Capability comparison (D19) — every row and cell derives from
 * `TIER_MANIFEST` via `compareRows()`; the table re-renders itself when
 * the manifest changes. The header sticks under the site bar while the
 * table scrolls past; the narrowest phones scroll it sideways instead
 * (styles in ./pricing.css).
 */
export function CompareTable() {
  const tiers = comparablePricingTiers();
  const rows = compareRows();

  return (
    <div role="region" aria-label="Scrollable plan comparison" tabIndex={0} className="dm-compare">
      <table>
        <thead>
          <tr>
            <th scope="col">What you get</th>
            {tiers.map((tier) => (
              <th scope="col" key={tier.id}>
                {tier.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.values.map((value, j) => (
                <td key={`${row.label}-${tiers[j]?.id ?? j}`}>
                  {value === null ? (
                    <span role="img" aria-label="Not included" className="dm-compare-no">
                      —
                    </span>
                  ) : value === 'Included' ? (
                    <span role="img" aria-label="Included" className="dm-compare-yes">
                      <CheckGlyph />
                    </span>
                  ) : (
                    value
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
