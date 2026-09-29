'use client';

import { useState } from 'react';
import { Button, tokens } from '@declutrmail/shared';
import { ApiError } from '@/lib/api/client';
import { useUserTimeZone } from '@/features/auth/api/use-me';
import {
  useAccountDeletionStatus,
  useCancelAccountDeletion,
  useRequestAccountDeletion,
} from './api/use-account-deletion';
import { SettingsRow, SettingsRowStatus } from '@/features/settings/settings-list';
import { DeleteAccountModal, formatDate } from './delete-account-modal';

const { color, font, text } = tokens;

/**
 * Settings → Account · "Delete account and data" section (D216).
 *
 * Renders as rows inside Settings' Account group. Owns the full client flow:
 * status display → typed-confirm modal → cancel.
 *
 * States: loading · error (+retry) · none · pending (flat-grace /
 * undo-window / waived-immediate) · executing.
 */
export function AccountDeletionSection() {
  const status = useAccountDeletionStatus();
  const request = useRequestAccountDeletion();
  const cancel = useCancelAccountDeletion();
  const [modalOpen, setModalOpen] = useState(false);

  const submitError = request.error
    ? request.error instanceof ApiError && request.error.status === 400
      ? 'The confirmation phrase did not match. Type it exactly to continue.'
      : 'Could not submit the deletion request. Please try again.'
    : null;

  return (
    <>
      {status.isPending ? (
        <SettingsRowStatus
          state={{ kind: 'loading' }}
          loadingLabel="Loading deletion status…"
          errorLabel="Could not load deletion status."
        />
      ) : status.isError ? (
        <SettingsRowStatus
          state={{ kind: 'error', onRetry: () => void status.refetch() }}
          loadingLabel="Loading deletion status…"
          errorLabel="Could not load deletion status."
        />
      ) : status.data.request ? (
        <PendingState
          effectiveAt={status.data.request.effectiveAt}
          basis={status.data.request.basis}
          executing={status.data.request.status === 'executing'}
          onCancel={() => cancel.mutate()}
          isCancelling={cancel.isPending}
          cancelFailed={cancel.isError}
        />
      ) : (
        // The timing and retention disclosure lives in the modal — the
        // decision point. This row only says what is NOT touched.
        <SettingsRow
          label={<h3 style={rowHeadingStyle}>Delete account and data</h3>}
          detail="Your email in Gmail is not deleted."
        >
          <Button tone="danger" size="sm" onClick={() => setModalOpen(true)}>
            Delete account
          </Button>
        </SettingsRow>
      )}

      <DeleteAccountModal
        open={modalOpen}
        projection={status.data?.projection ?? null}
        isSubmitting={request.isPending}
        submitError={submitError}
        onCancel={() => {
          request.reset();
          setModalOpen(false);
        }}
        onConfirm={(confirmPhrase) =>
          request.mutate(
            { confirmPhrase },
            {
              onSuccess: () => setModalOpen(false),
            },
          )
        }
      />
    </>
  );
}

function PendingState({
  effectiveAt,
  basis,
  executing,
  onCancel,
  isCancelling,
  cancelFailed,
}: {
  effectiveAt: string;
  basis: 'flat-grace' | 'undo-window' | 'waived-immediate';
  executing: boolean;
  onCancel: () => void;
  isCancelling: boolean;
  cancelFailed: boolean;
}) {
  const timeZone = useUserTimeZone();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 0',
        borderTop: `1px solid ${color.line}`,
        fontFamily: font.sans,
      }}
    >
      <h3 style={rowHeadingStyle}>Delete account and data</h3>
      <p style={{ fontSize: text.md, color: color.danger, fontWeight: 600, margin: 0 }}>
        {executing
          ? 'Deletion is in progress — your data is being removed.'
          : basis === 'waived-immediate'
            ? 'Deletion requested without the undo wait — your data deletes shortly.'
            : `Deletion scheduled for ${formatDate(effectiveAt, timeZone)}.`}
      </p>
      {!executing && basis === 'undo-window' && (
        <p style={{ fontSize: text.sm, color: color.fgSoft, lineHeight: 1.5, margin: 0 }}>
          Later than 7 days because an undo window is still open. To delete sooner, cancel and
          choose “Delete immediately”.
        </p>
      )}
      {cancelFailed && (
        <p role="alert" style={{ fontSize: text.sm, color: color.danger, margin: 0 }}>
          Could not cancel. Refresh and try again.
        </p>
      )}
      {!executing && (
        <div>
          <Button tone="default" onClick={onCancel} disabled={isCancelling}>
            {isCancelling ? 'Cancelling…' : 'Cancel deletion'}
          </Button>
        </div>
      )}
    </div>
  );
}

const rowHeadingStyle = {
  margin: 0,
  fontSize: text.md,
  fontWeight: 400,
  color: color.fg,
} as const;
