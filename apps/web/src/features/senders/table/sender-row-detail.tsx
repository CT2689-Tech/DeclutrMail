'use client';

import { useMemo } from 'react';
import { Button, Eyebrow, tokens } from '@declutrmail/shared';
import {
  canLater,
  canUnsubscribe,
  gmailSearchUrl,
  historicCount,
  recommendAction,
  relTimeLabel,
  sampleSubjects,
  type ActionRequest,
  type Sender,
} from '../data';

const { color, font } = tokens;

/** Inline detail panel revealed when a sender row is expanded. */
export function SenderRowDetail({
  s,
  onAction,
}: {
  s: Sender;
  onAction: (req: ActionRequest) => void;
}) {
  const rec = recommendAction(s);
  const recLabel = rec ?? 'Keep';
  const subjects = sampleSubjects(s);

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
    if (s.protected) {
      return "Protected — bulk actions can't touch this sender. Remove protection from its detail page to change that.";
    }
    if (s.read >= 0.7) return `You read ${read}% of ${s.name}'s mail. No action recommended.`;
    return `${s.monthly}/mo at ${read}% read — no strong signal either way.`;
  }, [s, rec]);

  const bars = useMemo(() => {
    const weekly = Math.max(1, Math.round(s.monthly / 4));
    const seed = s.id.charCodeAt(0) * 9301 + 49297;
    const out: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = ((seed * (i + 1)) % 233280) / 233280;
      out.push(Math.max(1, Math.round(weekly * (0.55 + r * 0.95))));
    }
    if (s.spike) out[11] = Math.round((out[11] ?? weekly) * 1.8);
    return out;
  }, [s]);
  const maxBar = Math.max(...bars, 1);
  const lastBarColor =
    recTone === 'warn' ? color.amber : recTone === 'dark' ? color.fg : color.primary;

  const stats: { k: string; v: string; small?: string; valueColor?: string }[] = [
    { k: 'Total ever', v: historicCount(s).toLocaleString(), small: 'emails' },
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
        <div
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
            <Eyebrow>Last 12 weeks</Eyebrow>
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 10,
                color: color.fgMuted,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              peak {maxBar}/wk
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64 }}>
            {bars.map((h, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${Math.max(6, (h / maxBar) * 100)}%`,
                  background: i === bars.length - 1 ? lastBarColor : 'rgba(14,20,19,0.12)',
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
            <span>12w ago</span>
            <span>this week</span>
          </div>
        </div>

        <div
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
          <div>
            {subjects.map((subj, i) => (
              <div
                key={i}
                style={{
                  padding: '6px 0',
                  borderBottom: i === subjects.length - 1 ? 'none' : `1px solid ${color.lineSoft}`,
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
        </div>
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
