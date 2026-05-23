'use client';

import { useCallback, useEffect, useState } from 'react';

import type { UndoTrayDataSource, UndoTrayEntry } from './undo-tray.types';

/**
 * Stub fetch hook for the persistent undo tray (D35).
 *
 * This is a placeholder until D200's TanStack Query foundation lands —
 * at that point this hook becomes a thin wrapper around `useQuery({
 * queryKey: ['undo', mailboxId] })` + `useMutation` for the revert. The
 * component contract (`UndoTrayDataSource`) is the surface that
 * survives the migration; consumers of the tray do not change.
 *
 * Failure path: the stub treats any non-OK response as "no active
 * tokens" so a misconfigured environment renders the empty state
 * rather than a stack-trace error boundary. TanStack will replace this
 * with first-class error handling on the foundation PR.
 */
export function useUndoTray(options: {
  /** Mailbox account UUID — passed as `x-mailbox-account-id` header. */
  mailboxAccountId: string;
  /**
   * Override for tests + Storybook. When provided, the hook returns
   * the canned data source instead of making network calls.
   */
  dataSource?: UndoTrayDataSource;
  /** API base URL (default `/api`); allows local dev overrides. */
  apiBaseUrl?: string;
}): UndoTrayDataSource {
  const { dataSource, mailboxAccountId, apiBaseUrl = '/api' } = options;
  const [entries, setEntries] = useState<UndoTrayEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/undo`, {
        headers: { 'x-mailbox-account-id': mailboxAccountId },
        credentials: 'include',
      });
      if (!res.ok) {
        setEntries([]);
        return;
      }
      const body = (await res.json()) as { data: UndoTrayEntry[] };
      setEntries(body.data);
    } catch {
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, mailboxAccountId]);

  useEffect(() => {
    if (dataSource) {
      return;
    }
    void refresh();
  }, [dataSource, refresh]);

  const revert = useCallback(
    async (token: string): Promise<void> => {
      const res = await fetch(`${apiBaseUrl}/undo/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'x-mailbox-account-id': mailboxAccountId },
        credentials: 'include',
      });
      // Drop the row regardless of outcome — expired tokens are also
      // safe to clear from the tray. The full error surfacing (toast
      // on failure, retry on transient) lands with TanStack.
      setEntries((prev) => prev.filter((e) => e.token !== token));
      // Best-effort body drain so the connection can return to the pool.
      void res.text();
    },
    [apiBaseUrl, mailboxAccountId],
  );

  if (dataSource) {
    return dataSource;
  }
  return { entries, isLoading, revert };
}
