'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMailboxScopeReset } from '@/features/mailboxes/use-mailbox-scope-reset';
import {
  clearGuidedReviewSession,
  GUIDED_REVIEW_PARAM,
  newGuidedReviewSession,
  readGuidedReviewSession,
  saveGuidedReviewSession,
  writeGuidedReviewToken,
  type StoredGuidedReviewSession,
} from './guided-review-session';
import type { Sender } from './data';

type Identity = Pick<Sender, 'id' | 'name' | 'domain' | 'brandMark'>;
export interface GuidedReviewSession extends StoredGuidedReviewSession {
  rows: Identity[];
  saved: boolean;
}

export function useGuidedReviewSession({
  userId,
  mailboxId,
  scope,
  rows,
  reviewing,
  scopeLoading,
  refreshFailed,
  onRestoreSelection,
  selectedIds,
}: {
  userId: string;
  mailboxId: string | undefined;
  scope: string;
  rows: readonly Sender[];
  reviewing: boolean;
  scopeLoading: boolean;
  refreshFailed: boolean;
  onRestoreSelection: (selected: Set<string>) => void;
  selectedIds: ReadonlySet<string>;
}) {
  // Next's native-history integration re-renders this hook on Back/Forward.
  const params = useSearchParams();
  const search = params?.toString();
  const token =
    typeof window === 'undefined'
      ? (params?.get(GUIDED_REVIEW_PARAM) ?? null)
      : new URLSearchParams(window.location.search).get(GUIDED_REVIEW_PARAM);
  const [stored, setStored] = useState<GuidedReviewSession | null>(null);
  const latest = useRef(stored);
  latest.current = stored;
  const [unavailable, setUnavailable] = useState(false);
  const [requiresStart, setRequiresStart] = useState(false);
  const identity = `${userId}\u0000${mailboxId ?? ''}`;
  const previousScope = useRef({ identity, scope, known: Boolean(userId && mailboxId) });
  const clear = useCallback((removeToken = true) => {
    clearGuidedReviewSession();
    if (removeToken) writeGuidedReviewToken(null);
    latest.current = null;
    setStored(null);
    setUnavailable(false);
    setRequiresStart(false);
  }, []);
  const resetAccount = useCallback(() => {
    // Initial owner hydration is not an account switch.
    if (!previousScope.current.known && userId && mailboxId) return;
    clear();
    setRequiresStart(true);
  }, [clear, userId, mailboxId]);
  useMailboxScopeReset(identity, resetAccount);
  useEffect(() => {
    if (previousScope.current.identity !== identity || previousScope.current.scope !== scope) {
      const changedIdentity = previousScope.current.identity !== identity;
      const initiallyUnknown = !previousScope.current.known;
      previousScope.current = { identity, scope, known: Boolean(userId && mailboxId) };
      if (initiallyUnknown && userId && mailboxId) return;
      if (changedIdentity) resetAccount();
      else if (!reviewing || token === null) clear();
      else {
        clearGuidedReviewSession();
        latest.current = null;
        setStored(null);
        setUnavailable(true);
      }
    }
  }, [identity, scope, clear, resetAccount, reviewing, token, userId, mailboxId]);
  const session =
    stored?.userId === userId &&
    stored.mailboxId === mailboxId &&
    stored.scope === scope &&
    stored.token === token &&
    stored.expiresAt > Date.now()
      ? stored
      : null;
  useEffect(() => {
    if (!reviewing || scopeLoading || refreshFailed || !mailboxId || !userId || requiresStart)
      return;
    if (token === null) {
      setUnavailable(false);
      return;
    }
    if (session?.token === token && session.expiresAt > Date.now()) return;
    const restored = readGuidedReviewSession({ token, userId, mailboxId, scope });
    if (!restored) {
      setUnavailable(true);
      return;
    }
    const known = new Map(rows.map((row) => [row.id, row]));
    const next: GuidedReviewSession = {
      ...restored,
      saved: true,
      rows: restored.senderIds.map(
        (id, index) =>
          known.get(id) ?? { id, name: `Sender ${index + 1}`, domain: '', brandMark: false },
      ),
    };
    latest.current = next;
    setStored(next);
    setUnavailable(false);
    onRestoreSelection(new Set(restored.selectedIds));
  }, [
    reviewing,
    requiresStart,
    scopeLoading,
    refreshFailed,
    mailboxId,
    userId,
    scope,
    token,
    session,
    rows,
    onRestoreSelection,
    search,
  ]);
  useEffect(() => {
    if (!session || unavailable) return;
    // Preserve the existing action owner's selection-clearing behavior too.
    const queue = new Set(session.senderIds);
    const nextSelected = [...selectedIds].filter((id) => queue.has(id));
    if (
      nextSelected.length === session.selectedIds.length &&
      nextSelected.every((id, index) => id === session.selectedIds[index])
    )
      return;
    const record = { ...session, selectedIds: nextSelected };
    const next = { ...record, saved: saveGuidedReviewSession(record) };
    latest.current = next;
    setStored(next);
  }, [session, selectedIds, unavailable]);
  const start = useCallback(
    (
      nextRows: readonly Identity[],
      kind: StoredGuidedReviewSession['kind'],
      selectedIds: string[] = [],
    ) => {
      if (!mailboxId || !userId) return;
      // Empty scopes have no sender to leave for; no persisted session is needed.
      if (nextRows.length === 0) {
        clear();
        return;
      }
      const record = newGuidedReviewSession({
        userId,
        mailboxId,
        scope,
        senderIds: nextRows.map((row) => row.id),
        selectedIds,
        kind,
        index: 0,
      });
      const next: GuidedReviewSession = {
        ...record,
        rows: [...nextRows],
        saved: saveGuidedReviewSession(record),
      };
      latest.current = next;
      setStored(next);
      setUnavailable(false);
      setRequiresStart(false);
      writeGuidedReviewToken(record.token);
    },
    [mailboxId, userId, scope, clear],
  );
  const navigate = useCallback((index: number) => {
    const current = latest.current;
    if (!current || index < 0 || index >= current.rows.length) return;
    const record = { ...current, index };
    const next = { ...record, saved: saveGuidedReviewSession(record) };
    latest.current = next;
    setStored(next);
  }, []);
  const retrySave = useCallback(() => {
    const current = latest.current;
    if (!current) return;
    const next = { ...current, saved: saveGuidedReviewSession(current) };
    latest.current = next;
    setStored(next);
  }, []);
  const exit = useCallback(() => {
    // A native detail return loses React selection before the sender read settles.
    // Restore only navigation IDs; current sender facts still require that read.
    if (!session && !unavailable && !requiresStart && token && userId && mailboxId) {
      const restored = readGuidedReviewSession({ token, userId, mailboxId, scope });
      if (restored) onRestoreSelection(new Set(restored.selectedIds));
    }
    // Loaded sessions keep the action owner's current selection, including clears.
    clear(false);
  }, [
    session,
    unavailable,
    requiresStart,
    token,
    userId,
    mailboxId,
    scope,
    onRestoreSelection,
    clear,
  ]);
  return {
    session,
    unavailable: unavailable || requiresStart,
    token,
    start,
    navigate,
    clear,
    exit,
    retrySave,
  };
}
