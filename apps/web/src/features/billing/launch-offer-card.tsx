'use client';

import { Button, Card, Pill, tokens } from '@declutrmail/shared';

const { color, radius, text } = tokens;

/**
 * One launch offer — Plus or the Backlog Pass — with everything the old
 * "Before you pay" panel said (price, renewal, tax, refund) on the card
 * itself. That makes the card the D226 preview, rendered inline, so its
 * button opens the provider checkout directly: Paddle's own screen still
 * shows the total and needs its Pay tap before anything is charged.
 */
export function LaunchOfferCard({
  name,
  badge,
  recommended = false,
  amount,
  per,
  hint,
  features,
  terms,
  ctaLabel,
  pending = false,
  disabled = false,
  error = null,
  highlighted = false,
  testId,
  onBuy,
}: {
  name: string;
  badge: string;
  recommended?: boolean;
  /** "$59" */
  amount: string;
  /** "/yr" or "once" */
  per: string;
  /** "about $4.92 a month" / "Never renews" */
  hint?: string;
  features: readonly string[];
  /** The preview: renewal, tax, refund, code — one short paragraph. */
  terms: readonly string[];
  ctaLabel: string;
  pending?: boolean;
  disabled?: boolean;
  error?: string | null;
  /** A deep link named this offer: draw the eye without opening checkout. */
  highlighted?: boolean;
  testId: string;
  onBuy: () => void;
}) {
  return (
    <Card
      accent={recommended}
      padding={0}
      style={{
        display: 'flex',
        minWidth: 0,
        outline: highlighted ? `2px solid ${color.primary}` : undefined,
        outlineOffset: highlighted ? 2 : undefined,
      }}
    >
      <section
        id={`offer-${testId}`}
        tabIndex={-1}
        aria-label={name}
        data-testid={testId}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 'clamp(18px, 3vw, 24px)',
          width: '100%',
          scrollMarginTop: 24,
        }}
      >
        <Pill tone={recommended ? 'primary' : 'default'} style={{ alignSelf: 'flex-start' }}>
          {badge}
        </Pill>
        <h3 style={{ margin: 0, fontSize: text.xl, fontWeight: 600, color: color.fg }}>{name}</h3>
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '2px 8px' }}>
          <span
            style={{
              ...tokens.typography.stat,
              color: color.fg,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {amount}
          </span>
          <span style={{ fontSize: text.md, color: color.fgSoft }}>{per}</span>
          {hint ? <span style={{ fontSize: text.sm, color: color.fgMuted }}>{hint}</span> : null}
        </div>
        <ul
          style={{
            display: 'grid',
            gap: 8,
            margin: 0,
            padding: 0,
            listStyle: 'none',
            fontSize: text.base,
            color: color.fgSoft,
          }}
        >
          {features.map((feature) => (
            <li key={feature} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{ color: color.primary, fontWeight: 700 }}>
                ✓
              </span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        <p
          data-testid={`${testId}-terms`}
          style={{ margin: 0, fontSize: text.sm, lineHeight: 1.5, color: color.fgMuted }}
        >
          {terms.join(' ')}
        </p>
        <div style={{ marginTop: 'auto', paddingTop: 4 }}>
          <Button
            tone={recommended ? 'primary' : 'default'}
            size="lg"
            style={{ width: '100%' }}
            disabled={disabled || pending}
            onClick={onBuy}
          >
            {ctaLabel}
          </Button>
        </div>
        {error ? (
          <div
            role="alert"
            style={{
              fontSize: text.sm,
              color: color.dangerText,
              background: color.dangerBg,
              borderRadius: radius.md,
              padding: '8px 10px',
            }}
          >
            {error}
          </div>
        ) : null}
      </section>
    </Card>
  );
}
