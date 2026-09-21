'use client';

/**
 * `SenderActionRow` — the ONE per-sender action affordance on the
 * Senders list (ADR-0016 A5 + ADR-0019): a derived primary verb button
 * + the `⋯` trigger opening the K/A/U/L/D ActionPopover.
 *
 * Every pick emits through `onAction`; this component never mutates.
 * Destructive picks (Archive / Unsubscribe / Later / Delete) ride the
 * caller's D226 preview; Keep is non-destructive and the caller
 * applies it immediately per D40 — no preview by design.
 */

import { useState } from 'react';
import { ActionPopover, ActionPopoverTrigger, Button, tokens } from '@declutrmail/shared';
import { deriveDefaultPrimary, type VerbId } from '@declutrmail/shared/actions';
import {
  isRowBusy,
  RowActivityPill,
  RowActivityStatus,
  rowStatusColor,
  STATUS_BUTTON_STYLE,
  takesButtonSlot,
  useRowActivity,
} from './row-activity';
import {
  canArchive,
  canDelete,
  canLater,
  canUnsubscribe,
  isStandingProtected,
  type ActionRequest,
  type ActionVerb,
  type Sender,
} from './data';

const { color } = tokens;

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
 * No recommendation or confidence value participates in this choice.
 * D245 makes observed facts authoritative; an optional suggestion may
 * be disclosed separately but never selects the primary action.
 */
export function derivePrimaryVerbId(sender: Sender): VerbId {
  return deriveDefaultPrimary({
    protected: isStandingProtected(sender),
    // RECOMMENDATION, not availability — the two are deliberately
    // different. `canUnsubscribe` asks "is there a channel to use?"; this
    // asks "should we put it forward?". A Gmail `primary`-category sender
    // with a live one-click header is offerable but not recommendable:
    // primary-category mail is where real correspondence lands, so
    // leading with Unsubscribe there is the wrong default. That category
    // term used to live inside `canUnsubscribe`, where it silently greyed
    // the button out with no reason text and no server counterpart.
    unsubReady:
      sender.unsubscribeMethod === 'one_click' &&
      sender.gmailCategory !== 'primary' &&
      canUnsubscribe(sender),
    lastSeenDays: sender.lastDays,
  });
}

export function SenderActionRow({
  sender,
  onAction,
  compact = false,
}: {
  sender: Sender;
  onAction: (req: ActionRequest) => void;
  /**
   * Phone rows: only the `⋯` menu. There is no button slot to carry the
   * status, so the HOST row renders the activity pill beside the name.
   */
  compact?: boolean;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  // One in-flight action per sender: a second would mint a fresh
  // idempotency key (double cleanup unit, two undo tokens). The screen
  // refuses it too; disabling here is what makes that refusal visible.
  const activity = useRowActivity(sender.id);
  const busy = isRowBusy(activity);
  const status = takesButtonSlot(activity) ? activity : undefined;

  const primaryVerbId: VerbId = derivePrimaryVerbId(sender);

  // Capability gates — the same predicates every action surface reads
  // (data.ts). Delete follows `canDelete` (blocked for standing-
  // protected senders).
  const capabilities: Record<VerbId, boolean> = {
    archive: canArchive(sender),
    later: canLater(sender),
    unsubscribe: canUnsubscribe(sender),
    keep: true,
    delete: canDelete(sender),
  };

  const primaryLegacy = legacyVerbFromId(primaryVerbId);
  const senderLabel = sender.name.trim() || sender.domain;

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', position: 'relative' }}>
      {/* Ended badly: say so, and leave the verb live — retrying is the next step. */}
      {activity && !status && !compact && <RowActivityPill activity={activity} />}
      {/* ONE button element for both states: while an action's result is on
          the row, the verb the user reached for BECOMES that result. Kept
          mounted (never swapped for a span) so focus stays put. Once the job
          has ENDED the ⋯ menu is the way to act again; while it is running
          or unconfirmed the whole row stays locked — a second job for the
          same sender is the thing being prevented. */}
      {!compact && (
        <Button
          // Quiet at rest: a list of fifty filled buttons shouts. The verb
          // keeps its colour identity in the lettering; the ONE filled
          // button lives in the detail pane and the confirm sheet.
          tone={status ? 'ghost' : 'default'}
          size="sm"
          inert={status != null}
          onClick={() => onAction({ verb: primaryLegacy, senders: [sender] })}
          style={{
            whiteSpace: 'nowrap',
            minWidth: 96,
            ...(status
              ? { ...STATUS_BUTTON_STYLE, color: rowStatusColor(status) }
              : { color: LEAD_TEXT_COLOR[leadButtonTone(primaryLegacy)] }),
          }}
        >
          {status ? <RowActivityStatus activity={status} /> : primaryLegacy}
        </Button>
      )}
      {/* Trigger opens the popover only — never toggles. Toggle pattern
          races against the popover's click-outside listener (which sees
          the trigger as 'outside' and closes, then the trigger's
          onClick re-opens). Open-only + ESC/click-outside close is the
          standard menu-button affordance (silent-failure-hunter
          2026-06-03 advisory). */}
      <ActionPopoverTrigger
        onClick={() => setPopoverOpen(true)}
        ariaLabel={`More actions for ${senderLabel}`}
        disabled={busy}
      />
      {popoverOpen && !busy && (
        <ActionPopover
          ariaLabel={`Actions for ${senderLabel}`}
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
/** Lettering colour for the quiet row button, keyed by the verb's tone. */
const LEAD_TEXT_COLOR: Record<ReturnType<typeof leadButtonTone>, string> = {
  warn: color.amber,
  danger: color.danger,
  primary: color.primary,
  dark: color.fg,
  default: color.fg,
};

export function leadButtonTone(
  verb: 'Unsubscribe' | 'Later' | 'Keep' | 'Archive' | 'Delete',
): 'warn' | 'dark' | 'default' | 'primary' | 'danger' {
  if (verb === 'Unsubscribe') return 'warn';
  if (verb === 'Delete') return 'danger';
  if (verb === 'Keep') return 'primary';
  if (verb === 'Archive') return 'dark';
  return 'default';
}
