'use client';

import { Avatar, Button, Eyebrow, Spark, tokens } from '@declutrmail/shared';
import type { Sender } from '../data';
import { StatStrip, type Stat } from './stat-strip';

const { color, font } = tokens;

export type BlocTone = 'warn' | 'ok' | 'neutral';

const ARROW = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

/** One curated weekly-hero decision bloc. */
export function Bloc({
  tone,
  eyebrow,
  count,
  countLabel,
  pitch,
  items,
  stats,
  spark,
  cta,
  onCta,
}: {
  tone: BlocTone;
  eyebrow: string;
  count: number;
  countLabel: string;
  pitch: string;
  items: Sender[];
  stats: Stat[];
  spark: number[];
  cta: string;
  onCta: () => void;
}) {
  if (items.length === 0) return null;

  const wash =
    tone === 'warn'
      ? `linear-gradient(180deg, ${color.amberBg}, transparent 50%), ${color.card}`
      : tone === 'ok'
        ? `linear-gradient(180deg, ${color.primarySoft}, transparent 55%), ${color.card}`
        : color.card;
  const borderColor =
    tone === 'warn' ? 'rgba(245,158,11,0.35)' : tone === 'ok' ? color.primaryBorder : color.line;
  const sparkColor = tone === 'warn' ? color.amber : tone === 'ok' ? color.primary : color.fgSoft;

  return (
    <div
      data-dm-lift=""
      style={{
        background: wash,
        border: `1px solid ${borderColor}`,
        borderRadius: 14,
        padding: '20px 22px 18px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 320,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <Eyebrow tone={tone === 'warn' ? 'amber' : tone === 'ok' ? 'primary' : 'default'}>
          {eyebrow}
        </Eyebrow>
        <Spark values={spark} width={56} height={18} color={sparkColor} />
      </div>

      <h3
        style={{
          margin: '8px 0 0',
          fontFamily: font.display,
          fontSize: 34,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          fontWeight: 600,
          color: color.fg,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {count}
        <small
          style={{
            fontFamily: font.sans,
            fontSize: 14,
            fontWeight: 500,
            color: color.fgSoft,
            marginLeft: 6,
            letterSpacing: '-0.01em',
          }}
        >
          {countLabel}
        </small>
      </h3>

      <p style={{ margin: '8px 0 0', color: color.fgSoft, fontSize: 13.5, lineHeight: 1.5 }}>
        {pitch}
      </p>

      <StatStrip items={stats} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginTop: 'auto',
          marginBottom: 14,
        }}
      >
        {items.slice(0, 6).map((s, i) => (
          <span
            key={s.id}
            style={{
              marginLeft: i === 0 ? 0 : -6,
              boxShadow: `0 0 0 2px ${color.card}`,
              borderRadius: 8,
              display: 'inline-flex',
            }}
          >
            <Avatar name={s.name} domain={s.domain} size={26} />
          </span>
        ))}
        {items.length > 6 && (
          <span
            style={{
              marginLeft: 10,
              fontFamily: font.mono,
              fontSize: 10.5,
              color: color.fgMuted,
            }}
          >
            +{items.length - 6}
          </span>
        )}
      </div>

      <Button
        tone={tone === 'warn' ? 'warn' : tone === 'ok' ? 'ok' : 'dark'}
        size="md"
        onClick={onCta}
        iconRight={ARROW}
        style={{ width: '100%', justifyContent: 'space-between' }}
      >
        {cta}
      </Button>
    </div>
  );
}
