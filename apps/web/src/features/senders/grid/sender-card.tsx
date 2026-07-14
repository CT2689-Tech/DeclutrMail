'use client';

/**
 * `SenderCard` — one sender card on the grid view (D49).
 *
 * Visual vocabulary aligned to ADR-0016 §B3: neutral hairline chrome
 * (no recommendation tone-wash), `NumericDisplay variant="display"`
 * for the primary monthly volume, mono accents, mini sparkline, and a
 * K/A/U/L lead verb derived from observed facts.
 *
 * The card↔detail navigation no longer presents chrome discontinuity:
 * card sits on `color.card` with `color.line` hairline border + 8px
 * corners (`radius.md`), matching the `SenderDetailHeader` chrome rule.
 * The lead verb and its only accent derive from observed sender facts;
 * engine intent/confidence never drives card presentation (D245).
 *
 * Privacy (D7, D228). Renders only allowlisted fields: sender name,
 * domain, monthly volume, read rate, last-seen days. Never body
 * content, attachments, or non-allowlisted headers.
 */

import { useState } from 'react';
import type { UnsubscribeLifecycleStatus } from '@declutrmail/shared/contracts';
import {
  Avatar,
  NumericDisplay,
  Spark,
  tokens,
  type NumericDisplayTone,
} from '@declutrmail/shared';
import { derivePrimaryVerbId, SenderActionRow } from '../action-row';
import { ReadBucketText } from '../fact-language';
import { EPOCH_GUARD_DAYS, isStandingProtected, type Sender } from '../data';
import type { ActionRequest } from '../data';
import { isFeatureEnabled } from '@/lib/flags';
import { SenderPeek } from './sender-peek';

const { color, font, radius } = tokens;

// Lead-verb derivation, the ⋯ ActionPopover, and the verb-id bridges
// moved to `../action-row.tsx` (2026-07-03 consistency pass) so the
// table row renders the SAME action grammar — see `SenderActionRow`.

export interface SenderCardProps {
  sender: Sender;
  /** Selected — controlled by parent for shift-click range + sticky bar. */
  selected: boolean;
  /**
   * Checkbox toggle — `shiftKey` rides up so the screen's anchor-based
   * range logic (D52) can span-select; the card owns no selection math.
   */
  onToggleSelect: (id: string, shiftKey?: boolean) => void;
  onAction: (req: ActionRequest) => void;
  /**
   * Mailbox-wide MAX(total_received) — magnitude under-bar denominator
   * per ADR-0016 §B1. Bar width = `sender.total / globalMaxTotal`,
   * clamped to [0, 1]. A filtered view does NOT rescale to its own max
   * (bars stay comparable across compose changes). `0` = no senders →
   * render no bar to avoid divide-by-zero.
   */
  globalMaxTotal: number;
}

/**
 * Unsub pill copy by execution state (D9 Wave 2 — honest states, never
 * a promised outcome). Keyed by `Sender.unsubStatus`; `none` covers a
 * recorded intent with NO tracked execution — a mailto sender whose
 * manual send happens from Sender Detail (D230), or method-none.
 *
 * Exported as the ONE copy source for the unsub status chip — the
 * SenderTable row chip and the Sender Detail header pill render the
 * same map so list ↔ detail never contradict each other.
 */
export function unsubscribeStatusCopy(
  status: UnsubscribeLifecycleStatus | null | undefined,
  method: Sender['unsubscribeMethod'],
): { label: string; title: string } {
  const resolved =
    status ??
    (method === 'mailto' ? 'action_required' : method === 'none' ? 'unavailable' : 'requested');
  return UNSUB_PILL[resolved];
}

export const UNSUB_PILL: Record<UnsubscribeLifecycleStatus, { label: string; title: string }> = {
  requested: {
    label: 'Requesting…',
    title: "The unsubscribe request is being delivered to the sender's endpoint",
  },
  endpoint_accepted: {
    label: 'Request accepted',
    title: 'The endpoint accepted the request; future delivery still depends on the sender',
  },
  failed: {
    label: 'Request failed',
    title: 'The unsubscribe request failed; Archive remains available for current mail',
  },
  unconfirmed: {
    label: 'Result unconfirmed',
    title: 'The endpoint result could not be confirmed; watch for future mail',
  },
  action_required: {
    label: 'Send from Gmail',
    title: 'This sender requires an email request that you send from Gmail',
  },
  draft_opened: {
    label: 'Draft opened',
    title: 'The Gmail draft was opened; DeclutrMail has not been told it was sent',
  },
  user_marked_sent: {
    label: 'Marked sent',
    title:
      'You reported sending the unsubscribe email; future delivery still depends on the sender',
  },
  unavailable: {
    label: 'Unavailable',
    title: 'No supported unsubscribe channel was found for this sender',
  },
};

export function SenderCard({
  sender,
  selected,
  onToggleSelect,
  onAction,
  globalMaxTotal,
}: SenderCardProps) {
  const primaryVerb = derivePrimaryVerbId(sender);
  const protectedNow = isStandingProtected(sender);
  // Quick-peek dialog (grid↔table parity) — renders the same
  // `SenderRowDetailLive` panel the table's expand-row shows. Opened
  // from the identity block below; closes on Escape / backdrop / a
  // verb fire (the D226 confirm modal takes over from there).
  const [peekOpen, setPeekOpen] = useState(false);
  const peekEnabled = isFeatureEnabled('senderPeek');

  return (
    <article
      data-testid={`sender-card-${sender.id}`}
      data-selected={selected || undefined}
      data-dm-lift=""
      style={{
        // ADR-0016 §A2 — neutral hairline chrome. Was tone-wash by
        // recommendation grouping, which created a trust hit on
        // financial-institution senders (BofA / Chase reading
        // "Cleanup"). Facts now drive both the lead verb and accent.
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
        {/* Identity block doubles as the quick-peek opener — a real
            <button> (keyboard + SR reachable), NOT a clickable-card
            wrapper: checkbox and verb buttons stay siblings, matching
            the table's dedicated-expand-control contract. senderPeek
            flag off (ADR-0025): stays a plain block, no dialog
            affordance. */}
        <button
          type="button"
          onClick={peekEnabled ? () => setPeekOpen(true) : undefined}
          title={peekEnabled ? 'Peek at recent emails and volume' : undefined}
          aria-haspopup={peekEnabled ? 'dialog' : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 'none',
            padding: 0,
            textAlign: 'left',
            cursor: peekEnabled ? 'pointer' : 'default',
            display: 'block',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
            }}
          >
            <span
              // Full identity on hover — duplicate display names are
              // only distinguishable by the underlying address
              // (2026-07-07 founder smoke feedback).
              title={sender.email ? `${sender.name} <${sender.email}>` : sender.name}
              style={{
                fontFamily: font.sans,
                fontSize: 14,
                fontWeight: 600,
                color: color.fg,
                letterSpacing: '-0.005em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {sender.name}
            </span>
            {sender.unsubPending &&
              (() => {
                const copy = unsubscribeStatusCopy(sender.unsubStatus, sender.unsubscribeMethod);
                return (
                  <span
                    title={copy.title}
                    style={{
                      fontFamily: font.mono,
                      fontSize: 9.5,
                      letterSpacing: '0.10em',
                      textTransform: 'uppercase',
                      color: color.primary,
                      background: color.primarySoft,
                      border: `1px solid ${color.primaryBorder}`,
                      borderRadius: 999,
                      padding: '1px 6px',
                      flex: '0 0 auto',
                    }}
                  >
                    {copy.label}
                  </span>
                );
              })()}
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
        </button>
        {sender.spark && sender.spark.length > 0 && (
          // ADR-0016 §B3 — sparkline color uniformly neutral; tone
          // semantics removed from card chrome.
          <Spark values={sender.spark} width={48} height={16} color={color.fgSoft} />
        )}
        {/* Toggle fires from onClick (not onChange) — the click event is
            the only one that carries `shiftKey`, which the screen's
            range-select logic needs (D52). `readOnly` + controlled
            `checked` keeps React's controlled-input contract intact;
            keyboard toggling still works (Space synthesizes a click). */}
        <input
          type="checkbox"
          aria-label={`Select ${sender.name}`}
          checked={selected}
          readOnly
          onClick={(e) => onToggleSelect(sender.id, e.shiftKey)}
          style={{ cursor: 'pointer', marginTop: 2 }}
        />
      </div>

      {/* Primary numeric — `NumericDisplay variant="display"`
          (Fraunces 28/400). Was `hero` (40px); demoted per spec
          v1.2 Decision 13: `hero` reserved for true hero moments
          (Weekly Hero slice + KPI strip cells), not every card. */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <NumericDisplay
            value={sender.monthly}
            suffix="in last 30d"
            variant="display"
            style={{ display: 'flex' }}
          />
          {/* Lifetime volume — the number the default "Most emails
              ever" sort ranks by. Without it a top-ranked sender with
              a quiet month reads as a sort bug (2026-07-03 smoke:
              cards showed 72 / 0 / 8 under total-desc). Same fact the
              magnitude bar below encodes, now legible. */}
          {sender.total !== undefined && (
            <span
              title="Lifetime emails received — what 'Most emails ever' sorts by"
              style={{
                fontFamily: font.mono,
                fontSize: 10.5,
                color: color.fgMuted,
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {sender.total.toLocaleString()} ever
            </span>
          )}
        </div>

        {/* Magnitude under-bar (spec v1.2 Decision 13 + ADR-0016 §B1).
            2px bar width-proportional to mailbox max. Amber when the
            factual one-click unsubscribe action is available; muted
            otherwise. Hidden when totalsAcrossMailbox absent —
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
                background: primaryVerb === 'unsubscribe' ? color.amber : color.fgSoft,
                transformOrigin: 'left center',
                // ADR-0016 §B1 — denominator is mailbox-wide MAX, not
                // a hardcoded 100. `sender.total` is the sender's
                // lifetime inbound count; bar width is the proportion of
                // the mailbox's loudest sender. Filtered view does NOT
                // rescale.
                transform: `scaleX(${
                  sender.total != null && globalMaxTotal > 0
                    ? Math.min(1, sender.total / globalMaxTotal)
                    : 0
                })`,
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
          {/* Read state speaks the shared bucket vocabulary (fact-language
              module) — the raw % was false precision on small baselines
              AND used "Opened", which Gmail metadata can't support
              ("marked read" is the honest fact). Same words + tones as
              the table's Read column. */}
          <Stat label="Read" value={<ReadBucketText rate={sender.read} />} />
          {/* Epoch guard: Gmail reports internalDate=0 for some spam
              messages, which lands here as ~20,000d. "—" is the honest
              render — we don't know when. */}
          <Stat
            label="Last seen"
            value={
              sender.lastDays > EPOCH_GUARD_DAYS
                ? '—'
                : sender.lastDays > 0
                  ? `${sender.lastDays}d`
                  : 'today'
            }
          />
          <Stat
            label="You replied"
            value={sender.repliedCount !== undefined ? `${sender.repliedCount}×` : '—'}
          />
        </div>
      </div>

      {/* Bottom — primary CTA + ⋯ overflow (spec v1.2 Decision 9 +
          ADR-0019). Shared `SenderActionRow` — identical action grammar
          to the table row; capabilities + primary derivation live in
          one place now. */}
      <SenderActionRow sender={sender} onAction={onAction} stretch />

      {peekEnabled && peekOpen && (
        <SenderPeek
          sender={sender}
          onClose={() => setPeekOpen(false)}
          onAction={(req) => {
            // Hand off to the D226 confirm modal and close the peek —
            // two stacked dialogs would fight for focus + Escape.
            setPeekOpen(false);
            onAction(req);
          }}
        />
      )}
    </article>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  /** String renders through `NumericDisplay variant="data"`; a node
   *  (e.g. the shared `ReadBucketText`) renders as-is so bucket words
   *  keep their fact-language tone. */
  value: string | React.ReactNode;
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
      {typeof value === 'string' ? (
        <NumericDisplay value={value} variant="data" tone={tone ?? 'default'} />
      ) : (
        value
      )}
    </div>
  );
}
