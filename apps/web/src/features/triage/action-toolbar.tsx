'use client';

import { useEffect } from 'react';
import { Button, Kbd, Tooltip, tokens } from '@declutrmail/shared';
import { unsubscribeUnavailableReason } from '@declutrmail/shared/actions';
import { lessonForVerb } from '@/features/tour/verb-lessons';
import { canArchive, canLater, canUnsubscribe, type TriageDecisionRow } from './data';
import { VERB_ORDER, VERB_SHORTCUT, recommendedVerb, type ActionVerb } from './types';

const { color, font, text } = tokens;

/**
 * Pure key→verb resolver — exported so tests assert the K/A/U/L/D
 * bindings without rendering. Returns the verb to dispatch, or `null`
 * for any key that isn't a registered shortcut.
 *
 * Modifier keys (Cmd/Ctrl/Alt/Meta) suppress the binding so the
 * shortcuts never collide with browser/system chords.
 */
export function resolveShortcut(event: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): ActionVerb | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const upper = event.key.toUpperCase();
  for (const verb of VERB_ORDER) {
    if (VERB_SHORTCUT[verb] === upper) return verb;
  }
  return null;
}

/**
 * Triage action toolbar (D29 — K/A/U/L/D per amended D227).
 *
 * The toolbar always renders the five canonical verbs. A verb is
 * `disabled` only when the row's capability gate fails (currently a
 * missing unsubscribe channel) or while an action is in flight.
 * Protected rows still allow explicit actions; protection controls
 * their recommendation and automatic/bulk eligibility.
 *
 * D31 — the engine's verdict is highlighted ONLY when `confidence`
 * clears that VERDICT's floor (`RECOMMEND_FLOOR` in `types.ts`).
 * Below it the toolbar renders flat — the founder explicitly does not
 * want a "soft" recommendation to pull the eye.
 *
 * Keyboard: K/A/U/L/D bind globally while a row is focused. The
 * effect cleans up on unmount so navigating away from the screen
 * does not leak listeners.
 */
export function ActionToolbar({
  row,
  onAction,
  keyboardEnabled = true,
  disabled = false,
  layout = 'row',
  size = 'md',
  align = 'center',
}: {
  row: TriageDecisionRow;
  onAction: (verb: ActionVerb) => void;
  /**
   * False suppresses the global key listener — used when the
   * action sheet is open (the sheet owns Enter/Escape). Defaults
   * to true.
   */
  keyboardEnabled?: boolean;
  /**
   * True disables all five verbs regardless of the per-verb
   * capability gates — used while the row's decision is confirming
   * server-side (D226 busy state).
   */
  disabled?: boolean;
  /**
   * `'bar'` is the touch layout: 44px targets, the suggested verb on its
   * own full-width line, no key hints (there is no keyboard to press).
   */
  layout?: 'row' | 'bar';
  /** `lg` is the focus card's row of 44px capsules; list rows stay `md`. */
  size?: 'md' | 'lg';
  /** Row layout only — the list row lines its verbs up under the name. */
  align?: 'center' | 'start';
}) {
  const bar = layout === 'bar';
  // Same verdict-aware gate the row's verdict pill reads
  // (`types.ts`). It was a flat `> 0.85` duplicated in both files,
  // which made Archive — whose reachable band tops out at 0.74 without
  // manual-archive history — permanently unhighlightable here too.
  const recommended = recommendedVerb(row.verdict, row.confidence);

  // The no-channel reason. Pointer devices read it in the verb's tooltip;
  // touch has no hover, so at ≤900px or `(hover: none)` it ALSO renders
  // as one muted line under the verbs (CSS only — no hydration flip).
  const unsubNoChannelReason = verbDisabledReason('Unsubscribe', row);

  useEffect(() => {
    if (!keyboardEnabled || disabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing in inputs / textareas / contentEditable.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      const verb = resolveShortcut(e);
      if (verb == null) return;
      if (verbDisabled(verb, row)) return;
      e.preventDefault();
      onAction(verb);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardEnabled, disabled, row, onAction]);

  return (
    <div
      role="toolbar"
      aria-label={`Decide on ${row.senderName}`}
      style={{
        // Bar: a two-column grid — five labelled 44px targets do not fit
        // one 375px row ("Unsubscribe" alone is ~115px).
        ...(bar
          ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }
          : {
              display: 'flex',
              alignItems: 'center',
              justifyContent: align === 'start' ? 'flex-start' : 'center',
              flexWrap: 'wrap',
            }),
        gap: 8,
        fontFamily: font.sans,
      }}
    >
      {VERB_ORDER.map((verb) => {
        // Why this verb is unavailable (W2 — a disabled pill with no
        // reason is a dead end). Gate reasons only — the transient busy
        // state already announces via the row's SR status line.
        const reason = verbDisabledReason(verb, row);
        const gated = verbDisabled(verb, row);
        const isHighlighted = recommended === verb && !disabled && !gated;
        // The suggestion is the only filled button; every other verb is
        // a quiet neutral capsule so the eye lands on one thing. Delete
        // keeps danger lettering — a colour, not a fill.
        const tone = isHighlighted ? (verb === 'Unsubscribe' ? 'warn' : 'primary') : 'default';
        // D38 — what this verb does to the sender's mail, on hover AND
        // on focus. A GATED verb's tooltip is its reason instead: it
        // stays focusable (`inert`, not native `disabled`) so hover,
        // focus and `aria-describedby` all reach it — the reason used
        // to be a permanent grey sentence under the row.
        const lesson = lessonForVerb(verb);
        const button = (describedBy?: string) => (
          <Button
            tone={tone}
            size={bar ? 'lg' : size}
            disabled={disabled}
            inert={!disabled && gated}
            onClick={() => onAction(verb)}
            style={{
              ...(bar ? { width: '100%' } : null),
              ...(!isHighlighted && verb === 'Delete' ? { color: color.danger } : null),
            }}
            {...(reason != null ? { title: reason } : {})}
            {...(describedBy != null ? { ariaDescribedBy: describedBy } : {})}
            {...(bar
              ? {}
              : {
                  iconRight: isHighlighted ? (
                    <Kbd
                      style={{
                        background: color.lineInverse,
                        border: 'none',
                        color: color.fgInverse,
                      }}
                    >
                      {VERB_SHORTCUT[verb]}
                    </Kbd>
                  ) : (
                    // A card-coloured key on the neutral capsule.
                    <Kbd style={{ background: color.card }}>{VERB_SHORTCUT[verb]}</Kbd>
                  ),
                })}
            ariaLabel={`${verb} (${VERB_SHORTCUT[verb]})`}
          >
            {verb}
          </Button>
        );
        // Column flex so the Tooltip's inline wrapper stretches and the
        // button's `width: 100%` resolves against the slot, not itself.
        const slotStyle = bar
          ? ({
              display: 'flex',
              flexDirection: 'column',
              // The suggestion leads, on its own full-width line.
              ...(isHighlighted ? { gridColumn: '1 / -1', order: -1 } : null),
            } as const)
          : undefined;
        const content =
          reason != null ? (
            reason
          ) : lesson === undefined ? null : (
            <>
              <span style={{ fontWeight: 600 }}>{lesson.label}</span>
              <br />
              {lesson.effect}
            </>
          );
        if (content == null) {
          return (
            <span key={verb} style={slotStyle}>
              {button()}
            </span>
          );
        }
        return (
          <span key={verb} style={slotStyle}>
            <Tooltip content={content}>{({ describedBy }) => button(describedBy)}</Tooltip>
          </span>
        );
      })}
      {unsubNoChannelReason != null && (
        <>
          <style>{REASON_LINE_CSS}</style>
          <span
            role="note"
            className="dm-toolbar-reason"
            style={{
              width: '100%',
              gridColumn: '1 / -1',
              textAlign: align === 'start' && !bar ? 'left' : 'center',
              fontSize: text.sm,
              color: color.fgMuted,
              lineHeight: 1.5,
            }}
          >
            {unsubNoChannelReason}
          </span>
        </>
      )}
    </div>
  );
}

const REASON_LINE_CSS =
  '.dm-toolbar-reason{display:none}@media (max-width:900px),(hover:none){.dm-toolbar-reason{display:block}}';

/** Capability gate per verb — Keep is always enabled. */
function verbDisabled(verb: ActionVerb, row: TriageDecisionRow): boolean {
  if (verb === 'Keep') return false;
  if (verb === 'Delete') return false;
  if (verb === 'Archive') return !canArchive(row);
  if (verb === 'Unsubscribe') return !canUnsubscribe(row);
  return !canLater(row); // Later
}

/**
 * Human-readable reason a verb's capability gate is off, or `null`
 * when the verb is available (W2 — every disabled pill states why).
 * Exported so tests pin the copy alongside the gate truth-table.
 *
 * Copy is descriptive per D209 — states what IS and the reliable
 * alternative, no apology, no jargon.
 */
export function verbDisabledReason(verb: ActionVerb, row: TriageDecisionRow): string | null {
  if (verb === 'Keep') return null;
  if (verb === 'Delete') return null;
  // Protection no longer disables a verb here. D245 excludes Protected
  // senders from BULK and AUTOMATIC actions, not from an explicit click
  // on one row, and this feature's own server contract says every
  // K/A/U/L/D action stays available on a protected row. The protection is
  // surfaced by the row badge and acknowledged in the D226 confirm,
  // which is where the "act anyway" decision belongs.
  // D248 — the reason states which of the four capability states the
  // sender is in. A sender the index has not derived a method for reads
  // as not-yet-checked; saying "no unsubscribe channel found" for it
  // would claim we looked.
  if (verb === 'Unsubscribe') {
    return unsubscribeUnavailableReason(row.unsubscribeMethod);
  }
  return null;
}
