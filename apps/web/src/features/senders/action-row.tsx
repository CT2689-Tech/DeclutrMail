'use client';

/**
 * `SenderActionRow` — the ONE per-sender action affordance on Senders
 * list surfaces (ADR-0016 A5 + ADR-0019): a derived primary verb
 * button + the `⋯` trigger opening the K/A/U/L/D ActionPopover.
 *
 * Extracted verbatim from `SenderCard`'s `CardActionRow` (2026-07-03
 * consistency pass) so the table row can render the SAME action
 * grammar instead of its former three hardcoded inline buttons —
 * ActionPopover's own docstring listed the table as a consumer, but
 * the wiring never landed with Slice 1. Layout is the only per-surface
 * variance (`stretch` — card stretches the primary button, the table
 * keeps it inline-width).
 *
 * Every pick emits through `onAction`; this component never mutates.
 * Destructive picks (Archive / Unsubscribe / Later / Delete) ride the
 * caller's D226 preview; Keep is non-destructive and the caller
 * applies it immediately per D40 — no preview by design.
 */

import { useState } from 'react';
import { ActionPopover, ActionPopoverTrigger, Button } from '@declutrmail/shared';
import { deriveDefaultPrimary, type VerbId } from '@declutrmail/shared/actions';
import {
  canArchive,
  canDelete,
  canLater,
  canUnsubscribe,
  type ActionRequest,
  type ActionVerb,
  type Sender,
} from './data';
import { intentOf, type SenderIntent } from './uplift-d/intent';

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

/**
 * Lead-verb map keyed by intent (ADR-0016 §B3 — `intentOf` retains the
 * semantic role of deriving the primary CTA per row/card). Chrome tones
 * stay out of it — intent drives the verb, never the chrome.
 */
const LEAD_VERB_BY_INTENT: Record<SenderIntent, 'Unsubscribe' | 'Later' | 'Keep' | 'Archive'> = {
  cleanup: 'Unsubscribe',
  later: 'Later',
  protect: 'Keep',
  people: 'Keep',
};

/**
 * Fact-rule primary derivation (ADR-0019) for a row's lead CTA.
 *
 * `unsub_ready` = the wire List-Unsubscribe method is `'one_click'`
 * (mailto stays manual at launch per D230, so it never auto-recommends)
 * AND the sender passes `canUnsubscribe` — the same capability gate the
 * ⋯ popover reads, so the primary can never offer a verb the popover
 * disables on the same row (e.g. a one-click sender in group 'primary').
 *
 * Registry rule order guarantees protected → Keep wins over unsub-ready
 * (`deriveDefaultPrimary` checks `protected` first — D42/D43).
 *
 * Falls back to the legacy `intentOf` lead verb when neither rule's
 * antecedent fires — preserves continuity until Phase 2 PR-FE2 lands
 * the fact-first cut.
 */
export function derivePrimaryVerbId(sender: Sender): VerbId {
  const factPrimary = deriveDefaultPrimary({
    protected: sender.protected === true || sender.isVip === true,
    unsubReady: sender.unsubscribeMethod === 'one_click' && canUnsubscribe(sender),
    lastSeenDays: sender.lastDays,
  });
  return factPrimary === 'keep'
    ? mapLegacyVerb(LEAD_VERB_BY_INTENT[intentOf(sender)])
    : factPrimary;
}

export function SenderActionRow({
  sender,
  onAction,
  stretch = false,
}: {
  sender: Sender;
  onAction: (req: ActionRequest) => void;
  /** `true` (card) stretches the primary button; `false` (table row) keeps it inline. */
  stretch?: boolean;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  const primaryVerbId: VerbId = derivePrimaryVerbId(sender);

  // Capability gates — the same predicates every action surface reads
  // (data.ts). Delete follows `canDelete` (blocked for standing-
  // protected senders) — the card previously hardcoded `delete: true`,
  // which let the popover offer Delete on protected rows.
  const capabilities: Record<VerbId, boolean> = {
    archive: canArchive(sender),
    later: canLater(sender),
    unsubscribe: canUnsubscribe(sender),
    keep: true,
    delete: canDelete(sender),
  };

  const primaryLegacy = legacyVerbFromId(primaryVerbId);

  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        ...(stretch ? { marginTop: 'auto' } : {}),
        position: 'relative',
      }}
    >
      <Button
        tone={leadButtonTone(primaryLegacy)}
        size="sm"
        onClick={() => onAction({ verb: primaryLegacy, senders: [sender] })}
        iconRight={ARROW}
        style={
          stretch
            ? { flex: 1, justifyContent: 'space-between', minWidth: 0 }
            : { whiteSpace: 'nowrap' }
        }
      >
        {primaryLegacy}
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
              // Close on pick — the popover's contract ("self-closes on
              // pick") only auto-fires on the keyboard-shortcut path;
              // the click path leaves closing to the consumer.
              setPopoverOpen(false);
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
 * 'later' / 'keep' / 'archive' / 'delete').
 */
export function mapLegacyVerb(verb: 'Unsubscribe' | 'Later' | 'Keep' | 'Archive'): VerbId {
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
export function legacyVerbFromId(
  id: VerbId,
): Extract<ActionVerb, 'Unsubscribe' | 'Later' | 'Keep' | 'Archive' | 'Delete'> {
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

/**
 * Lead-button tone derivation for the primary CTA. Tone semantics
 * locked by ADR-0016 A5 (consolidating D26/D31) + ADR-0019: Keep =
 * teal `primary`; Archive = `dark`; Unsubscribe = amber `warn`;
 * Later = neutral `default`; Delete = `danger`. Delete is overflow-
 * only today (`canBePrimary: false` in the registry) but stays mapped
 * so no future call site can collide it with Unsubscribe's amber.
 */
export function leadButtonTone(
  verb: 'Unsubscribe' | 'Later' | 'Keep' | 'Archive' | 'Delete',
): 'warn' | 'dark' | 'default' | 'primary' | 'danger' {
  if (verb === 'Unsubscribe') return 'warn';
  if (verb === 'Delete') return 'danger';
  if (verb === 'Keep') return 'primary';
  if (verb === 'Archive') return 'dark';
  return 'default';
}
