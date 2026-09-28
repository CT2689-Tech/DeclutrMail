'use client';

import { useEffect, useState } from 'react';

import { Button, TechnicalDetails, tokens } from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';

import { apiErrorCode } from '@/lib/api/client';
import { technicalErrorDetails } from '@/lib/action-error-copy';
import type { ActivityRowWire } from '@/lib/api/activity';
import type { ActionRecoveryPreviewResult } from '@/lib/api/actions';

import { numeralStyle } from './activity-filter-fields';

/**
 * The failed-action recovery review dialog. Its own module so the screen
 * can load it on first open (`next/dynamic`) instead of shipping it in the
 * /activity first-load bundle.
 */

const { color, font, radius, shadow, text } = tokens;

export function ActionRecoveryDialog({
  row,
  preview,
  isStarting,
  startError,
  confirmError,
  isConfirming,
  onRetryVerification,
  onConfirm,
  onReconnect,
  onClose,
}: {
  row: ActivityRowWire;
  preview: ActionRecoveryPreviewResult | undefined;
  isStarting: boolean;
  startError: Error | null;
  confirmError: Error | null;
  isConfirming: boolean;
  onRetryVerification: () => void;
  onConfirm: (wakeAt?: string) => void;
  onReconnect: () => void;
  onClose: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const [wakeAtLocal, setWakeAtLocal] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isConfirming) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isConfirming, onClose]);

  useEffect(() => {
    if (!preview?.requiresNewWakeAt) {
      setWakeAtLocal('');
      return;
    }
    const defaultWake = new Date(Date.now() + 24 * 60 * 60 * 1000);
    setWakeAtLocal(toLocalDateTimeInput(defaultWake));
  }, [preview?.previewId, preview?.requiresNewWakeAt]);

  const wakeAt = wakeAtLocal ? new Date(wakeAtLocal) : null;
  const wakeAtValid =
    !preview?.requiresNewWakeAt ||
    (wakeAt !== null && Number.isFinite(wakeAt.getTime()) && wakeAt.getTime() > Date.now());
  const ready = preview?.status === 'ready';
  const confirmNeedsRecheck = confirmError ? recoveryConfirmNeedsRecheck(confirmError) : false;
  const canConfirm = ready && wakeAtValid && !isConfirming && !confirmNeedsRecheck;

  return (
    <>
      <div
        onClick={onClose}
        className="dm-scrim"
        style={{ position: 'fixed', inset: 0, zIndex: 170 }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-recovery-title"
        data-testid="action-recovery-dialog"
        className="dm-sheet"
        style={{
          position: 'fixed',
          top: '12vh',
          left: 0,
          right: 0,
          margin: '0 auto',
          width: 'min(520px, calc(100vw - 32px))',
          maxHeight: '78vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: radius['2xl'],
          boxShadow: shadow.modal,
          zIndex: 171,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '28px 28px 12px' }}>
          <h2
            id="action-recovery-title"
            style={{
              fontSize: text.xl,
              fontWeight: 650,
              letterSpacing: '-0.02em',
              margin: 0,
              color: color.fg,
            }}
          >
            Review this failed {failedActionNoun(row.action)}
          </h2>
          <p
            style={{ margin: '8px 0 0', color: color.fgSoft, fontSize: text.base, lineHeight: 1.5 }}
          >
            We check Gmail first, so nothing changes until you confirm.
          </p>
        </div>

        <div style={{ padding: '12px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <RecoveryPreviewBody
            preview={preview}
            isStarting={isStarting}
            startError={startError}
            onRetryVerification={onRetryVerification}
            onReconnect={onReconnect}
          />

          {ready && preview && (
            <>
              <RecoveryConsequence preview={preview} />
              {preview.requiresNewWakeAt ? (
                <label
                  style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: text.base }}
                >
                  <span style={{ color: color.fgMuted }}>New return time</span>
                  <input
                    type="datetime-local"
                    value={wakeAtLocal}
                    min={toLocalDateTimeInput(new Date(Date.now() + 60_000))}
                    onChange={(event) => setWakeAtLocal(event.target.value)}
                    style={{
                      border: 'none',
                      borderRadius: radius.md,
                      background: color.fill,
                      color: color.fg,
                      fontFamily: font.sans,
                      fontSize: text.base,
                      minHeight: 40,
                      padding: '0 12px',
                    }}
                  />
                  {!wakeAtValid && (
                    <span role="alert" style={{ color: color.danger, fontSize: text.sm }}>
                      Choose a future return time.
                    </span>
                  )}
                </label>
              ) : preview.verb === 'later' && preview.wakeAt ? (
                <p style={{ margin: 0, color: color.fgMuted, fontSize: text.base }}>
                  Return time: {formatRecoveryDate(preview.wakeAt)}
                </p>
              ) : null}
            </>
          )}

          {confirmError && (
            <div
              role="alert"
              style={{
                borderRadius: radius.lg,
                background: color.dangerBg,
                color: color.danger,
                fontSize: text.base,
                lineHeight: 1.45,
                padding: '12px 14px',
              }}
            >
              {recoveryConfirmErrorMessage(confirmError)}
              {confirmNeedsRecheck && (
                <div style={{ marginTop: 8 }}>
                  <Button tone="default" onClick={onRetryVerification}>
                    Check Gmail again
                  </Button>
                </div>
              )}
              <TechnicalDetails summary="Show support details" style={{ marginTop: 6 }}>
                {technicalErrorDetails(confirmError)}
              </TechnicalDetails>
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '16px 28px 28px',
          }}
        >
          <Button tone="default" onClick={onClose} disabled={isConfirming}>
            Close
          </Button>
          {ready && preview && (
            <Button
              tone="primary"
              onClick={() =>
                onConfirm(preview.requiresNewWakeAt && wakeAt ? wakeAt.toISOString() : undefined)
              }
              disabled={!canConfirm}
            >
              {isConfirming
                ? 'Starting…'
                : preview.outcome === 'already_applied'
                  ? 'Update this record'
                  : 'Try this action again'}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function RecoveryPreviewBody({
  preview,
  isStarting,
  startError,
  onRetryVerification,
  onReconnect,
}: {
  preview: ActionRecoveryPreviewResult | undefined;
  isStarting: boolean;
  startError: Error | null;
  onRetryVerification: () => void;
  onReconnect: () => void;
}) {
  if (startError) {
    return <RecoveryVerificationFailure error={startError} onRetry={onRetryVerification} />;
  }

  if (isStarting || preview?.status === 'verifying') {
    return (
      <div role="status" aria-live="polite" style={{ color: color.fgSoft, fontSize: text.base }}>
        Checking Gmail&apos;s current state…
      </div>
    );
  }

  if (!preview) {
    return <RecoveryVerificationFailure error={null} onRetry={onRetryVerification} />;
  }

  if (preview.status === 'consumed' && preview.outcome === 'no_change_needed') {
    return (
      <div role="status" style={{ color: color.fg, fontSize: text.base, lineHeight: 1.5 }}>
        <strong>Nothing is left to retry.</strong> Gmail no longer has a message this action applies
        to, so nothing new was started.
      </div>
    );
  }

  if (preview.status === 'failed') {
    if (preview.outcome === 'reconnect_required') {
      return (
        <div role="alert" style={{ color: color.amber, fontSize: text.base, lineHeight: 1.5 }}>
          DeclutrMail could not verify Gmail because access needs attention. Reconnect the account,
          wait for its sync to finish, then return to Activity and choose Check and retry.
          <div style={{ marginTop: 10 }}>
            <Button tone="primary" onClick={onReconnect}>
              Reconnect Gmail
            </Button>
          </div>
        </div>
      );
    }
    if (preview.outcome === 'blocked') {
      return (
        <div role="alert" style={{ color: color.amber, fontSize: text.base, lineHeight: 1.5 }}>
          This action cannot be safely retried from Activity. Nothing new was started.
        </div>
      );
    }
    return <RecoveryVerificationFailure error={null} onRetry={onRetryVerification} />;
  }

  if (preview.status === 'consumed') {
    return (
      <div role="status" style={{ color: color.fg, fontSize: text.base }}>
        This review has already been used.
      </div>
    );
  }

  const applied = preview.alreadyAppliedCount;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 10,
      }}
    >
      <RecoveryCount label="Still to do" value={preview.remainingCount} />
      <RecoveryCount label="Already done in Gmail" value={applied} />
      <RecoveryCount label="Gone from Gmail" value={preview.unavailableCount} />
      <RecoveryCount label="Checked" value={preview.targetCount} />
    </div>
  );
}

function RecoveryVerificationFailure({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <div role="alert" style={{ color: color.amber, fontSize: text.base, lineHeight: 1.5 }}>
      We couldn&apos;t check Gmail&apos;s current state.
      <div style={{ marginTop: 10 }}>
        <Button tone="default" onClick={onRetry}>
          Check again
        </Button>
      </div>
      {error && (
        <TechnicalDetails summary="Show support details" style={{ marginTop: 8 }}>
          {technicalErrorDetails(error)}
        </TechnicalDetails>
      )}
    </div>
  );
}

function RecoveryCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ ...numeralStyle, fontSize: text.xl, fontWeight: 600, color: color.fg }}>
        {value}
      </div>
      <div style={{ color: color.fgMuted, fontSize: text.xs }}>{label}</div>
    </div>
  );
}

function RecoveryConsequence({ preview }: { preview: ActionRecoveryPreviewResult }) {
  const actionCopy =
    preview.verb === 'archive'
      ? 'Archive takes these emails out of the Inbox. It does not delete them.'
      : preview.verb === 'delete'
        ? 'Delete moves these emails to Gmail Trash. Gmail Trash recovery remains separate.'
        : 'Later takes these emails out of the Inbox now and returns them at the confirmed time.';
  const outcomeCopy =
    preview.outcome === 'already_applied'
      ? 'Gmail already reflects this action. Confirming updates your Activity and Undo record without a duplicate effect in Gmail.'
      : preview.outcome === 'partial'
        ? 'Gmail reflects only part of the original action. Confirming finishes it for the emails found in Gmail.'
        : 'Gmail does not yet reflect the failed action.';
  return (
    <div
      style={{
        borderLeft: `3px solid ${color.amber}`,
        padding: '2px 12px',
        color: color.fgSoft,
        fontSize: text.base,
        lineHeight: 1.5,
      }}
    >
      <div>{outcomeCopy}</div>
      <div style={{ marginTop: 4 }}>{actionCopy}</div>
      {preview.unavailableCount > 0 && (
        <div style={{ marginTop: 4 }}>
          {preview.unavailableCount} unavailable message
          {preview.unavailableCount === 1 ? '' : 's'} will not be changed.
        </div>
      )}
    </div>
  );
}

function toLocalDateTimeInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatRecoveryDate(iso: string): string {
  const date = new Date(iso);
  // Locale pinned for consistency (post-intent modal copy — never in
  // server HTML); the zone stays the browser's.
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : // An unparseable wire date must not leak the raw ISO string into copy.
      'an unknown time';
}

function recoveryConfirmErrorMessage(error: Error): string {
  const code = apiErrorCode(error);
  if (code === 'RECOVERY_PREVIEW_EXPIRED') {
    return 'This review expired. Check Gmail again before trying the action.';
  }
  if (code === 'LATER_TIMER_SUPERSEDED') {
    return 'This sender already has a newer Later schedule. The failed schedule was not replayed.';
  }
  if (code === 'LATER_WAKE_TIME_REQUIRED') {
    return 'The saved return time has passed. Check Gmail again, then choose a new return time.';
  }
  if (code === 'ACTION_NO_LONGER_FAILED') {
    return 'This action no longer needs recovery. Refresh Activity to see its current state.';
  }
  if (code === 'IDEMPOTENCY_KEY_CONFLICT' || code === 'RECOVERY_ALREADY_REQUESTED') {
    return 'This recovery review was already used. Refresh Activity to see the current attempt.';
  }
  return "We couldn't confirm the retry. Try again — it won't create a duplicate.";
}

function recoveryConfirmNeedsRecheck(error: Error): boolean {
  const code = apiErrorCode(error);
  return code === 'RECOVERY_PREVIEW_EXPIRED' || code === 'LATER_WAKE_TIME_REQUIRED';
}

/**
 * The verb as a noun for "Review this failed …". The result label is a
 * past-tense phrase ("Deleted to Gmail Trash"); lowercasing it into a
 * title produced "Review failed archived" and un-capitalised Gmail.
 */
function failedActionNoun(action: ActivityRowWire['action']): string {
  switch (action) {
    case 'archive':
      return 'Archive';
    case 'later':
      return 'Later';
    case 'delete':
      return 'Delete';
    case 'unsubscribe':
      return 'Unsubscribe';
    default:
      return 'action';
  }
}
