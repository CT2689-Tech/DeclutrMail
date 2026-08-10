'use client';

import { Button, tokens, toast } from '@declutrmail/shared';
import { normalizeProtectionReason } from '@declutrmail/shared/copy';

import {
  useSetSenderPolicy,
  type UnprotectTelemetry,
} from '@/features/senders/api/use-sender-policy';
import { captureFeatureException } from '@/lib/sentry';
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
  surface,
  showUnprotect = true,
  onUnprotected,
}: {
  row: TriageDecisionRow;
  /** The verb being previewed; `null` on surfaces with no pending verb. */
  verb: SheetableVerb | null;
  /** Where an Unprotect from here would be coming from (D159 telemetry). */
  surface: UnprotectTelemetry['surface'];
  /**
   * Render the Unprotect control alongside the notice.
   *
   * Off where the surface ALREADY offers one — the D245 review's row
   * strip does, and with D34's remember-preference set the inline
   * preview would otherwise stack a second identical button, with two
   * overlapping sentences, on the same card.
   */
  showUnprotect?: boolean;
  /**
   * Fired after the server confirms the Unprotect.
   *
   * Load-bearing on the sheet: the mutation invalidates the triage
   * queue, the refetch drops this now-unprotected sender from the
   * review, and the sheet's row resolves to `null` — which unmounts the
   * modal mid-flow while the pending action survives in the store. The
   * caller uses this to close the pending action deliberately instead.
   */
  onUnprotected?: (() => void) | undefined;
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
      {showUnprotect && (
        <UnprotectButton row={row} surface={surface} onUnprotected={onUnprotected} />
      )}
    </div>
  );
}

/**
 * The D245 manual Unprotect — a standing-policy write, not a mail
 * action. No preview and no undo token because nothing moves; the
 * button states the one thing that is NOT freely reversible, which is
 * that automatic protection will not put the shield back.
 *
 * Kept deliberately quiet in tone (`default`, small): on a row the
 * user may well want to keep protected, an eye-catching Unprotect
 * would be a nudge, and D245's whole posture is that protection is
 * the user's call.
 */
export function UnprotectButton({
  row,
  surface,
  onUnprotected,
}: {
  row: TriageDecisionRow;
  /** Where this Unprotect happens (D159 — the threshold feedback loop). */
  surface: UnprotectTelemetry['surface'];
  /** Fired after the server confirms — the caller may advance its own state. */
  onUnprotected?: (() => void) | undefined;
}) {
  const setPolicy = useSetSenderPolicy();

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Button
        tone="default"
        size="sm"
        disabled={setPolicy.isPending}
        onClick={() =>
          setPolicy.mutate(
            {
              senderId: row.senderId,
              patch: { isProtected: false },
              unprotect: { surface, reason: normalizeProtectionReason(row.protectionReason) },
            },
            {
              onSuccess: () => {
                toast(`${row.senderName} is no longer Protected.`, 'success');
                onUnprotected?.();
              },
              onError: (err) => {
                captureFeatureException(err, { surface: 'triage', reason: 'unprotect' });
                toast("Couldn't remove protection — try again.", 'warn');
              },
            },
          )
        }
      >
        {setPolicy.isPending ? 'Removing protection…' : 'Unprotect'}
      </Button>
      <span style={{ fontSize: 11.5, color: color.fgMuted, lineHeight: 1.4 }}>
        Nothing moves. Automatic protection won&rsquo;t re-apply — you can protect this sender again
        by hand.
      </span>
    </span>
  );
}
