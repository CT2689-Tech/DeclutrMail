'use client';

import { useState } from 'react';
import { Button, Card, tokens } from '@declutrmail/shared';
import { ApiError } from '@/lib/api/client';
import {
  useAccountDeletionStatus,
  useCancelAccountDeletion,
  useRequestAccountDeletion,
} from './api/use-account-deletion';
import { DeleteAccountModal, formatDate } from './delete-account-modal';

const { color, font } = tokens;

/**
 * Settings → Account · "Delete account and data" section (D216).
 *
 * Standalone component — U23 owns `settings/page.tsx` and mounts this
 * (import + render snippet in the PR body). Owns the full client flow:
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
    <Card padding={0}>
      <div style={{ padding: '18px 20px', fontFamily: font.sans }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: color.fg }}>
          Delete account and data
        </h3>

        {status.isPending ? (
          <p style={mutedTextStyle}>Loading deletion status…</p>
        ) : status.isError ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 13, color: color.danger }}>
              Could not load deletion status.
            </span>
            <Button tone="default" size="sm" onClick={() => void status.refetch()}>
              Retry
            </Button>
          </div>
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
          <>
            <p style={mutedTextStyle}>
              Permanently deletes your DeclutrMail account and mailbox product data — including the
              Gmail metadata index, sender decisions, automation rules, and undo history. Emails in
              Gmail are not touched. Narrowly scoped pseudonymous security and deletion evidence
              remains under the operational retention policy. Default: a 7-day grace period (longer
              if an undo window is still open), with a cancel link by email.
            </p>
            <div style={{ marginTop: 12 }}>
              <Button tone="danger" onClick={() => setModalOpen(true)}>
                Delete account and data
              </Button>
            </div>
          </>
        )}
      </div>

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
    </Card>
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
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 13, color: color.danger, fontWeight: 600, margin: 0 }}>
        {executing
          ? 'Deletion is in progress — your data is being removed.'
          : basis === 'waived-immediate'
            ? 'Deletion requested with the undo waiver — your data deletes shortly.'
            : `Deletion scheduled for ${formatDate(effectiveAt)}.`}
      </p>
      {!executing && basis === 'undo-window' && (
        <p style={{ ...mutedTextStyle, marginTop: 0 }}>
          The date extends past the 7-day grace period because an undo window is still open — undo
          keeps working for its full window.
        </p>
      )}
      {cancelFailed && (
        <p role="alert" style={{ fontSize: 12, color: color.danger, margin: 0 }}>
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

const mutedTextStyle = {
  fontSize: 13,
  color: color.fgSoft,
  lineHeight: 1.55,
  margin: '8px 0 0',
};
