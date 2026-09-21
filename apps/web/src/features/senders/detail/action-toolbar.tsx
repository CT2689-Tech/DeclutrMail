'use client';

import { useEffect, useRef } from 'react';
import { Button, Kbd, tokens } from '@declutrmail/shared';
import {
  canArchive,
  canDelete,
  canLater,
  canUnsubscribe,
  isStandingProtected,
  type ActionRequest,
  type ActionVerb,
  type Sender,
} from '../data';
import { derivePrimaryVerbId } from '../action-row';
import { isTypingTarget } from '../keyboard';
import {
  isRowBusy,
  RowActivityPill,
  RowActivityStatus,
  rowStatusColor,
  rowStatusLabel,
  STATUS_BUTTON_STYLE,
  takesButtonSlot,
  useRowActivity,
} from '../row-activity';
import type { Verdict } from './types';

/**
 * QA-sender-detail-20260902-07: the highlighted verb was a bare visual
 * cue with no label or tooltip explaining why THIS verb, of five, is the
 * fact-derived primary. Mirrors `derivePrimaryVerbId`'s own rule order
 * (`verb-registry.ts`'s `deriveDefaultPrimary`) in plain language — every
 * branch that rule can select gets a stated reason, including the
 * fallback `keep` (Codex adversarial review round 2 caught this branch
 * originally returning `null` — an outdated draft of this comment still
 * claimed that as the design, not a gap).
 */
function primaryVerbReason(sender: Sender, highlight: Verdict): string | null {
  if (highlight === 'keep' && isStandingProtected(sender)) {
    return 'Highlighted because this sender is Protected.';
  }
  if (highlight === 'unsubscribe') {
    return 'Highlighted because this sender offers one-click unsubscribe.';
  }
  if (highlight === 'archive') {
    // Codex adversarial review: "over 6 months" overclaims precision for
    // `deriveDefaultPrimary`'s real threshold (`lastSeenDays > 180`) —
    // 180 days is 5.75-6.3 calendar months depending on which months, so
    // a sender at exactly 181 days could read "over 6 months" while
    // genuinely under six calendar months. State the actual threshold.
    return 'Highlighted because they haven’t emailed you in more than 180 days.';
  }
  // Codex adversarial review: `deriveDefaultPrimary`'s fallback branch
  // (not protected, no one-click unsubscribe, `lastSeenDays <= 180`)
  // lands on `keep` with no distinguishing signal to name — this used to
  // return `null`, leaving a highlighted button with no explanation.
  // "No strong signal yet" is the accurate description of that branch:
  // there genuinely isn't a fact driving the pick, only the absence of
  // the other three.
  if (highlight === 'keep') {
    return 'Highlighted because there’s no strong signal to Archive or Unsubscribe yet.';
  }
  return null;
}

const { color, font } = tokens;

/**
 * The canonical verb set — K/A/U/L/D (CLAUDE.md §2.2, ADR-0019).
 *
 * Delete was absent here until 2026-07-26. D40's 2026-05-18 patch
 * enumerated this toolbar as K/A/U/L, but ADR-0019 postdates it and adds
 * Delete as canonical, and CLAUDE.md §3 ranks §2 above D-decisions —
 * ruled stale by the founder. The gap was user-visible in the worst way:
 * a note under every triage queue told users "deleting a sender's mail
 * lives on Senders and Sender Detail", and it did not live here. (That
 * note is gone: the 2026-08-06 amendment to ADR-0019 put Delete in
 * Triage too, so it described a constraint that no longer exists.) Because this toolbar is the only producer of
 * an ActionRequest on the page, the entire Delete branch below it was
 * unreachable.
 *
 * Delete's destructive tone is carried by the mandatory D226 confirm
 * modal (`isDeleteVerb`, red consequence copy), exactly as it is for
 * Archive and Later — the toolbar itself stays tonally uniform.
 *
 * Protect is not in the toolbar; it lives in the header. The
 * "Always-Keep" button is intentionally absent; Protect already serves
 * that safety intent more clearly.
 */
const VERBS: ReadonlyArray<{ verb: ActionVerb; shortcut: string; verdict: Verdict }> = [
  { verb: 'Keep', shortcut: 'K', verdict: 'keep' },
  { verb: 'Archive', shortcut: 'A', verdict: 'archive' },
  { verb: 'Unsubscribe', shortcut: 'U', verdict: 'unsubscribe' },
  { verb: 'Later', shortcut: 'L', verdict: 'later' },
  { verb: 'Delete', shortcut: 'D', verdict: 'delete' },
] as const;

/**
 * Action toolbar (D39 #3, D40 patched by D227).
 *
 * Clicking Archive / Unsubscribe / Later routes through the existing
 * `onAction` callback — which in `senders-screen.tsx` opens the
 * mandatory `<ConfirmActionModal>` (the action preview per D226).
 * Keep applies immediately and records `sender_policy(policy_type=keep)`.
 *
 * The observed-fact primary verb is the one filled button; the other four
 * are quiet text buttons. Recommendation and confidence data never changes
 * action order or emphasis (D245).
 *
 * `shortcuts` binds K/A/U/L/D to the same `onAction` a click uses and
 * shows the key hints. The full page turns it on; the list's side pane
 * leaves it off — the list owns those keys there — and then shows no
 * hints either, so a key is never advertised where it does nothing.
 */
export function ActionToolbar({
  sender,
  onAction,
  shortcuts = false,
}: {
  sender: Sender;
  onAction: (req: ActionRequest) => void;
  shortcuts?: boolean;
}) {
  const highlight = derivePrimaryVerbId(sender);
  // This sender's own in-flight / finished action (see `row-activity`).
  const activity = useRowActivity(sender.id);
  const busy = isRowBusy(activity);

  // Latest values for the key handler, so the listener binds once.
  const live = useRef({ sender, onAction, busy });
  live.current = { sender, onAction, busy };
  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      // Inert while the preview (or any other modal / menu) is open —
      // same guards as the Senders list's selection shortcuts.
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')) return;
      const entry = VERBS.find((v) => v.shortcut.toLowerCase() === e.key.toLowerCase());
      if (!entry) return;
      const { sender: s, onAction: act, busy: isBusy } = live.current;
      if (isBusy || isVerbUnavailable(entry.verb, s)) return;
      e.preventDefault();
      act({ verb: entry.verb, senders: [s] });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts]);

  return (
    <div
      role="toolbar"
      aria-label="Sender actions"
      aria-busy={busy || undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexWrap: 'wrap',
        fontFamily: font.sans,
      }}
    >
      {VERBS.map(({ verb, shortcut, verdict }) => {
        const disabled = isVerbUnavailable(verb, sender);
        const isHighlighted = highlight === verdict && !disabled;
        // QA-sender-detail-20260902-14: Delete has `canBePrimary: false`
        // (verb-registry.ts) — it can never be `isHighlighted`, so it
        // rendered with the exact same `tone='default'` fill as Keep, the
        // safest verb. A colour-only accent (matching the registry's own
        // `tone: 'danger'` for this verb) makes Delete findable before the
        // D226 confirm step, not just after, without adding weight.
        const deleteAccentStyle =
          verb === 'Delete' && !isHighlighted && !disabled ? { color: color.danger } : null;
        // QA-sender-detail-20260902-07/-16: the highlighted verb had no
        // stated reason, and the only verb `canUnsubscribe` ever disables
        // — no List-Unsubscribe channel — rendered greyed out with no
        // explanation, though the screen already knows exactly why.
        const buttonTitle =
          verb === 'Unsubscribe' && disabled
            ? "No unsubscribe link in this sender's emails — Archive still works."
            : isHighlighted
              ? primaryVerbReason(sender, verdict)
              : null;
        // The verb that was pressed BECOMES its own status — same grammar as
        // a Senders row. Same element, so focus stays on it.
        // Not when it ended badly — then the verb stays live for a retry.
        const status =
          activity && takesButtonSlot(activity) && activity.verb === verb.toLowerCase()
            ? activity
            : null;
        // This page has no ⋯ menu, so a verb that reads "done" must still work.
        const again = status?.phase === 'done';
        return (
          <Button
            key={verb}
            tone={
              status
                ? 'ghost'
                : isHighlighted
                  ? verb === 'Unsubscribe'
                    ? 'warn'
                    : verb === 'Keep'
                      ? 'primary'
                      : 'dark'
                  : 'ghost'
            }
            size="md"
            disabled={disabled}
            // Inert, not disabled: the verb just pressed may hold focus.
            inert={busy && !disabled}
            {...(status
              ? {
                  style: {
                    ...STATUS_BUTTON_STYLE,
                    color: rowStatusColor(status),
                    ...(again ? { cursor: 'pointer' } : {}),
                  },
                }
              : deleteAccentStyle
                ? { style: deleteAccentStyle }
                : {})}
            {...(buttonTitle ? { title: buttonTitle } : {})}
            onClick={() => onAction({ verb, senders: [sender] })}
            {...(status || !shortcuts
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
                      {shortcut}
                    </Kbd>
                  ) : (
                    <Kbd>{shortcut}</Kbd>
                  ),
                })}
            ariaLabel={
              status
                ? again
                  ? `${rowStatusLabel(status)} — ${verb} again${shortcuts ? ` (${shortcut})` : ''}`
                  : rowStatusLabel(status)
                : shortcuts
                  ? `${verb} (${shortcut})`
                  : verb
            }
          >
            {status ? <RowActivityStatus activity={status} /> : verb}
          </Button>
        );
      })}
      {activity && !takesButtonSlot(activity) && <RowActivityPill activity={activity} />}
    </div>
  );
}

function isVerbUnavailable(verb: ActionVerb, sender: Sender): boolean {
  return (
    (verb === 'Archive' && !canArchive(sender)) ||
    (verb === 'Unsubscribe' && !canUnsubscribe(sender)) ||
    (verb === 'Later' && !canLater(sender)) ||
    (verb === 'Delete' && !canDelete(sender))
  );
}
