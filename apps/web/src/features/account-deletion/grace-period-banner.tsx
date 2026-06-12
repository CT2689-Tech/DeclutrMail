'use client';

import { useState } from 'react';
import { Button, tokens } from '@declutrmail/shared';
import { useAccountDeletionStatus, useCancelAccountDeletion } from './api/use-account-deletion';
import { formatDate } from './delete-account-modal';

const { color, font } = tokens;

/**
 * D216 step 3 — the grace-period banner: "During grace period → red
 * banner on every page: Account deletion scheduled for {date}. Cancel?"
 *
 * Mounted once in the (app) layout (U-WIRE owns the layout file; the
 * mount snippet ships in the PR body). Renders null when nothing is
 * pending — including while loading and on fetch errors: a chrome
 * banner must never block or noise the app shell, and the Settings →
 * Account section is the surface that reports status-read errors.
 *
 * States:
 *   - pending / flat-grace   → date + Cancel
 *   - pending / undo-window  → date + the undo-window explanation + Cancel
 *   - pending / waived       → "deletes shortly" (no future date worth
 *                              promising; the sweep runs in minutes)
 *   - executing              → cancel is gone (past the point of no
 *                              return); copy says so
 */
export function GracePeriodBanner() {
  const { data } = useAccountDeletionStatus();
  const cancel = useCancelAccountDeletion();
  const [cancelError, setCancelError] = useState<string | null>(null);

  const request = data?.request;
  if (!request) return null;

  const executing = request.status === 'executing';
  const immediate = request.basis === 'waived-immediate';

  return (
    <div
      role="alert"
      data-testid="deletion-grace-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '10px 20px',
        background: color.dangerBg,
        borderBottom: `1px solid ${color.dangerBorder}`,
        fontFamily: font.sans,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: color.danger }}>
          {executing
            ? 'Account deletion is in progress.'
            : immediate
              ? 'Account deletion was requested with the undo waiver — your data deletes shortly.'
              : `Account deletion scheduled for ${formatDate(request.effectiveAt)}.`}
        </span>
        {!executing && request.basis === 'undo-window' && (
          <span style={{ fontSize: 11.5, color: color.fgSoft }}>
            The date extends past the 7-day grace period so your open undo windows keep working
            until they expire.
          </span>
        )}
        {cancelError != null && (
          <span role="alert" style={{ fontSize: 11.5, color: color.danger }}>
            {cancelError}
          </span>
        )}
      </div>
      {!executing && (
        <Button
          tone="default"
          size="sm"
          disabled={cancel.isPending}
          onClick={() => {
            setCancelError(null);
            cancel.mutate(undefined, {
              onError: () =>
                setCancelError('Could not cancel — refresh and try again from Settings.'),
            });
          }}
        >
          {cancel.isPending ? 'Cancelling…' : 'Cancel deletion'}
        </Button>
      )}
    </div>
  );
}
