'use client';

import { Button, Kbd, tokens } from '@declutrmail/shared';
import {
  canArchive,
  canLater,
  canUnsubscribe,
  type ActionRequest,
  type ActionVerb,
  type Sender,
} from '../data';
import type { Recommendation, Verdict } from './types';

const { color, font, radius } = tokens;

/**
 * D40 verb set (post D227 reverbing).
 *
 * The action toolbar contains exactly the 4 canonical user-facing
 * verbs: Keep / Archive / Unsubscribe / Later — K/A/U/L. VIP and
 * Protect are NOT in the toolbar; they live in the header (D43).
 *
 * The "Always-Keep" button is intentionally absent (D40) — VIP and
 * Protect already serve that intent more clearly.
 */
const VERBS: ReadonlyArray<{ verb: ActionVerb; shortcut: string; verdict: Verdict }> = [
  { verb: 'Keep', shortcut: 'K', verdict: 'keep' },
  { verb: 'Archive', shortcut: 'A', verdict: 'archive' },
  { verb: 'Unsubscribe', shortcut: 'U', verdict: 'unsubscribe' },
  { verb: 'Later', shortcut: 'L', verdict: 'later' },
] as const;

/**
 * Action toolbar (D39 #3, D40 patched by D227).
 *
 * Clicking Archive / Unsubscribe / Later routes through the existing
 * `onAction` callback — which in `senders-screen.tsx` opens the
 * mandatory `<ConfirmActionModal>` (the action preview per D226).
 * Keep applies immediately and records `sender_policy(policy_type=keep)`.
 *
 * The recommended verb is highlighted via D31 — confidence ≥0.85
 * elevates the corresponding button to the `dark` tone.
 */
export function ActionToolbar({
  sender,
  recommendation,
  onAction,
}: {
  sender: Sender;
  recommendation: Recommendation | null;
  onAction: (req: ActionRequest) => void;
}) {
  const highlight: Verdict | null =
    recommendation != null && recommendation.confidence >= 0.85 ? recommendation.verdict : null;

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
          (verb === 'Later' && !canLater(sender));
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
