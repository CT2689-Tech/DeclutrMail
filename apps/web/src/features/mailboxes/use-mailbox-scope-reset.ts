'use client';

import { useEffect, useRef } from 'react';
import { MAILBOX_SCOPE_RESET_EVENT } from './api/reset-mailbox-cache';

/** Discard local previews at the switch boundary, before old query rows disappear. */
export function useMailboxScopeReset(mailboxId: string | undefined, onReset: () => void): void {
  const previousMailbox = useRef(mailboxId);
  useEffect(() => {
    if (previousMailbox.current === mailboxId) return;
    previousMailbox.current = mailboxId;
    onReset();
  }, [mailboxId, onReset]);
  useEffect(() => {
    window.addEventListener(MAILBOX_SCOPE_RESET_EVENT, onReset);
    return () => window.removeEventListener(MAILBOX_SCOPE_RESET_EVENT, onReset);
  }, [onReset]);
}
