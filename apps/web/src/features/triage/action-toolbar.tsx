'use client';

import { useEffect } from 'react';
import { Button, Kbd, Tooltip, tokens } from '@declutrmail/shared';
import { unsubscribeUnavailableReason } from '@declutrmail/shared/actions';
import { lessonForVerb } from '@/features/tour/verb-lessons';
import { canArchive, canLater, canUnsubscribe, type TriageDecisionRow } from './data';
import { VERB_ORDER, VERB_SHORTCUT, recommendedVerb, type ActionVerb } from './types';

const { color, font, radius } = tokens;

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
}) {
  // Same verdict-aware gate the row's verdict pill reads
  // (`types.ts`). It was a flat `> 0.85` duplicated in both files,
  // which made Archive — whose reachable band tops out at 0.74 without
  // manual-archive history — permanently unhighlightable here too.
  const recommended = recommendedVerb(row.verdict, row.confidence);

  // No-channel reason, surfaced as visible text below the verbs (W2).
  // Protection affects recommendations and automatic/bulk cleanup, not
  // the explicit row actions, so it must not hide this capability fact.
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
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        flexWrap: 'wrap',
        fontFamily: font.sans,
      }}
    >
      {VERB_ORDER.map((verb) => {
        const verbIsDisabled = disabled || verbDisabled(verb, row);
        // Why this verb is inert (W2 — a disabled pill with no reason
        // is a dead end; the audit caught "Unsubscribe · 95%
        // RECOMMENDED" beside a disabled U pill). Gate reasons only —
        // the transient busy state already announces via the row's
        // SR status line.
        const reason = verbDisabledReason(verb, row);
        const isHighlighted = recommended === verb && !verbIsDisabled;
        const tone = isHighlighted
          ? verb === 'Unsubscribe'
            ? 'warn'
            : verb === 'Keep'
              ? 'primary'
              : 'dark'
          : verb === 'Delete'
            ? 'danger'
            : 'default';
        // D38 — what this verb does to the sender's mail, on hover AND
        // on focus. The button's aria-label already carries the verb and
        // its shortcut; the tooltip is the DESCRIPTION, wired through
        // `aria-describedby` so it is announced rather than seen only.
        const lesson = lessonForVerb(verb);
        const button = (describedBy?: string) => (
          <Button
            tone={tone}
            size="md"
            disabled={verbIsDisabled}
            onClick={() => onAction(verb)}
            {...(reason != null ? { title: reason } : {})}
            {...(describedBy != null ? { ariaDescribedBy: describedBy } : {})}
            iconRight={
              isHighlighted ? (
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
                <Kbd>{VERB_SHORTCUT[verb]}</Kbd>
              )
            }
            ariaLabel={
              reason != null
                ? `${verb} (${VERB_SHORTCUT[verb]}) — ${reason}`
                : `${verb} (${VERB_SHORTCUT[verb]})`
            }
          >
            {verb}
          </Button>
        );
        if (lesson === undefined) return <span key={verb}>{button()}</span>;
        return (
          <Tooltip
            key={verb}
            content={
              <>
                <span style={{ fontWeight: 600 }}>{lesson.label}</span>
                <span style={{ fontFamily: font.mono }}> · {lesson.shortcut}</span>
                <br />
                {lesson.effect}
              </>
            }
          >
            {({ describedBy }) => button(describedBy)}
          </Tooltip>
        );
      })}
      <span style={{ flex: 1 }} />
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 10.5,
          color: color.fgMuted,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        Preview before anything changes
      </span>
      {/* Visible reason when Unsubscribe is gated off for lack of a
          channel — the title attr alone is hover-only and disabled
          buttons drop out of the tab order, so the reason must also
          exist as plain text (W2). */}
      {unsubNoChannelReason != null && (
        <span
          role="note"
          style={{
            width: '100%',
            fontSize: 11.5,
            color: color.fgSoft,
            lineHeight: 1.5,
          }}
        >
          {unsubNoChannelReason}
        </span>
      )}
    </div>
  );
}

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
