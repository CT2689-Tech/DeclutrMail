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

import { useState } from 'react';
import {
  ActionPopover,
  ActionPopoverTrigger,
  Avatar,
  Button,
  NumericDisplay,
  Spark,
  tokens,
  type NumericDisplayTone,
} from '@declutrmail/shared';
import { deriveDefaultPrimary, type VerbId } from '@declutrmail/shared/actions';
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

// ADR-0019 Verb Registry now provides verb icons via `VerbSpec.icon`
// (emoji glyph). The legacy `VERB_ICONS` SVG map retired with the
// secondary-buttons row on the card; ActionPopover renders icons
// uniformly across surfaces. The Phase 5 dead-code sweep removed the
// SVG strings from this file in 2026-06-03.

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
        {/* Emerald protected dot (spec v1.2 + ADR-0019). 6px overlay
            bottom-right of avatar when the sender is standing-protected
            (D42/D43 — Protect OR VIP). Replaces the inline "STATUS:
            Protected" text the stat strip used to render — surfaces
            the state at a glance without a label leak. */}
        <span
          style={{
            position: 'relative',
            display: 'inline-flex',
            flex: '0 0 auto',
          }}
        >
          <Avatar name={sender.name} domain={sender.domain} size={40} />
          {protectedNow && (
            <span
              aria-label="Protected sender"
              title="Protected — never auto-recommended for Unsubscribe"
              style={{
                position: 'absolute',
                bottom: -2,
                right: -2,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: color.emerald,
                border: `2px solid ${color.card}`,
              }}
            />
          )}
        </span>
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

      {/* Primary numeric — `NumericDisplay variant="display"`
          (Fraunces 28/400). Was `hero` (40px); demoted per spec
          v1.2 Decision 13: `hero` reserved for true hero moments
          (Weekly Hero slice + KPI strip cells), not every card. */}
      <div>
        <NumericDisplay
          value={sender.monthly}
          suffix="in last 30d"
          variant="display"
          style={{ display: 'flex' }}
        />

        {/* Magnitude under-bar (spec v1.2 Decision 13 + ADR-0016 §B1).
            2px bar width-proportional to mailbox max. Amber when
            sender is unsub-ready (recommendation-action-available);
            muted otherwise. Hidden when totalsAcrossMailbox absent —
            wire shape varies. */}
        {sender.total !== undefined && (
          <div
            aria-hidden="true"
            style={{
              height: 2,
              background: color.line,
              marginTop: 8,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                background: intent === 'cleanup' ? color.amber : color.fgSoft,
                transformOrigin: 'left center',
                transform: `scaleX(${Math.min(1, sender.monthly / 100)})`,
              }}
            />
          </div>
        )}

        {/* Stat micro-strip — full-word user-friendly labels per
            spec v1.2 Decision 12. `STATUS` retired (was the only
            inferred cell on the card); replaced with `You replied`
            (fact-only). Labels follow ADR-0016 §B2 (Mono 10 / 0.12em
            uppercase). Values use `NumericDisplay variant="data"`. */}
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
          <Stat label="Opened" value={`${readPct}%`} />
          <Stat label="Last seen" value={sender.lastDays > 0 ? `${sender.lastDays}d` : 'today'} />
          <Stat
            label="You replied"
            value={sender.repliedCount !== undefined ? `${sender.repliedCount}×` : '—'}
          />
        </div>
      </div>

      {/* Bottom — primary CTA + ⋯ overflow (spec v1.2 Decision 9 +
          ADR-0019). Primary verb derived per Verb Registry's
          `deriveDefaultPrimary` fact-rule; overflow popover exposes
          the full K/A/U/L/D set so user can compose any action. */}
      <CardActionRow
        sender={sender}
        legacyLeadVerb={leadVerb}
        capabilities={{
          archive: archiveOk,
          later: laterOk,
          unsubscribe: unsubOk,
          keep: true,
          // Phase 2 PR-FE3 (ADR-0019 + spec v1.2 Decision 1) — Delete
          // now routes end-to-end: `legacyVerbFromId('delete')` returns
          // the 'Delete' verb instead of 'Archive', `ActionVerb` was
          // widened, and the composite confirm modal renders the red
          // Delete tone + 30-day recovery warning. Enabled at the card
          // surface so the popover row is selectable.
          delete: true,
        }}
        onAction={onAction}
      />
    </article>
  );
}

/**
 * Renders the bottom row of the card: derived-primary CTA + `⋯`
 * trigger that opens the K/A/U/L/D ActionPopover. Primary verb is
 * derived from `deriveDefaultPrimary` (ADR-0019 fact-rule), with a
 * legacy fallback to the `intentOf` lead-verb while the wire still
 * carries intent metadata — once Phase 2 PR-FE2 retires `intentOf`
 * the fallback drops.
 */
function CardActionRow({
  sender,
  legacyLeadVerb,
  capabilities,
  onAction,
}: {
  sender: Sender;
  legacyLeadVerb: 'Unsubscribe' | 'Later' | 'Keep' | 'Archive';
  capabilities: Record<VerbId, boolean>;
  onAction: (req: ActionRequest) => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Fact-rule primary derivation (ADR-0019). Falls back to the
  // legacy `intentOf` lead verb when neither rule's antecedent
  // fires — preserves continuity until Phase 2 PR-FE2 lands the
  // fact-first cut.
  const factPrimary = deriveDefaultPrimary({
    protected: sender.protected === true || sender.isVip === true,
    unsubReady: false, // wire field lands in Phase 1 BE; until then fall back
    lastSeenDays: sender.lastDays,
  });
  const primaryVerbId: VerbId =
    factPrimary === 'keep' ? mapLegacyVerb(legacyLeadVerb) : factPrimary;

  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        marginTop: 'auto',
        position: 'relative',
      }}
    >
      <Button
        tone={leadButtonTone(legacyVerbFromId(primaryVerbId))}
        size="sm"
        onClick={() => onAction({ verb: legacyVerbFromId(primaryVerbId), senders: [sender] })}
        iconRight={ARROW}
        style={{ flex: 1, justifyContent: 'space-between', minWidth: 0 }}
      >
        {legacyVerbFromId(primaryVerbId)}
      </Button>
      {/* Trigger opens the popover only — never toggles. Toggle pattern
          races against the popover's click-outside listener (which sees
          the trigger as 'outside' and closes, then the trigger's
          onClick re-opens). Open-only + ESC/click-outside close is the
          standard menu-button affordance (silent-failure-hunter
          2026-06-03 advisory). */}
      <ActionPopoverTrigger onClick={() => setPopoverOpen(true)} />
      {popoverOpen && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', right: 0, zIndex: 50 }}>
          <ActionPopover
            capabilities={capabilities}
            dimmedVerb={primaryVerbId}
            onPick={(verbId) => {
              onAction({ verb: legacyVerbFromId(verbId), senders: [sender] });
            }}
            onClose={() => setPopoverOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Bridge the FE `ActionVerb` legacy type ('Unsubscribe' / 'Later' /
 * 'Keep' / 'Archive') to the new `VerbId` enum ('unsubscribe' /
 * 'later' / 'keep' / 'archive' / 'delete'). Lower-cases the verb;
 * unknown values default to 'keep'.
 */
function mapLegacyVerb(verb: 'Unsubscribe' | 'Later' | 'Keep' | 'Archive'): VerbId {
  switch (verb) {
    case 'Unsubscribe':
      return 'unsubscribe';
    case 'Later':
      return 'later';
    case 'Keep':
      return 'keep';
    case 'Archive':
      return 'archive';
    default: {
      const _exhaustive: never = verb;
      return _exhaustive;
    }
  }
}

/**
 * Inverse of `mapLegacyVerb` — converts `VerbId` back to the legacy
 * `ActionVerb` shape `onAction` callbacks expect. Spec v1.2 Decision 1
 * (PR-FE3) widened `ActionVerb` to include 'Delete', so this bridge is
 * exhaustive across the K/A/U/L/D set.
 */
function legacyVerbFromId(id: VerbId): 'Unsubscribe' | 'Later' | 'Keep' | 'Archive' | 'Delete' {
  switch (id) {
    case 'unsubscribe':
      return 'Unsubscribe';
    case 'later':
      return 'Later';
    case 'keep':
      return 'Keep';
    case 'archive':
      return 'Archive';
    case 'delete':
      return 'Delete';
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
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

/**
 * Lead-button tone derivation for the primary CTA. Tone semantics
 * locked by D26/D31 + ADR-0019: Unsubscribe = amber `warn`; Keep =
 * dark; Delete = `warn` (red is mapped to warn at this build until the
 * danger tone variant lands as a Button prop — design-system follow-up);
 * others = neutral `default`. Per spec v1.2 Decision 2, Delete is
 * `canBePrimary: false` so this branch is reached only when a verb
 * registry rule routes it as primary, but the type still has to span the
 * full K/A/U/L/D set so the bridge typechecks.
 */
function leadButtonTone(
  verb: 'Unsubscribe' | 'Later' | 'Keep' | 'Archive' | 'Delete',
): 'warn' | 'dark' | 'default' {
  if (verb === 'Unsubscribe') return 'warn';
  if (verb === 'Delete') return 'warn';
  if (verb === 'Keep') return 'dark';
  return 'default';
}
