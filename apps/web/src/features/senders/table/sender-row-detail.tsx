'use client';

import { useMemo } from 'react';
import { Button, Eyebrow, tokens } from '@declutrmail/shared';
import type { TimeseriesPointDto } from '@/lib/api/senders';
import { useSenderMessages } from '../api/use-sender-messages';
import { useSenderTimeseries } from '../api/use-sender-timeseries';
import {
  canLater,
  canUnsubscribe,
  gmailSearchUrl,
  isStandingProtected,
  recommendAction,
  relTimeLabel,
  type ActionRequest,
  type Sender,
} from '../data';

const { color, font } = tokens;

/**
 * Volume-chart data for the expanded panel, as a closed union so the
 * render layer can't mix states (D211 — loading / error / empty /
 * ready are each a designed state, never a fallthrough).
 */
export type RowDetailTimeseries =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; points: TimeseriesPointDto[] };

/**
 * Recent-subjects data for the expanded panel — same closed-union
 * discipline as `RowDetailTimeseries` (D211).
 */
export type RowDetailSubjects =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; subjects: string[] };

/** Panel shows at most this many recent subjects — no pagination here. */
const SUBJECT_PREVIEW_COUNT = 3;

/**
 * Data-wired variant — fetches the sender's real 12-month timeseries
 * and recent messages (same query keys the Sender Detail page uses, so
 * an expand pre-warms that cache; the messages hook is shared with the
 * Detail page's list, first page only — the panel never paginates).
 * Mounts only when a row expands, which is what makes this a
 * fetch-on-expand: collapsed rows never query.
 */
export function SenderRowDetailLive({
  s,
  onAction,
}: {
  s: Sender;
  onAction: (req: ActionRequest) => void;
}) {
  const query = useSenderTimeseries(s.id);
  const timeseries: RowDetailTimeseries = query.isPending
    ? { status: 'loading' }
    : query.isError
      ? { status: 'error', retry: () => void query.refetch() }
      : { status: 'ready', points: query.data.data };

  const messages = useSenderMessages(s.id);
  const subjects: RowDetailSubjects = messages.isPending
    ? { status: 'loading' }
    : messages.isError
      ? { status: 'error', retry: () => void messages.refetch() }
      : {
          status: 'ready',
          subjects: (messages.data.pages[0]?.data ?? [])
            .slice(0, SUBJECT_PREVIEW_COUNT)
            .map((m) => m.subject),
        };

  return <SenderRowDetail s={s} onAction={onAction} timeseries={timeseries} subjects={subjects} />;
}

/** Inline detail panel revealed when a sender row is expanded. */
export function SenderRowDetail({
  s,
  onAction,
  timeseries,
  subjects,
}: {
  s: Sender;
  onAction: (req: ActionRequest) => void;
  timeseries: RowDetailTimeseries;
  subjects: RowDetailSubjects;
}) {
  const rec = recommendAction(s);
  const recLabel = rec ?? 'Keep';

  const recTone: 'warn' | 'dark' | null =
    rec === 'Unsubscribe' ? 'warn' : rec === 'Later' ? 'dark' : null;
  const calloutBg =
    recTone === 'warn'
      ? `linear-gradient(180deg, ${color.amberBg}, transparent 60%), ${color.card}`
      : recTone === 'dark'
        ? `linear-gradient(180deg, rgba(14,20,19,0.04), transparent 60%), ${color.card}`
        : `linear-gradient(180deg, ${color.primarySoft}, transparent 60%), ${color.card}`;
  const calloutBorder =
    recTone === 'warn'
      ? 'rgba(245,158,11,0.35)'
      : recTone === 'dark'
        ? color.line
        : color.primaryBorder;

  const why = useMemo(() => {
    const read = Math.round(s.read * 100);
    if (rec === 'Unsubscribe') {
      return s.spike
        ? `Volume spike (${s.spike}× usual) on a sender you almost never open (${read}% read).`
        : `${s.monthly} emails per month at ${read}% read — this sender mostly fills the inbox without being seen.`;
    }
    if (rec === 'Later') {
      return `${s.monthly}/mo at ${read}% read. "Later" keeps the mail in Gmail but stops surfacing it in the daily queue.`;
    }
    if (isStandingProtected(s)) {
      return "Protected — bulk actions can't touch this sender. Remove protection from its detail page to change that.";
    }
    if (s.read >= 0.7) return `You read ${read}% of ${s.name}'s mail. No action recommended.`;
    return `${s.monthly}/mo at ${read}% read — no strong signal either way.`;
  }, [s, rec]);

  const lastBarColor =
    recTone === 'warn' ? color.amber : recTone === 'dark' ? color.fg : color.primary;

  const stats: { k: string; v: string; small?: string; valueColor?: string }[] = [
    { k: 'Total ever', v: s.total != null ? s.total.toLocaleString() : '—', small: 'emails' },
    { k: 'Last opened', v: relTimeLabel(s.lastDays) },
    {
      k: 'Read rate',
      v: `${Math.round(s.read * 100)}%`,
      valueColor: s.read >= 0.5 ? color.primary : s.read >= 0.2 ? color.fg : color.amber,
    },
    { k: 'Volume', v: s.monthly.toLocaleString(), small: '/mo' },
  ];

  return (
    <div
      style={{
        padding: '20px 24px 22px 68px',
        background: 'rgba(14,20,19,0.022)',
        borderBottom: `1px solid ${color.lineSoft}`,
        boxShadow: `inset 3px 0 0 ${color.primary}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Why we recommend */}
      <div
        style={{
          background: calloutBg,
          border: `1px solid ${calloutBorder}`,
          borderRadius: 12,
          padding: '16px 20px',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 16,
          alignItems: 'center',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Eyebrow tone={recTone === 'warn' ? 'amber' : recTone === 'dark' ? 'default' : 'primary'}>
            {rec ? `Recommended · ${recLabel}` : 'No recommendation · Keep'}
          </Eyebrow>
          <p
            style={{
              margin: '6px 0 0',
              color: color.fg,
              fontSize: 14,
              lineHeight: 1.55,
              maxWidth: '62ch',
            }}
          >
            {why}
          </p>
        </div>
        {rec && (
          <Button
            tone={rec === 'Unsubscribe' ? 'warn' : 'dark'}
            size="md"
            onClick={() => onAction({ verb: rec, senders: [s] })}
          >
            {recLabel}
          </Button>
        )}
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {stats.map((stat) => (
          <div
            key={stat.k}
            style={{
              padding: '14px 16px',
              background: color.card,
              border: `1px solid ${color.line}`,
              borderRadius: 10,
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontFamily: font.mono,
                fontSize: 9.5,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: color.fgMuted,
              }}
            >
              {stat.k}
            </div>
            <div
              style={{
                fontFamily: font.display,
                fontSize: 22,
                fontWeight: 600,
                color: stat.valueColor ?? color.fg,
                letterSpacing: '-0.022em',
                marginTop: 4,
                display: 'flex',
                alignItems: 'baseline',
                gap: 4,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {stat.v}
              {stat.small != null && (
                <small
                  style={{
                    fontFamily: font.sans,
                    fontSize: 11.5,
                    color: color.fgMuted,
                    fontWeight: 400,
                  }}
                >
                  {stat.small}
                </small>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Chart + recent subjects */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <VolumeChartCard timeseries={timeseries} lastBarColor={lastBarColor} />
        <RecentSubjectsCard subjects={subjects} />
      </div>

      {/* Decide + footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          paddingTop: 14,
          borderTop: `1px dashed ${color.line}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Eyebrow>Decide</Eyebrow>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button
              size="sm"
              tone={!rec ? 'dark' : 'default'}
              onClick={() => onAction({ verb: 'Keep', senders: [s] })}
            >
              Keep
            </Button>
            <Button
              size="sm"
              tone={rec === 'Later' ? 'dark' : 'default'}
              disabled={!canLater(s)}
              onClick={() => onAction({ verb: 'Later', senders: [s] })}
            >
              Later
            </Button>
            <Button
              size="sm"
              tone={rec === 'Unsubscribe' ? 'warn' : 'default'}
              disabled={!canUnsubscribe(s)}
              onClick={() => onAction({ verb: 'Unsubscribe', senders: [s] })}
            >
              Unsubscribe
            </Button>
          </div>
        </div>
        <a
          href={gmailSearchUrl(s.domain)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: font.mono,
            fontSize: 11,
            letterSpacing: '0.04em',
            color: color.fgSoft,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          View in Gmail ↗
        </a>
      </div>
    </div>
  );
}

/** "Aug 2025" from a first-of-month ISO date ("2025-08-01"). */
function monthYearLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-');
  const names = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const name = names[Math.max(0, Math.min(11, Number(m ?? '1') - 1))] ?? '';
  return `${name} ${y ?? ''}`.trim();
}

const CHART_BODY_HEIGHT = 64;

/**
 * Monthly volume mini-chart on the expanded panel — the same
 * `sender_timeseries` months the Sender Detail volume chart renders
 * (sparse: months with no mail have no row and no bar, matching the
 * Detail chart's bar-per-row convention).
 */
function VolumeChartCard({
  timeseries,
  lastBarColor,
}: {
  timeseries: RowDetailTimeseries;
  lastBarColor: string;
}) {
  const points = timeseries.status === 'ready' ? timeseries.points : [];
  const maxBar = Math.max(1, ...points.map((p) => p.volume));
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div
      aria-busy={timeseries.status === 'loading'}
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Eyebrow>Volume / 12 months</Eyebrow>
        {points.length > 0 && (
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 10,
              color: color.fgMuted,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            peak {maxBar}/mo
          </span>
        )}
      </div>

      {timeseries.status === 'loading' && (
        <div
          aria-hidden="true"
          style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: CHART_BODY_HEIGHT }}
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              style={{ flex: 1, height: '38%', background: color.mutedBg, borderRadius: 2 }}
            />
          ))}
        </div>
      )}

      {timeseries.status === 'error' && (
        <div
          style={{
            height: CHART_BODY_HEIGHT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontFamily: font.mono,
            fontSize: 11,
            color: color.fgMuted,
          }}
        >
          Couldn&apos;t load volume history
          <button
            type="button"
            onClick={timeseries.retry}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontFamily: font.mono,
              fontSize: 11,
              fontWeight: 600,
              color: color.fgSoft,
              textDecoration: 'underline',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {timeseries.status === 'ready' && points.length === 0 && (
        <div
          style={{
            height: CHART_BODY_HEIGHT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: font.mono,
            fontSize: 11,
            color: color.fgMuted,
          }}
        >
          No volume history yet
        </div>
      )}

      {timeseries.status === 'ready' && points.length > 0 && (
        <>
          <div
            role="img"
            aria-label={`Monthly volume over ${points.length} month${points.length === 1 ? '' : 's'}, peak ${maxBar} per month`}
            style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: CHART_BODY_HEIGHT }}
          >
            {points.map((p, i) => (
              <div
                key={p.yearMonth}
                style={{
                  flex: 1,
                  height: `${Math.max(2, (p.volume / maxBar) * 100)}%`,
                  background: i === points.length - 1 ? lastBarColor : 'rgba(14,20,19,0.12)',
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: font.mono,
              fontSize: 9,
              color: color.fgMuted,
              letterSpacing: '0.08em',
            }}
          >
            <span>{first != null ? monthYearLabel(first.yearMonth) : ''}</span>
            {points.length > 1 && last != null && <span>{monthYearLabel(last.yearMonth)}</span>}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Recent-subjects card on the expanded panel — the first page of the
 * sender's real `GET /api/senders/:id/messages` rows (same list the
 * Sender Detail page shows), capped at {@link SUBJECT_PREVIEW_COUNT}.
 */
function RecentSubjectsCard({ subjects }: { subjects: RowDetailSubjects }) {
  const stateCopy = (text: string, retry?: () => void) => (
    <div
      style={{
        padding: '6px 0',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: font.mono,
        fontSize: 11,
        color: color.fgMuted,
      }}
    >
      {text}
      {retry != null && (
        <button
          type="button"
          onClick={retry}
          style={{
            all: 'unset',
            cursor: 'pointer',
            fontFamily: font.mono,
            fontSize: 11,
            fontWeight: 600,
            color: color.fgSoft,
            textDecoration: 'underline',
          }}
        >
          Retry
        </button>
      )}
    </div>
  );

  return (
    <div
      aria-busy={subjects.status === 'loading'}
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <Eyebrow>Recent subjects</Eyebrow>

      {subjects.status === 'loading' && (
        <div aria-hidden="true">
          {Array.from({ length: SUBJECT_PREVIEW_COUNT }).map((_, i) => (
            <div key={i} style={{ padding: '6px 0' }}>
              <div
                style={{
                  height: 12,
                  width: `${88 - i * 14}%`,
                  background: color.mutedBg,
                  borderRadius: 3,
                }}
              />
            </div>
          ))}
        </div>
      )}

      {subjects.status === 'error' && stateCopy("Couldn't load recent subjects", subjects.retry)}

      {subjects.status === 'ready' &&
        subjects.subjects.length === 0 &&
        stateCopy('No recent messages')}

      {subjects.status === 'ready' && subjects.subjects.length > 0 && (
        <div>
          {subjects.subjects.map((subj, i) => (
            <div
              key={i}
              style={{
                padding: '6px 0',
                borderBottom:
                  i === subjects.subjects.length - 1 ? 'none' : `1px solid ${color.lineSoft}`,
                fontSize: 12.5,
                color: color.fg,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {subj}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
