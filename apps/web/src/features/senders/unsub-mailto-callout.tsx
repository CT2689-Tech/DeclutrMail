'use client';

// Consumers: senders-screen.tsx, detail/sender-detail-page.tsx,
// features/triage/triage-screen.tsx (D9 Wave 2 PR). Cross-feature per
// ADR-0007's second-consumer rule, but D220's launch allowlist gates
// packages/shared additions — so the single source of truth lives here
// in the senders feature (the surface that owns unsubscribe), and
// triage imports across the feature boundary like it already does for
// `activityKeys`.

import { useEffect, useState } from 'react';
import { tokens, toast } from '@declutrmail/shared';
import type { UnsubscribeLifecycleStatus } from '@declutrmail/shared/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { gmailComposeUrlFromMailto } from '@/lib/gmail-links';
import { useRecordUnsubscribeManualStatus } from '@/lib/api/use-action';
import { activityKeys } from '@/features/activity/api/query-keys';
import { sendersKeys } from './api/query-keys';

const { color, font } = tokens;

/**
 * The D230 manual-unsubscribe affordance. Rendered AFTER an
 * unsubscribe intent records for a `mailto`-method sender: the user —
 * not DeclutrMail — sends the opt-out, because list processors verify
 * the subscribed address (mail from a no-reply would silently fail).
 * The button opens Gmail's compose window prefilled from the sender's
 * `mailto:` List-Unsubscribe URL; the user hits Send.
 *
 * Renders nothing when the mailto URL can't be parsed into a compose
 * link — never a broken affordance.
 */
export function UnsubMailtoCallout({
  senderId,
  senderName,
  mailtoUrl,
  status = 'action_required',
  onDismiss,
  onStatusChanged,
}: {
  senderId: string;
  senderName: string;
  mailtoUrl: string;
  status?: UnsubscribeLifecycleStatus | null;
  /** Present on transient (post-confirm) placements; omit for persistent ones. */
  onDismiss?: () => void;
  onStatusChanged?: (status: 'draft_opened' | 'user_marked_sent') => void;
}) {
  const composeUrl = gmailComposeUrlFromMailto(mailtoUrl);
  const qc = useQueryClient();
  const progress = useRecordUnsubscribeManualStatus();
  const [localStatus, setLocalStatus] = useState(status);
  useEffect(() => setLocalStatus(status), [status]);
  if (!composeUrl) return null;

  const refreshProgress = () => {
    void qc.invalidateQueries({ queryKey: sendersKeys.all });
    void qc.invalidateQueries({ queryKey: activityKeys.all });
  };
  const record = (next: 'draft_opened' | 'user_marked_sent') => {
    progress.mutate(
      { senderId, status: next },
      {
        onSuccess: () => {
          setLocalStatus(next);
          onStatusChanged?.(next);
          refreshProgress();
          if (next === 'user_marked_sent') {
            toast(`Marked ${senderName}'s unsubscribe email as sent`, 'success');
          }
        },
        onError: () => {
          toast("Couldn't record that unsubscribe step. Refresh and try again.", 'warn');
        },
      },
    );
  };
  const markedSent = localStatus === 'user_marked_sent';

  return (
    <div
      role="status"
      data-testid="unsub-mailto-callout"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px 10px 14px',
        background: color.primarySoft,
        border: `1px solid ${color.primaryBorder}`,
        borderRadius: 10,
        fontFamily: font.sans,
      }}
    >
      <span style={{ flex: 1, fontSize: 13, color: color.fg, lineHeight: 1.5 }}>
        <strong style={{ fontWeight: 600 }}>One step left for {senderName}.</strong>{' '}
        <span style={{ color: color.fgSoft }}>
          {markedSent
            ? 'You marked the prefilled unsubscribe email as sent. This records your report; future delivery still depends on the sender.'
            : 'Their list takes unsubscribe requests by email. Open the prefilled Gmail draft, send it yourself, then mark it sent here.'}
        </span>
      </span>
      {!markedSent && (
        <>
          <a
            href={composeUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              if (localStatus === 'action_required' || localStatus === null) {
                record('draft_opened');
              }
            }}
            style={{
              background: color.primary,
              color: color.fgInverse,
              borderRadius: 6,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Open Gmail draft
          </a>
          <button
            type="button"
            disabled={progress.isPending}
            onClick={() => record('user_marked_sent')}
            style={{
              background: color.card,
              color: color.primary,
              border: `1px solid ${color.primaryBorder}`,
              borderRadius: 6,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              cursor: progress.isPending ? 'wait' : 'pointer',
              flexShrink: 0,
            }}
          >
            {progress.isPending ? 'Recording…' : 'Mark sent'}
          </button>
        </>
      )}
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss Gmail unsubscribe reminder"
          style={{
            background: 'transparent',
            border: 'none',
            color: color.fgMuted,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '0 4px',
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
