'use client';

import { Button, tokens, toast } from '@declutrmail/shared';
import { normalizeProtectionReason } from '@declutrmail/shared/copy';

import {
  useSetSenderPolicy,
  type UnprotectTelemetry,
} from '@/features/senders/api/use-sender-policy';
import { captureFeatureException } from '@/lib/sentry';
import type { TriageDecisionRow } from './data';

const { color } = tokens;

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
 *
 * Lives in its own module, split out of `protected-notice.tsx`: this is
 * the one piece of that surface that calls the sender-policy mutation,
 * so it is also the one piece that imports the API client
 * (`@/features/senders/api/use-sender-policy`). Every caller — the
 * D245 review's row strip, the D226 sheet/inline preview's notice —
 * constructs this element itself and passes it in as a slot, so a
 * presentational surface that merely SHOWS a Protected row (like the
 * public inbox simulator) never pulls this mutation into its chunk.
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
        Nothing moves. Automatic protection won&rsquo;t re-apply; you can protect this sender by
        hand.
      </span>
    </span>
  );
}
