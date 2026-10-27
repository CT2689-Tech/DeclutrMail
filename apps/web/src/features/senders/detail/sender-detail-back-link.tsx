'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@declutrmail/shared';
import { useOptionalAuth } from '@/features/auth/auth-provider';
import { useMailboxScopeReset } from '@/features/mailboxes/use-mailbox-scope-reset';
import {
  clearGuidedReviewSession,
  GUIDED_REVIEW_PARAM,
  readGuidedReviewSession,
} from '../guided-review-session';
import { readSendersReturnHref, SENDER_RETURN_PARAM } from '../sender-detail-navigation';

/** Guided tokens retain ownership checks; ordinary detail links carry only safe workspace scope. */
export function SenderDetailBackLink({
  senderId,
  arrow = false,
  asButton = false,
  className,
  style,
}: {
  senderId?: string;
  arrow?: boolean;
  asButton?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const auth = useOptionalAuth();
  const params = useSearchParams();
  const token =
    params?.get(GUIDED_REVIEW_PARAM) ??
    (typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get(GUIDED_REVIEW_PARAM));
  const userId = auth?.me.user.id;
  const mailboxId = auth?.me.activeMailboxId ?? undefined;
  const identity = `${userId ?? ''}\u0000${mailboxId ?? ''}`;
  const currentSenderId =
    senderId ??
    (typeof window === 'undefined' ? '' : (window.location.pathname.split('/').at(-1) ?? ''));
  const [target, setTarget] = useState<{
    identity: string;
    token: string;
    senderId: string;
    expiresAt: number;
    href: string;
  } | null>(null);
  const previousOwner = useRef(userId && mailboxId ? identity : null);
  useMailboxScopeReset(identity, () => {
    if (previousOwner.current === null && userId && mailboxId) {
      previousOwner.current = identity;
      return;
    }
    clearGuidedReviewSession();
    setTarget(null);
    previousOwner.current = userId && mailboxId ? identity : null;
  });
  useEffect(() => {
    if (!token || !userId || !mailboxId) {
      setTarget(null);
      return;
    }
    const record = readGuidedReviewSession({ token, userId, mailboxId });
    setTarget(
      record?.senderIds[record.index] === currentSenderId
        ? {
            identity,
            token,
            senderId: currentSenderId,
            expiresAt: record.expiresAt,
            href: record.returnHref,
          }
        : null,
    );
  }, [token, userId, mailboxId, identity, currentSenderId]);
  const guidedHref =
    target?.identity === identity &&
    target.token === token &&
    target.senderId === currentSenderId &&
    target.expiresAt > Date.now()
      ? target.href
      : null;
  const listHref = token
    ? '/senders'
    : (readSendersReturnHref(params?.get(SENDER_RETURN_PARAM)) ?? '/senders');
  const href = guidedHref ?? listHref;
  const label = guidedHref
    ? 'Back to Guided Review'
    : new URLSearchParams(listHref.split('?')[1]).get('view') === 'first-review'
      ? 'Back to first review'
      : 'Back to Senders';
  if (asButton)
    return (
      <Button tone="primary" onClick={() => window.location.assign(href)}>
        {label}
      </Button>
    );
  return (
    <a href={href} className={className} style={style}>
      {arrow ? '← ' : ''}
      {label}
    </a>
  );
}
