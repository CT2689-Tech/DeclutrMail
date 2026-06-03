'use client';

/**
 * `SenderCard` — one sender card on the grid view (D49).
 *
 * Visual vocabulary aligned to the Hero `Bloc` primitive: tone-tinted
 * gradient wash, display-font primary numeric, mono accents, mini
 * sparkline, recommendation-driven primary CTA. Every sender in the
 * grid feels like a curated bloc rather than a spreadsheet row.
 *
 * Privacy (D7, D228). Renders only allowlisted fields: sender name,
 * domain, monthly volume, read rate, last-seen days. Never body
 * content, attachments, or non-allowlisted headers.
 */

import type { ReactNode } from 'react';
import { Avatar, Button, Spark, tokens } from '@declutrmail/shared';
import {
  canArchive,
  canLater,
  canUnsubscribe,
  isStandingProtected,
  type ActionRequest,
  type Sender,
} from '../data';
import { intentOf, type SenderIntent } from '../uplift-d/intent';

const { color, font } = tokens;

/** Tone palette mirroring `Bloc` — one per intent. Drives wash + border
 *  + accent so the card's mood instantly signals the recommendation. */
const TONE_BY_INTENT: Record<
  SenderIntent,
  {
    wash: string;
    border: string;
    accent: string;
    sparkColor: string;
    /** The verb that should "lead" — bigger, tone-colored, on the left. */
    leadVerb: 'Unsubscribe' | 'Later' | 'Keep' | 'Archive';
  }
> = {
  cleanup: {
    wash: `linear-gradient(180deg, ${color.amberBg}, transparent 55%), ${color.card}`,
    border: 'rgba(245,158,11,0.35)',
    accent: color.amber,
    sparkColor: color.amber,
    leadVerb: 'Unsubscribe',
  },
  later: {
    wash: `linear-gradient(180deg, rgba(14,20,19,0.04), transparent 55%), ${color.card}`,
    border: color.line,
    accent: color.fg,
    sparkColor: color.fgSoft,
    leadVerb: 'Later',
  },
  protect: {
    wash: `linear-gradient(180deg, ${color.primarySoft}, transparent 55%), ${color.card}`,
    border: color.primaryBorder,
    accent: color.primary,
    sparkColor: color.primary,
    leadVerb: 'Keep',
  },
  people: {
    wash: color.card,
    border: color.line,
    accent: color.fg,
    sparkColor: color.fgSoft,
    leadVerb: 'Keep',
  },
};

const ARROW = (
  <svg
    width="11"
    height="11"
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

const VERB_ICONS: Record<'Archive' | 'Later' | 'Unsubscribe', ReactNode> = {
  Archive: (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  ),
  Later: (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Unsubscribe: (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
};

export interface SenderCardProps {
  sender: Sender;
  /** Selected — controlled by parent for shift-click range + sticky bar. */
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onAction: (req: ActionRequest) => void;
}

export function SenderCard({ sender, selected, onToggleSelect, onAction }: SenderCardProps) {
  const archiveOk = canArchive(sender);
  const laterOk = canLater(sender);
  const unsubOk = canUnsubscribe(sender);
  const intent = intentOf(sender);
  const tone = TONE_BY_INTENT[intent];
  const readPct = Math.round(sender.read * 100);
  const protectedNow = isStandingProtected(sender);

  // Secondary verbs — exclude the lead so the bottom row only carries
  // the alternatives.
  const SECONDARY: Array<{ verb: 'Archive' | 'Later' | 'Unsubscribe'; ok: boolean }> = [
    { verb: 'Archive', ok: archiveOk },
    { verb: 'Later', ok: laterOk },
    { verb: 'Unsubscribe', ok: unsubOk },
  ].filter((v) => v.verb !== tone.leadVerb) as Array<{
    verb: 'Archive' | 'Later' | 'Unsubscribe';
    ok: boolean;
  }>;

  return (
    <article
      data-testid={`sender-card-${sender.id}`}
      data-selected={selected || undefined}
      data-dm-lift=""
      style={{
        background: tone.wash,
        border: `1px solid ${selected ? color.primary : tone.border}`,
        borderRadius: 14,
        padding: '18px 18px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        position: 'relative',
        transition: 'border-color 120ms, box-shadow 120ms',
        minHeight: 240,
      }}
    >
      {/* Top — avatar + identity + selection + (optional) sparkline */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Avatar name={sender.name} domain={sender.domain} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: font.sans,
              fontSize: 14,
              fontWeight: 600,
              color: color.fg,
              letterSpacing: '-0.005em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sender.name}
          </div>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 10.5,
              color: color.fgMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 1,
            }}
          >
            {sender.domain}
          </div>
        </div>
        {sender.spark && sender.spark.length > 0 && (
          <Spark values={sender.spark} width={48} height={16} color={tone.sparkColor} />
        )}
        <input
          type="checkbox"
          aria-label={`Select ${sender.name}`}
          checked={selected}
          onChange={() => onToggleSelect(sender.id)}
          style={{ cursor: 'pointer', marginTop: 2 }}
        />
      </div>

      {/* Primary numeric — Bloc-style display number + mono sub */}
      <div>
        <div
          style={{
            fontFamily: font.display,
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: '-0.025em',
            lineHeight: 1,
            color: color.fg,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {sender.monthly}
          <small
            style={{
              fontFamily: font.sans,
              fontSize: 12,
              fontWeight: 500,
              color: color.fgSoft,
              marginLeft: 8,
              letterSpacing: '-0.005em',
            }}
          >
            in last 30d
          </small>
        </div>

        {/* Stat micro-strip — mirrors Bloc.StatStrip vocabulary */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 0,
            marginTop: 10,
            paddingTop: 10,
            borderTop: `1px dashed ${color.lineSoft}`,
            fontFamily: font.mono,
            fontSize: 10.5,
            color: color.fgMuted,
            letterSpacing: '0.02em',
          }}
        >
          <Stat
            label="READ"
            value={`${readPct}%`}
            valueColor={readPct >= 50 ? tone.accent : color.fg}
          />
          <Stat label="LAST" value={sender.lastDays > 0 ? `${sender.lastDays}d` : 'today'} />
          <Stat
            label="STATUS"
            value={protectedNow ? 'Protected' : intentLabel(intent)}
            valueColor={protectedNow ? color.primary : color.fg}
          />
        </div>
      </div>

      {/* Bottom — lead verb (tone-colored, full-width-ish) + secondaries */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 'auto' }}>
        <Button
          tone={leadButtonTone(tone.leadVerb)}
          size="sm"
          onClick={() => onAction({ verb: tone.leadVerb, senders: [sender] })}
          iconRight={ARROW}
          style={{ flex: 1, justifyContent: 'space-between', minWidth: 0 }}
        >
          {leadButtonCopy(tone.leadVerb)}
        </Button>
        {SECONDARY.map(({ verb, ok }) => (
          <Button
            key={verb}
            tone="default"
            size="sm"
            disabled={!ok}
            onClick={() => onAction({ verb, senders: [sender] })}
            iconLeft={VERB_ICONS[verb]}
            aria-label={verb}
            title={verb}
          >
            {verb}
          </Button>
        ))}
      </div>
    </article>
  );
}

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9.5, textTransform: 'uppercase', color: color.fgMuted }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: font.sans,
          fontSize: 13,
          fontWeight: 600,
          color: valueColor ?? color.fg,
          letterSpacing: '-0.005em',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function intentLabel(i: SenderIntent): string {
  switch (i) {
    case 'cleanup':
      return 'Cleanup';
    case 'later':
      return 'Move later';
    case 'protect':
      return 'Protected';
    case 'people':
      return 'Keep';
    default: {
      // Forces a compile error if `SenderIntent` grows a new variant —
      // without this, the function silently returns `undefined` and
      // ships the literal string "undefined" to the DOM.
      const _exhaustive: never = i;
      return _exhaustive;
    }
  }
}

function leadButtonTone(
  verb: 'Unsubscribe' | 'Later' | 'Keep' | 'Archive',
): 'warn' | 'dark' | 'default' {
  if (verb === 'Unsubscribe') return 'warn';
  if (verb === 'Keep') return 'dark';
  return 'default';
}

function leadButtonCopy(verb: 'Unsubscribe' | 'Later' | 'Keep' | 'Archive'): string {
  // Single-word labels so the lead CTA never truncates in narrow grid
  // columns. The recommendation context lives in the tone wash + the
  // primary numeric — the button doesn't need to re-state the volume.
  switch (verb) {
    case 'Unsubscribe':
      return 'Unsubscribe';
    case 'Later':
      return 'Later';
    case 'Keep':
      return 'Keep';
    case 'Archive':
      return 'Archive';
    default: {
      const _exhaustive: never = verb;
      return _exhaustive;
    }
  }
}
