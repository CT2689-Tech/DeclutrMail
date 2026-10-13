'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HomeVisitSummary } from '@declutrmail/shared/contracts/home-visit';
import { useAuth } from '@/features/auth/auth-provider';
import { apiGet, apiPost } from '@/lib/api/client';

import { writeHomeVisitCookie } from './home-visit-cookie';
import { homeVisitQueryOptions } from './query-options';

const IDLE_MS = 30 * 60_000;
const memoryVisits = new Map<string, { id: string; lastActive: number }>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function visitStorageKey(scope: string): string {
  return `declutrmail:visit:${scope}`;
}

function readStoredVisitId(scope: string, now: number): string | null {
  const key = visitStorageKey(scope);
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (
      saved &&
      typeof saved === 'object' &&
      'id' in saved &&
      'lastActive' in saved &&
      typeof saved.id === 'string' &&
      UUID.test(saved.id) &&
      typeof saved.lastActive === 'number' &&
      saved.lastActive <= now &&
      now - saved.lastActive < IDLE_MS
    ) {
      return saved.id;
    }
  } catch {
    const fallback = memoryVisits.get(key);
    if (fallback && now - fallback.lastActive < IDLE_MS) return fallback.id;
  }
  return null;
}

/** A device visit lasts while the app is visible and survives navigation/reload. */
export function useHomeVisit() {
  const { me } = useAuth();
  const mailboxId = me.activeMailboxId;
  const scope = `${me.user.id}:${mailboxId}`;
  const [visit, setVisit] = useState<{ scope: string; id: string } | null>(() => {
    if (typeof window === 'undefined' || !mailboxId) return null;
    const id = readStoredVisitId(scope, Date.now());
    return id ? { scope, id } : null;
  });
  const ready = me.mailboxes.find((mailbox) => mailbox.id === mailboxId)?.readiness === 'ready';

  useEffect(() => {
    if (!mailboxId || !ready) return;
    const key = visitStorageKey(scope);

    const touch = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      let id: string;
      const fallback = memoryVisits.get(key);
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (
          saved &&
          typeof saved === 'object' &&
          'id' in saved &&
          'lastActive' in saved &&
          typeof saved.id === 'string' &&
          UUID.test(saved.id) &&
          typeof saved.lastActive === 'number' &&
          saved.lastActive <= now &&
          now - saved.lastActive < IDLE_MS
        )
          id = saved.id;
        else id = crypto.randomUUID();
        localStorage.setItem(key, JSON.stringify({ id, lastActive: now }));
      } catch {
        id = fallback && now - fallback.lastActive < IDLE_MS ? fallback.id : crypto.randomUUID();
      }
      memoryVisits.set(key, { id, lastActive: now });
      writeHomeVisitCookie(mailboxId, id);
      setVisit((previous) =>
        previous?.scope === scope && previous.id === id ? previous : { scope, id },
      );
    };
    touch();
    const interval = window.setInterval(touch, 60_000);
    window.addEventListener('focus', touch);
    document.addEventListener('visibilitychange', touch);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', touch);
      document.removeEventListener('visibilitychange', touch);
    };
  }, [scope, mailboxId, ready]);

  const visitId = visit?.scope === scope ? visit.id : null;
  const peekPath =
    visitId !== null ? `/api/home/visit?visitId=${encodeURIComponent(visitId)}` : '/api/home/visit';
  const query = useQuery({
    ...homeVisitQueryOptions(mailboxId, async (signal) => {
      const envelope = await apiGet<HomeVisitSummary>(peekPath, {
        mailboxId: mailboxId!,
        signal,
      });
      return envelope.data;
    }),
    enabled: ready && mailboxId !== null,
  });

  useEffect(() => {
    if (!ready || mailboxId === null || visitId === null) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled || document.visibilityState === 'hidden') return;
      void apiPost<HomeVisitSummary>('/api/home/visit', { visitId }, { mailboxId }).catch(
        () => undefined,
      );
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [ready, mailboxId, visitId]);

  return query;
}

/** Capture a ready-mailbox visit on app routes without adding its code to every first-load bundle. */
export function HomeVisitTracker() {
  useHomeVisit();
  return null;
}
