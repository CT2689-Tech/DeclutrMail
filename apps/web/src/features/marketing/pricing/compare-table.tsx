'use client';

import { tokens } from '@declutrmail/shared';

import { compareRows, pricingTiers } from './pricing-model';

const { color, font, radius } = tokens;

/**
 * Capability comparison (D19) — every row and cell derives from
 * `TIER_MANIFEST` via `compareRows()`; the table re-renders itself when
 * the manifest changes. Scrolls horizontally on narrow viewports.
 */
export function CompareTable() {
  const tiers = pricingTiers();
  const rows = compareRows();

  return (
    <div style={{ overflowX: 'auto', borderRadius: radius.lg, border: `1px solid ${color.line}` }}>
      <table
        style={{
          width: '100%',
          minWidth: 760,
          borderCollapse: 'collapse',
          background: color.card,
          fontFamily: font.sans,
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ borderBottom: `1px solid ${color.border}` }}>
            <th
              scope="col"
              style={{
                textAlign: 'left',
                padding: '14px 18px',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: color.fgMuted,
              }}
            >
              What you get
            </th>
            {tiers.map((tier) => (
              <th
                scope="col"
                key={tier.id}
                style={{
                  textAlign: 'center',
                  padding: '14px 12px',
                  fontFamily: font.display,
                  fontSize: 14,
                  fontWeight: 650,
                  color: color.fg,
                  whiteSpace: 'nowrap',
                }}
              >
                {tier.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.label}
              style={{
                borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${color.lineSoft}`,
              }}
            >
              <th
                scope="row"
                style={{
                  textAlign: 'left',
                  padding: '11px 18px',
                  fontWeight: 500,
                  color: color.fg,
                  maxWidth: 340,
                }}
              >
                {row.label}
              </th>
              {row.values.map((value, j) => (
                <td
                  key={`${row.label}-${tiers[j]?.id ?? j}`}
                  style={{
                    textAlign: 'center',
                    padding: '11px 12px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {value === null ? (
                    <span aria-label="Not included" style={{ color: color.fgMuted }}>
                      —
                    </span>
                  ) : value === 'Included' ? (
                    <span aria-label="Included" style={{ color: color.primary, fontWeight: 700 }}>
                      ✓
                    </span>
                  ) : (
                    <span style={{ color: color.fgSoft, fontWeight: 500 }}>{value}</span>
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
