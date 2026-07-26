'use client';

import { Button, Kbd, tokens } from '@declutrmail/shared';
import {
  canArchive,
  canDelete,
  canLater,
  canUnsubscribe,
  type ActionRequest,
  type ActionVerb,
  type Sender,
} from '../data';
import { derivePrimaryVerbId } from '../action-row';
import type { Verdict } from './types';

const { color, font, radius } = tokens;

/**
 * The canonical verb set — K/A/U/L/D (CLAUDE.md §2.2, ADR-0019).
 *
 * Delete was absent here until 2026-07-26. D40's 2026-05-18 patch
 * enumerated this toolbar as K/A/U/L, but ADR-0019 postdates it and adds
 * Delete as canonical, and CLAUDE.md §3 ranks §2 above D-decisions —
 * ruled stale by the founder. The gap was user-visible in the worst way:
 * `triage/why-no-delete.tsx` renders under every triage queue telling
 * users "deleting a sender's mail lives on Senders and Sender Detail",
 * and it did not live here. Because this toolbar is the only producer of
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
        Preview before anything changes
      </span>
    </div>
  );
}
