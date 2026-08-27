'use client';

import { tokens } from '@declutrmail/shared';
import type { ReactNode } from 'react';

import type { TriageDecisionRow } from './data';
import type { SheetableVerb } from './store';

const { color } = tokens;

/**
 * What a Protected sender's protection is doing, said out loud — and
 * the control that changes it.
 *
 * THE TRAP THIS CLOSES. Acting on a Protected sender from a row
 * succeeds and leaves the protection INTACT: `ActionsService` gates
 * only the bulk path, and the single-sender path flags the row without
 * blocking it. So unsubscribing a wrongly-protected sender here feels
 * finished, while every future bulk run and every Autopilot pass keeps
 * silently skipping them. The user is never told.
 *
 * WHY IT IS NOT CLOSED BY ACTING. The obvious fix — bundle protection
 * removal into the mail action and declare it in the preview — is
 * wrong three times over:
 *
 *   1. AMBIGUOUS. Keep on a Protected sender plainly should not
 *      unprotect; Later is arguable at best.
 *   2. UNSAFE. `undo_action_kind` is `archive | unsubscribe | later |
 *      apply-rule | delete` — there is no protection kind, so an undo
 *      restores the mail and structurally CANNOT restore the shield.
 *      The user would undo, watch their mail come back, and never
 *      learn that the protection did not.
 *   3. SEMANTICALLY WRONG. D245 makes a manual Unprotect a STICKY
 *      override that stops automatic protection re-applying. Bundling
 *      it records a user decision the user never made.
 *
 * So the two acts stay separate: the verb decides what happens to
 * mail, this control decides the safety state. Surfacing the
 * consequence is the fix; acting on the user's behalf is how the fix
 * became more dangerous than the bug.
 *
 * Rendered inside the D226 preview on BOTH paths — the modal sheet and
 * the inline preview D34's remember-preference falls back to — because
 * a notice present on only one of them is a notice the user can skip.
 *
 * It says nothing about what the VERB does. An earlier draft opened
 * with a per-verb reach sentence ("Archive moves matching inbox mail
 * now.") and that was a second, hand-rolled description of a verb's
 * reach sitting inches below the canonical one in
 * `ActionPreviewPresentation` — already drifting, since Delete's real
 * copy names Gmail Trash and this one did not. The preview states the
 * reach; this states the consequence the preview cannot know about.
 * `verb` survives only for Unsubscribe, whose consequence genuinely
 * differs: it stops future mail, so what stays shielded is whatever
 * still arrives.
 */
export function ProtectedActionNotice({
  row,
  verb,
  unprotectSlot,
}: {
  row: TriageDecisionRow;
  /** The verb being previewed; `null` on surfaces with no pending verb. */
  verb: SheetableVerb | null;
  /**
   * The Unprotect control, constructed by the caller (see
   * `unprotect-button.tsx`) — this notice stays pure presentation and
   * never imports the sender-policy mutation hook or the API client it
   * needs, so a route that renders a Protected row (like the public
   * inbox simulator) never pulls the authenticated API client into its
   * chunk just because this notice is on the page.
   *
   * `undefined` where the surface ALREADY offers a control elsewhere —
   * the D245 review's row strip does, and with D34's
   * remember-preference set the inline preview would otherwise stack a
   * second identical button, with two overlapping sentences, on the
   * same card.
   */
  unprotectSlot?: ReactNode;
}) {
  if (row.protectionReason === null) return null;

  return (
    <div
      role="status"
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        // The canonical danger family (tokens.css) — an earlier draft
        // hand-rolled rgba(196,46,46,…), a red that exists nowhere in
        // the token system.
        background: color.dangerBg,
        border: `1px solid ${color.dangerBorder}`,
        fontSize: 12,
        lineHeight: 1.5,
        color: color.danger,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'flex-start',
      }}
    >
      <span>
        This sender stays <strong>Protected</strong>, so bulk and automatic cleanup will keep
        skipping {verb === 'Unsubscribe' ? 'whatever still arrives' : 'it'}.
      </span>
      {unprotectSlot}
    </div>
  );
}
