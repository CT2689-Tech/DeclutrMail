'use client';

import { Button, DESTRUCTIVE_ACTIONS_PREVIEW_HINT, Kbd, tokens } from '@declutrmail/shared';
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

const { color, font, radius } = tokens;

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
 * The observed-fact primary verb is highlighted. Recommendation and
 * confidence data never changes action order or emphasis (D245).
 */
export function ActionToolbar({
  sender,
  onAction,
}: {
  sender: Sender;
  onAction: (req: ActionRequest) => void;
}) {
  const highlight = derivePrimaryVerbId(sender);

  return (
    <div
      role="toolbar"
      aria-label="Sender actions"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 14px',
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        flexWrap: 'wrap',
        fontFamily: font.sans,
      }}
    >
      {VERBS.map(({ verb, shortcut, verdict }) => {
        const disabled =
          (verb === 'Archive' && !canArchive(sender)) ||
          (verb === 'Unsubscribe' && !canUnsubscribe(sender)) ||
          (verb === 'Later' && !canLater(sender)) ||
          (verb === 'Delete' && !canDelete(sender));
        const isHighlighted = highlight === verdict && !disabled;
        // QA-sender-detail-20260902-14: Delete has `canBePrimary: false`
        // (verb-registry.ts) — it can never be `isHighlighted`, so it
        // rendered with the exact same `tone='default'` fill as Keep, the
        // safest verb. A colour-only accent (matching the registry's own
        // `tone: 'danger'` for this verb) keeps the toolbar's uniform
        // WEIGHT — no verb dominates as "the suggestion" — while making
        // Delete visually findable before the D226 confirm step, not just
        // after.
        const deleteAccentStyle =
          verb === 'Delete' && !isHighlighted && !disabled
            ? { color: color.danger, borderColor: color.danger }
            : null;
        // QA-sender-detail-20260902-07/-16: the highlighted verb had no
        // stated reason, and the only verb `canUnsubscribe` ever disables
        // — no List-Unsubscribe channel — rendered greyed out with no
        // explanation, though the screen already knows exactly why.
        const buttonTitle =
          verb === 'Unsubscribe' && disabled
            ? "No unsubscribe link in this sender's emails — Archive is the reliable fallback."
            : isHighlighted
              ? primaryVerbReason(sender, verdict)
              : null;
        return (
          <Button
            key={verb}
            tone={
              isHighlighted
                ? verb === 'Unsubscribe'
                  ? 'warn'
                  : verb === 'Keep'
                    ? 'primary'
                    : 'dark'
                : 'default'
            }
            size="md"
            disabled={disabled}
            {...(deleteAccentStyle ? { style: deleteAccentStyle } : {})}
            {...(buttonTitle ? { title: buttonTitle } : {})}
            onClick={() => onAction({ verb, senders: [sender] })}
            iconRight={
              isHighlighted ? (
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
              )
            }
            ariaLabel={`${verb} (${shortcut})`}
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
        {DESTRUCTIVE_ACTIONS_PREVIEW_HINT}
      </span>
    </div>
  );
}
