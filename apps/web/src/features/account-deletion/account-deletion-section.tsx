'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button, tokens } from '@declutrmail/shared';
import type { AccountDeletionStatus } from '@declutrmail/shared/contracts';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { ApiError, apiErrorCode } from '@/lib/api/client';
import { useUserTimeZone } from '@/features/auth/api/use-me';
import {
  useAccountDeletionStatus,
  useCancelAccountDeletion,
  useRequestAccountDeletion,
} from './api/use-account-deletion';
import { SettingsRow, SettingsRowStatus } from '@/features/settings/settings-list';
import { formatDate } from './date-format';

const DeleteAccountModal = dynamic(
  () => import('./delete-account-modal').then((module) => module.DeleteAccountModal),
  { ssr: false, loading: () => <span role="status">Loading account deletion options…</span> },
);

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
  // The shell can fill this query before this subtree hydrates. Match the
  // server's pending row on the first client render, then show cached status.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const request = useRequestAccountDeletion();
  const cancel = useCancelAccountDeletion();
  const [modalOpen, setModalOpen] = useState(false);

  const submitError = deletionSubmitError(request.error);
  const blockCopy = deletionBlockCopy(status.data?.billingBlockReason, request.error);
  const billingBlocked = blockCopy != null;

  return (
    <>
      {!mounted || status.isPending ? (
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
          billingBlocked={billingBlocked}
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
          <Button
            tone="danger"
            size="sm"
            disabled={billingBlocked}
            onClick={() => setModalOpen(true)}
          >
            Delete account
          </Button>
        </SettingsRow>
      )}

      {blockCopy != null && (
        <p role="alert" style={{ color: color.dangerText, fontSize: text.sm }}>
          <DeletionBlockSentence text={blockCopy} />
          <Button
            size="sm"
            onClick={async () => {
              const refreshed = await status.refetch();
              if (refreshed.isSuccess && refreshed.data.billingBlockReason == null) request.reset();
            }}
          >
            Check again
          </Button>
        </p>
      )}

      {modalOpen && (
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
      )}
    </>
  );
}

function PendingState({
  billingBlocked,
  effectiveAt,
  basis,
  executing,
  onCancel,
  isCancelling,
  cancelFailed,
}: {
  billingBlocked: boolean;
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
      <p style={{ fontSize: text.md, color: color.dangerText, fontWeight: 600, margin: 0 }}>
        {billingBlocked
          ? 'Deletion is waiting for billing to be confirmed stopped.'
          : executing
            ? 'Deletion is in progress — your data is being removed.'
            : basis === 'waived-immediate'
              ? 'Your data will be deleted shortly.'
              : `Deletion scheduled for ${formatDate(effectiveAt, timeZone)}.`}
      </p>
      {!executing && basis === 'undo-window' && (
        <p style={{ fontSize: text.sm, color: color.fgSoft, lineHeight: 1.5, margin: 0 }}>
          Your account is deleted after your last Undo ends. To delete sooner, cancel this and
          choose Delete immediately.
        </p>
      )}
      {cancelFailed && (
        <p role="alert" style={{ fontSize: text.sm, color: color.dangerText, margin: 0 }}>
          Could not cancel. Refresh and try again.
        </p>
      )}
      {!executing && (
        <div>
          <Button tone="default" onClick={onCancel} disabled={isCancelling}>
            {isCancelling ? 'Canceling…' : 'Cancel deletion'}
          </Button>
        </div>
      )}
    </div>
  );
}

const CANCEL_PLAN_FIRST = 'Cancel your plan first, then delete your account.';
const SUPPORT_ADDRESS = 'support@declutrmail.com';

/**
 * The deletion block's sentence, from the status reason when the API sent
 * one. A submit error is the fallback for the same two existing codes.
 */
export function deletionBlockCopy(
  reason: AccountDeletionStatus['billingBlockReason'],
  error: unknown,
): string | null {
  const kind = deletionBlockKind(reason, error);
  switch (kind) {
    case 'subscription':
      return CANCEL_PLAN_FIRST;
    case 'payment':
      return WS2_COPY.simplify.deleteAccount.paymentPending;
    case null:
      return null;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function deletionBlockKind(
  reason: AccountDeletionStatus['billingBlockReason'],
  error: unknown,
): 'subscription' | 'payment' | null {
  switch (reason) {
    case 'subscription':
      return 'subscription';
    case 'checkout':
    case 'verification':
      return 'payment';
    case null:
    case undefined:
      break;
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
  if (apiErrorCode(error) === 'DELETION_BILLING_BLOCKED') return 'subscription';
  if (apiErrorCode(error) === 'DELETION_BILLING_UNVERIFIED') return 'payment';
  return null;
}

function DeletionBlockSentence({ text }: { text: string }) {
  const at = text.indexOf(SUPPORT_ADDRESS);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <a href={`mailto:${SUPPORT_ADDRESS}`} style={{ color: color.primary }}>
        {SUPPORT_ADDRESS}
      </a>
      {text.slice(at + SUPPORT_ADDRESS.length)}
    </>
  );
}

const rowHeadingStyle = {
  margin: 0,
  fontSize: text.md,
  fontWeight: 400,
  color: color.fg,
} as const;

/**
 * The request's error, named by what it proves. `DELETION_ALREADY_PENDING`
 * repeats on every attempt — another tab or device already scheduled the
 * deletion — so "Please try again" was a step that could never work.
 */
export function deletionSubmitError(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.status === 400) {
    return 'The confirmation phrase did not match. Type it exactly to continue.';
  }
  if (apiErrorCode(error) === 'DELETION_BILLING_BLOCKED') {
    return CANCEL_PLAN_FIRST;
  }
  if (apiErrorCode(error) === 'DELETION_BILLING_UNVERIFIED') {
    return WS2_COPY.simplify.deleteAccount.paymentPending;
  }
  if (apiErrorCode(error) === 'DELETION_ALREADY_PENDING') {
    // The registry's own sentence, as a literal: importing `ERROR_CODES`
    // added its whole table (~4 kB gzipped) to the Settings route. A test
    // pins the two equal.
    return 'Account deletion is already scheduled for this account.';
  }
  return 'Couldn’t request deletion. Try again.';
}
