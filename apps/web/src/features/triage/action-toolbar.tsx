'use client';

import { useEffect } from 'react';
import { Button, Kbd, tokens } from '@declutrmail/shared';
import { canArchive, canLater, canUnsubscribe, type TriageDecisionRow } from './data';
import { VERB_ORDER, VERB_SHORTCUT, verdictToVerb, type ActionVerb } from './types';

const { color, font, radius } = tokens;

/**
 * Pure key→verb resolver — exported so tests assert the K/A/U/L
 * bindings without rendering. Returns the verb to dispatch, or `null`
 * for any key that isn't a K/A/U/L shortcut.
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
 * Triage action toolbar (D29 — K/A/U/L per D227 patch).
 *
 * The toolbar always renders exactly the four canonical verbs. A
 * verb is `disabled` when the row's capability gate (canArchive /
 * canUnsubscribe / canLater) returns false — the protected-Keep
 * rows render Archive / Unsubscribe / Later as visibly inert so the
 * shape of the toolbar is constant across the queue (D29 spec).
 *
 * D31 — the engine's verdict is highlighted ONLY when `confidence`
 * is strictly greater than 0.85. Below that threshold the toolbar
 * renders flat — the founder explicitly does not want a "soft"
 * recommendation to pull the eye.
 *
 * Keyboard: K/A/U/L bind globally while a row is focused. The
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
   * True disables ALL four verbs regardless of the per-verb
   * capability gates — used while the row's decision is confirming
   * server-side (D226 busy state).
   */
  disabled?: boolean;
}) {
  // Only emphasise when confidence is strictly > 0.85 (D31). The
  // ≥ vs > distinction matters: 0.85 exactly should NOT highlight
  // per the founder's read of D31 ("highlight only when confidence
  // > 0.85").
  const recommendedVerb: ActionVerb | null =
    row.confidence > 0.85 ? verdictToVerb(row.verdict) : null;

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
        const isHighlighted = recommendedVerb === verb && !verbIsDisabled;
        const tone = isHighlighted
          ? verb === 'Unsubscribe'
            ? 'warn'
            : verb === 'Keep'
              ? 'primary'
              : 'dark'
          : 'default';
        return (
          <Button
            key={verb}
            tone={tone}
            size="md"
            disabled={verbIsDisabled}
            onClick={() => onAction(verb)}
            iconRight={
              isHighlighted ? (
                <Kbd
                  style={{
                    background: 'rgba(255,255,255,0.16)',
                    border: 'none',
                    color: '#FFFFFF',
                  }}
                >
                  {VERB_SHORTCUT[verb]}
                </Kbd>
              ) : (
                <Kbd>{VERB_SHORTCUT[verb]}</Kbd>
              )
            }
            ariaLabel={`${verb} (${VERB_SHORTCUT[verb]})`}
          >
            {verb}
          </Button>
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
    </div>
  );
}

/** Capability gate per verb — Keep is always enabled. */
function verbDisabled(verb: ActionVerb, row: TriageDecisionRow): boolean {
  if (verb === 'Keep') return false;
  if (verb === 'Archive') return !canArchive(row);
  if (verb === 'Unsubscribe') return !canUnsubscribe(row);
  return !canLater(row); // Later
}
