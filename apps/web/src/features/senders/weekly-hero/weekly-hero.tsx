'use client';

import { useMemo } from 'react';
import { Eyebrow, tokens } from '@declutrmail/shared';
import {
  detectPatterns,
  fmtCompact,
  pickPromoSlice,
  pickProtectSlice,
  pickQuietSlice,
  type ReviewKind,
  type Sender,
} from '../data';
import { Bloc } from './bloc';
import { PatternsRow } from './patterns-row';
import type { Stat } from './stat-strip';

const { color, font } = tokens;

/** Sum member sparklines position-wise into one 4-week bloc series. */
function blocSpark(items: Sender[]): number[] {
  if (items.length === 0) return [1, 1, 1, 1];
  return [0, 1, 2, 3].map((i) =>
    Math.max(
      1,
      items.reduce((sum, s) => sum + (s.spark[i] ?? 0), 0),
    ),
  );
}

function avgReadPct(items: Sender[]): number {
  if (items.length === 0) return 0;
  return Math.round((items.reduce((a, s) => a + s.read, 0) / items.length) * 100);
}

function sliceStats(items: Sender[]): Stat[] {
  const volume = items.reduce((a, s) => a + s.monthly, 0);
  const top = items[0];
  return [
    { label: 'Volume', value: fmtCompact(volume), sub: 'per month' },
    { label: 'Read rate', value: `${avgReadPct(items)}%`, sub: 'average' },
    {
      label: 'Top sender',
      value: top?.name ?? '—',
      sub: top ? `${top.monthly}/mo` : '',
    },
  ];
}

function protectStats(items: Sender[]): Stat[] {
  const locked = items.filter((s) => s.protected === true).length;
  const top = items[0];
  return [
    { label: 'Read rate', value: `${avgReadPct(items)}%`, sub: 'average' },
    { label: 'Already locked', value: `${locked}`, sub: `of ${items.length}` },
    { label: 'Top sender', value: top?.name ?? '—', sub: top?.domain ?? '' },
  ];
}

function weekOfLabel(): string {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  return sunday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The weekly hero — "Three small calls this week". Frames the week as
 * three deliberate decisions before exposing the full sender list.
 */
export function WeeklyHero({
  senders,
  onReview,
  onSkip,
}: {
  senders: Sender[];
  onReview: (slice: Sender[], kind: ReviewKind) => void;
  onSkip: () => void;
}) {
  const promo = useMemo(() => pickPromoSlice(senders), [senders]);
  const quiet = useMemo(() => pickQuietSlice(senders), [senders]);
  const protect = useMemo(() => pickProtectSlice(senders), [senders]);
  const patterns = useMemo(() => detectPatterns(senders), [senders]);

  if (promo.length === 0 && quiet.length === 0 && protect.length === 0) {
    return null;
  }

  const promoVolume = promo.reduce((a, s) => a + s.monthly, 0);
  const promoHours = Math.max(1, Math.round((promoVolume * 14 * 0.25) / 3600));

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header style={{ maxWidth: 760 }}>
        <Eyebrow tone="primary">Recommended for you · Week of {weekOfLabel()}</Eyebrow>
        <h2
          style={{
            margin: '10px 0 0',
            fontFamily: font.display,
            fontSize: 42,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            lineHeight: 1.04,
            color: color.fg,
          }}
        >
          Three small calls this week,{' '}
          <em
            style={{
              fontFamily: font.display,
              fontStyle: 'italic',
              fontWeight: 600,
              color: color.primary,
            }}
          >
            ~{promoHours}h back
          </em>{' '}
          if you take them.
        </h2>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: 16,
        }}
      >
        <Bloc
          tone="warn"
          eyebrow="Promos worth dropping"
          count={promo.length}
          countLabel={promo.length === 1 ? 'marketer' : 'marketers'}
          pitch="Senders you almost never open. One sweep clears them — reversible for 7 days."
          items={promo}
          stats={sliceStats(promo)}
          spark={blocSpark(promo)}
          cta="Review the sweep"
          onCta={() => onReview(promo, 'promo')}
        />
        <Bloc
          tone="neutral"
          eyebrow="Quiet keepers"
          count={quiet.length}
          countLabel={quiet.length === 1 ? 'sender' : 'senders'}
          pitch="Low-volume newsletters you sometimes read. Decide which ones earn a spot."
          items={quiet}
          stats={sliceStats(quiet)}
          spark={blocSpark(quiet)}
          cta="Decide together"
          onCta={() => onReview(quiet, 'quiet')}
        />
        <Bloc
          tone="ok"
          eyebrow="People to protect"
          count={protect.length}
          countLabel={protect.length === 1 ? 'sender' : 'senders'}
          pitch="Real people and the few brands you reply to. Lock them from bulk actions."
          items={protect}
          stats={protectStats(protect)}
          spark={blocSpark(protect)}
          cta="Confirm protect"
          onCta={() => onReview(protect, 'protect')}
        />
      </div>

      <PatternsRow
        patterns={patterns}
        onReview={(id) => {
          const pattern = patterns.find((p) => p.id === id);
          if (!pattern) return;
          const slice = senders.filter((s) => pattern.senderIds.includes(s.id));
          onReview(slice, pattern.id === 'lapsed' ? 'quiet' : 'promo');
        }}
      />

      <div style={{ textAlign: 'right' }}>
        <button
          onClick={onSkip}
          style={{
            background: 'transparent',
            border: 'none',
            color: color.fgMuted,
            fontFamily: font.mono,
            fontSize: 11,
            letterSpacing: '0.04em',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Skip this week →
        </button>
      </div>
    </section>
  );
}
