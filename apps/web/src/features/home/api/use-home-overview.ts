import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { hasCapability, type TierId } from '@declutrmail/shared/entitlements';
import { MailboxSnapshotSchema, type MailboxSnapshot } from '@declutrmail/shared/inbox-report';
import type { AutopilotSenderRule, AutopilotPendingMeta } from '@declutrmail/shared/contracts';
import { apiGet } from '@/lib/api/client';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import type { FollowupRow } from '@/lib/api/followups';
import type { BriefWire } from '@/lib/api/brief';
import type { ActivityRowWire } from '@/lib/api/activity';
import { activityKeys } from '@/features/activity/api/query-keys';
import { useHomeSummary, type HomeSummary } from './use-home-summary';

export interface HomeRead<T> {
  status: 'loading' | 'ready' | 'error' | 'locked';
  data: T | null;
}
export interface HomeOverview {
  snapshot: HomeRead<MailboxSnapshot>;
  week: HomeRead<HomeSummary>;
  rules: HomeRead<{ active: number; watching: number; paused: number }>;
  suggestions: HomeRead<number>;
  followups: HomeRead<number>;
  brief: HomeRead<{ opened: boolean } | null>;
  recent: HomeRead<ActivityRowWire | null>;
}
function read<T>(query: UseQueryResult<T>, enabled = true): HomeRead<T> {
  if (!enabled) return { status: 'locked', data: null };
  return {
    status: query.isError ? 'error' : query.data === undefined ? 'loading' : 'ready',
    data: query.isError ? null : (query.data ?? null),
  };
}

/** Optional, explicitly mailbox-scoped reads never hold action/Undo completion open. */
export function useHomeOverview(
  mailboxId: string | null,
  tier: TierId,
  ready: boolean,
): HomeOverview {
  const client = useQueryClient();
  useEffect(() => {
    let queued = false;
    let active = true;
    const stop = client.getQueryCache().subscribe((event) => {
      if (
        event.type !== 'updated' ||
        event.action.type !== 'invalidate' ||
        event.query.queryKey[0] !== activityKeys.all[0] ||
        queued
      )
        return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!active) return;
        // Observe the shared terminal reconciliation; optional reads never join its latch.
        void client.invalidateQueries({ queryKey: ['home-overview', mailboxId] });
        void client.invalidateQueries({ queryKey: ['home-sender-preview', mailboxId] });
      });
    });
    return () => {
      active = false;
      stop();
    };
  }, [client, mailboxId]);
  useEffect(
    () =>
      client.getMutationCache().subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'success') {
          void client.invalidateQueries({ queryKey: ['home-overview', mailboxId] });
        }
      }),
    [client, mailboxId],
  );
  const enabled = mailboxId !== null && ready;
  const options = { retry: false, staleTime: 30_000, refetchOnWindowFocus: true } as const;
  const request = <T>(path: string, signal: AbortSignal) =>
    apiGet<T>(path, { signal, mailboxId: mailboxId! });
  const snapshot = useQuery({
    ...options,
    queryKey: ['home-overview', mailboxId, 'snapshot'],
    enabled,
    queryFn: async ({ signal }) =>
      MailboxSnapshotSchema.parse(
        (await request<unknown>(`/api/mailboxes/${mailboxId}/inbox-snapshot`, signal)).data,
      ),
  });
  const week = useHomeSummary({ enabled, mailboxId: mailboxId ?? undefined, window: '7d' });
  const canAutomate = enabled && hasCapability(tier, 'autopilot');
  const rules = useQuery({
    ...options,
    queryKey: ['home-overview', mailboxId, 'rules'],
    enabled: canAutomate,
    queryFn: async ({ signal }) => {
      const [presets, senders] = await Promise.all([
        request<AutopilotRuleDto[]>('/api/autopilot/rules', signal),
        request<AutopilotSenderRule[]>('/api/autopilot/sender-rules', signal),
      ]);
      const data = [...presets.data, ...senders.data];
      return {
        active: data.filter((row) => row.enabled && row.mode === 'active').length,
        watching: data.filter((row) => row.enabled && row.mode === 'observe').length,
        paused: data.filter((row) => !row.enabled || row.mode === 'paused').length,
      };
    },
  });
  const suggestions = useQuery({
    ...options,
    queryKey: ['home-overview', mailboxId, 'suggestions'],
    enabled: canAutomate,
    queryFn: async ({ signal }) => {
      const envelope = await request<unknown>('/api/autopilot/pending-suggestions', signal);
      const total = (envelope.meta as AutopilotPendingMeta | undefined)?.total;
      if (typeof total !== 'number' || !Number.isInteger(total) || total < 0)
        throw new Error('Suggestion total unavailable');
      return total;
    },
  });
  const canFollow = enabled && hasCapability(tier, 'followups');
  const followups = useQuery({
    ...options,
    queryKey: ['home-overview', mailboxId, 'followups'],
    enabled: canFollow,
    queryFn: async ({ signal }) =>
      (await request<FollowupRow[]>('/api/followups', signal)).data.filter(
        (row) => row.status === 'awaiting' && row.feedbackRating !== 'not_followup',
      ).length,
  });
  const canBrief = enabled && hasCapability(tier, 'brief');
  const brief = useQuery({
    ...options,
    queryKey: ['home-overview', mailboxId, 'brief'],
    enabled: canBrief,
    queryFn: async ({ signal }) => {
      const { data } = await request<BriefWire | null>('/api/briefs/today', signal);
      return data ? { opened: data.openedAt !== null } : null;
    },
  });
  const recent = useQuery({
    ...options,
    queryKey: ['home-overview', mailboxId, 'recent'],
    enabled,
    queryFn: async ({ signal }) => {
      const { data } = await request<ActivityRowWire[]>(
        '/api/activity?window=all&verb=archive,delete&limit=5',
        signal,
      );
      return (
        data.find(
          (row) =>
            row.executionState == null &&
            row.undoState.kind !== 'executed' &&
            row.affectedCount > 0,
        ) ?? null
      );
    },
  });
  return {
    snapshot: read(snapshot),
    week: read(week),
    rules: read(rules, hasCapability(tier, 'autopilot')),
    suggestions: read(suggestions, hasCapability(tier, 'autopilot')),
    followups: read(followups, hasCapability(tier, 'followups')),
    brief: read(brief, hasCapability(tier, 'brief')),
    recent: read(recent),
  };
}
