'use client';

/**
 * `SenderCard` — one sender card on the grid view (D49).
 *
 * Visual vocabulary aligned to ADR-0016 §B3: neutral hairline chrome
 * (no tone-wash by intent), `NumericDisplay variant="hero"` for the
 * primary monthly volume, mono accents, mini sparkline, K/A/U/L lead
 * verb derived from `intentOf` (semantics retained per ADR-0016 §B3).
 *
 * The card↔detail navigation no longer presents chrome discontinuity:
 * card sits on `color.card` with `color.line` hairline border + 8px
 * corners (`radius.md`), matching the `SenderDetailHeader` chrome rule.
 *
 * Privacy (D7, D228). Renders only allowlisted fields: sender name,
 * domain, monthly volume, read rate, last-seen days. Never body
 * content, attachments, or non-allowlisted headers.
 */

import type { ReactNode } from 'react';
import {
  Avatar,
  Button,
  NumericDisplay,
  Spark,
  tokens,
  type NumericDisplayTone,
} from '@declutrmail/shared';
import {
  canArchive,
  canLater,
  canUnsubscribe,
  isStandingProtected,
  type ActionRequest,
  type Sender,
} from '../data';
import { intentOf, type SenderIntent } from '../uplift-d/intent';

const { color, font, radius } = tokens;

/**
 * Lead-verb map keyed by intent (ADR-0016 §B3 — `intentOf` retains
 * semantic role of deriving the primary CTA per card). Chrome-related
 * tones (wash / border / accent / sparkColor) were retired here
 * because they re-stated the intent label on the card surface and
 * created a trust hit on financial-institution senders (BofA / Chase).
 * Card chrome is now uniformly neutral; only the lead verb varies.
 */
const LEAD_VERB_BY_INTENT: Record<SenderIntent, 'Unsubscribe' | 'Later' | 'Keep' | 'Archive'> = {
  cleanup: 'Unsubscribe',
  later: 'Later',
  protect: 'Keep',
  people: 'Keep',
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
  const leadVerb = LEAD_VERB_BY_INTENT[intent];
  const readPct = Math.round(sender.read * 100);
  const protectedNow = isStandingProtected(sender);

  // Secondary verbs — exclude the lead so the bottom row only carries
  // the alternatives.
  const SECONDARY: Array<{ verb: 'Archive' | 'Later' | 'Unsubscribe'; ok: boolean }> = [
    { verb: 'Archive', ok: archiveOk },
    { verb: 'Later', ok: laterOk },
    { verb: 'Unsubscribe', ok: unsubOk },
  ].filter((v) => v.verb !== leadVerb) as Array<{
    verb: 'Archive' | 'Later' | 'Unsubscribe';
    ok: boolean;
  }>;

  return (
    <article
      data-testid={`sender-card-${sender.id}`}
      data-selected={selected || undefined}
      data-dm-lift=""
      style={{
        // ADR-0016 §A2 — neutral hairline chrome. Was tone-wash by
        // intent which created a trust hit on financial-institution
        // senders (BofA / Chase reading "Cleanup"). Intent still
        // drives the lead verb (§B3) — it no longer drives chrome.
        background: color.card,
        border: `1px solid ${selected ? color.primary : color.line}`,
        borderRadius: radius.md,
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
          // ADR-0016 §B3 — sparkline color uniformly neutral; tone
          // semantics removed from card chrome.
          <Spark values={sender.spark} width={48} height={16} color={color.fgSoft} />
        )}
        <input
          type="checkbox"
          aria-label={`Select ${sender.name}`}
          checked={selected}
          onChange={() => onToggleSelect(sender.id)}
          style={{ cursor: 'pointer', marginTop: 2 }}
        />
      </div>

      {/* Primary numeric — ADR-0016 §A1 `NumericDisplay variant="hero"`. */}
      <div>
        <NumericDisplay
          value={sender.monthly}
          suffix="in last 30d"
          variant="hero"
          style={{ display: 'flex' }}
        />

        {/* Stat micro-strip — labels follow ADR-0016 §B2 (Mono 10
            letter-spacing 0.12em uppercase). Values use
            `NumericDisplay variant="data"` for cross-surface scale
            consistency. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 0,
            marginTop: 10,
            paddingTop: 10,
            borderTop: `1px dashed ${color.lineSoft}`,
          }}
        >
          <Stat label="READ" value={`${readPct}%`} />
          <Stat label="LAST" value={sender.lastDays > 0 ? `${sender.lastDays}d` : 'today'} />
          <Stat
            label="STATUS"
            value={protectedNow ? 'Protected' : intentLabel(intent)}
            tone={protectedNow ? 'primary' : 'default'}
          />
        </div>
      </div>

      {/* Bottom — lead verb + secondaries (verb derivation via
          `intentOf`; chrome is neutral per ADR-0016 §A2). */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 'auto' }}>
        <Button
          tone={leadButtonTone(leadVerb)}
          size="sm"
          onClick={() => onAction({ verb: leadVerb, senders: [sender] })}
          iconRight={ARROW}
          style={{ flex: 1, justifyContent: 'space-between', minWidth: 0 }}
        >
          {leadButtonCopy(leadVerb)}
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

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  /** Reuses the shared `NumericDisplayTone` so a future tone added to
   *  the primitive is inherited here without a duplicate-union edit
   *  (typescript-reviewer advisory 2026-06-03). */
  tone?: NumericDisplayTone;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          textTransform: 'uppercase',
          color: color.fgMuted,
          letterSpacing: '0.12em',
        }}
      >
        {label}
      </span>
      <NumericDisplay value={value} variant="data" tone={tone ?? 'default'} />
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
