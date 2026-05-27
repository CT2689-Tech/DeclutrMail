'use client';

/**
 * Weekly Hero (D47, D48) — live wire-driven surface for the Senders
 * screen.
 *
 * Renders the three D48 slice cards (`high_confidence`, `spike`,
 * `quiet`) using the server-computed slice members + sparklines.
 * Hidden when `isMonday=false` per D47 ("refreshes Monday morning per
 * user timezone") — the call site decides whether to render this
 * component at all based on `data.isMonday`.
 *
 * Each card uses the existing `Bloc` primitive so the visual contract
 * matches the fixture-driven Hero (storybook stories continue to
 * render the same way). The adapter at the seam converts wire rows
 * → the `Sender` shape `Bloc` expects for its avatar dots.
 *
 * Privacy (D7, D228). Every field rendered is on the storage
 * allowlist — sender identity, monthly volume, read rate, sparkline
 * volume series. No body content, no headers, no attachments.
 */

import { Eyebrow, tokens } from '@declutrmail/shared';
import type { Sender } from '../data';
import type {
  WeeklyHeroDto,
  WeeklyHeroSenderDto,
  WeeklyHeroSliceDto,
  WeeklyHeroSliceKind,
} from '@/lib/api/senders';
import { Bloc, type BlocTone } from './bloc';
import type { Stat } from './stat-strip';

const { color, font } = tokens;

/** Per-slice copy / tone mapping — keeps the render function declarative. */
interface SliceMeta {
  tone: BlocTone;
  eyebrow: string;
  pitch: string;
  cta: string;
  /** What "N {label}" reads as below the count: "12 senders", "4 marketers", etc. */
  countLabel: (n: number) => string;
}

const SLICE_META: Record<WeeklyHeroSliceKind, SliceMeta> = {
  // D48 #1 — High-confidence cleanups. Card copy from the plan:
  // "12 senders we're confident about. Two-minute cleanup."
  high_confidence: {
    tone: 'warn',
    eyebrow: 'High-confidence cleanups',
    pitch: "Senders we're confident about. Two-minute cleanup — reversible for 7 days.",
    cta: 'Review the sweep',
    countLabel: (n) => (n === 1 ? 'sender' : 'senders'),
  },
  // D48 #2 — Volume spikes. Card copy from the plan:
  // "4 senders sending more than usual."
  spike: {
    tone: 'neutral',
    eyebrow: 'Volume spikes',
    pitch: 'Senders sending more than usual this week. Decide which deserve a spot.',
    cta: 'Look at the spikes',
    countLabel: (n) => (n === 1 ? 'sender' : 'senders'),
  },
  // D48 #3 — Long-quiet senders. Plan's softer copy:
  // "Easy unsubscribe before they come back."
  quiet: {
    tone: 'ok',
    eyebrow: 'Long-quiet senders',
    pitch: 'Senders gone quiet. Easy unsubscribe before they wake up.',
    cta: 'Easy unsubscribe',
    countLabel: (n) => (n === 1 ? 'sender' : 'senders'),
  },
};

/**
 * Adapt a wire row into the minimal `Sender` shape `Bloc`'s avatar
 * strip consumes. Only the fields `Bloc` reads are populated; the
 * rest are zero/defaulted (we never display them on the Hero card).
 *
 * Surgical (CLAUDE.md §1.3) — keep the FE `Sender` shape unchanged.
 * The Hero cards only render avatar + name + domain via `Bloc`.
 */
function adaptSliceRow(row: WeeklyHeroSenderDto): Sender {
  return {
    id: row.id,
    name: row.displayName || row.email,
    domain: row.domain,
    monthly: row.monthlyVolume,
    // Card doesn't render the Gmail category — pick the loosest bucket
    // so the type is satisfied (the `group` field is unused by `Bloc`).
    group: 'updates',
    read: row.readRate ?? 0,
    spark: [0, 0, 0, 0],
    lastDays: 0,
    unread: 0,
    firstSeenMo: 0,
  };
}

/** Sum sparklines from every sender in a slice into one 12-week bloc series. */
function blocSparkline(slice: WeeklyHeroSliceDto): number[] {
  if (slice.senders.length === 0) return [1, 1, 1, 1];
  // The wire ships 12 monthly buckets per sender. `Bloc`'s `Spark`
  // accepts any-length series. We sum across senders position-wise so
  // the bloc-level sparkline reflects total volume per month.
  const slots = slice.senders[0]!.sparkline.length;
  return Array.from({ length: slots }, (_, i) =>
    Math.max(
      1,
      slice.senders.reduce((sum, s) => sum + (s.sparkline[i] ?? 0), 0),
    ),
  );
}

/** Build the 3-cell stat strip per the D48 spec (vol/mo, avg read rate, top sender). */
function sliceStats(slice: WeeklyHeroSliceDto): Stat[] {
  const volume = slice.senders.reduce((acc, s) => acc + s.monthlyVolume, 0);
  // Avg read rate — weighted by sender volume so a high-volume sender
  // with low read rate dominates the average (matches the user's
  // intuition: "what fraction of the messages from this slice do I
  // actually open?").
  const totalReads = slice.senders.reduce(
    (acc, s) => acc + (s.readRate === null ? 0 : Math.round(s.readRate * s.monthlyVolume)),
    0,
  );
  const avgReadPct = volume === 0 ? 0 : Math.round((totalReads / volume) * 100);
  const top = slice.senders[0];
  return [
    { label: 'Volume', value: String(volume), sub: 'per month' },
    { label: 'Read rate', value: `${avgReadPct}%`, sub: 'average' },
    {
      label: 'Top sender',
      value: top?.displayName || top?.email || '—',
      sub: top ? `${top.monthlyVolume}/mo` : '',
    },
  ];
}

interface WeeklyHeroLiveProps {
  data: WeeklyHeroDto;
  /** Called when the user clicks the CTA on a slice card. */
  onReview: (kind: WeeklyHeroSliceKind, senders: WeeklyHeroSenderDto[]) => void;
  /** Called when the user dismisses the Hero for the week. */
  onSkip: () => void;
}

/**
 * Live Weekly Hero. Renders the slice cards returned by the BE; the
 * empty-state branch (no slices) is the caller's responsibility (the
 * `<SendersScreen>` skips rendering this component entirely if
 * `data.slices.length === 0`).
 */
export function WeeklyHeroLive({ data, onReview, onSkip }: WeeklyHeroLiveProps) {
  const totalDecisions = data.slices.reduce((acc, s) => acc + s.senders.length, 0);

  return (
    <section
      data-testid="weekly-hero-live"
      style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
    >
      <header style={{ maxWidth: 760 }}>
        <Eyebrow tone="primary">Weekly Hero · Week of {formatWeekOf(data.weekOf)}</Eyebrow>
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
          {totalDecisions} small calls this week.
        </h2>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: 16,
        }}
      >
        {data.slices.map((slice) => {
          const meta = SLICE_META[slice.kind];
          // Map slice rows → `Sender` for `Bloc`'s avatar strip only.
          // The CTA callback receives the wire rows so the call site
          // (which dispatches to the Review Session) keeps the wire
          // contract.
          const blocItems = slice.senders.map(adaptSliceRow);
          return (
            <Bloc
              key={slice.kind}
              tone={meta.tone}
              eyebrow={meta.eyebrow}
              count={slice.totalCount}
              countLabel={meta.countLabel(slice.totalCount)}
              pitch={meta.pitch}
              items={blocItems}
              stats={sliceStats(slice)}
              spark={blocSparkline(slice)}
              cta={meta.cta}
              onCta={() => onReview(slice.kind, slice.senders)}
            />
          );
        })}
      </div>

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
          Not now →
        </button>
      </div>
    </section>
  );
}

/**
 * Render `YYYY-MM-DD` as "Month D" (e.g. "May 11"). Used in the Hero
 * eyebrow. Falls back to the raw string when the date is unparseable
 * so the UI never blanks out.
 */
function formatWeekOf(weekOf: string): string {
  const parsed = new Date(weekOf);
  if (Number.isNaN(parsed.getTime())) return weekOf;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
