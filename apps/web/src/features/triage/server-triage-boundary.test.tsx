import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

import { makeQueryClient } from '@/lib/query-client';
import { shouldPrefetchTriage } from './api/query-options';
import { useTriageQueue, useTriageStats } from './api/use-triage-queue';
import { useTodaySummary } from './api/use-triage-queue';
import { useMeSettings } from '@/features/settings/api/use-me-settings';
import { ServerTriageBoundary } from './server-triage-boundary';

function TriageProbe() {
  const queue = useTriageQueue();
  const stats = useTriageStats();
  const today = useTodaySummary();
  const settings = useMeSettings();
  return (
    <div>
      {queue.isSuccess && stats.isSuccess && today.isSuccess && settings.isSuccess
        ? 'Triage ready'
        : 'Triage loading'}
    </div>
  );
}

describe('ServerTriageBoundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('hydrates queue and stats without duplicate client requests', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/triage/queue')) {
        return Response.json({ data: [] });
      }
      if (url.endsWith('/api/triage/stats')) {
        return Response.json({
          data: {
            decidedToday: 0,
            archivedToday: 0,
            unsubscribedToday: 0,
            laterToday: 0,
            freeRemaining: null,
            tier: 'pro',
          },
        });
      }
      if (url.endsWith('/api/triage/today-summary')) {
        return Response.json({
          data: {
            receivedToday: 0,
            sendersToday: 0,
            handledAutomatically: 0,
            queuedDecisions: 0,
            noiseReductionPct: null,
          },
        });
      }
      if (url.endsWith('/api/me/settings')) {
        return Response.json({ data: { actionSheetPrefs: {} } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const boundary = await ServerTriageBoundary({
      cookieHeader: 'dm_access=token',
      enabled: true,
      children: <TriageProbe />,
    });
    render(<QueryClientProvider client={makeQueryClient()}>{boundary}</QueryClientProvider>);

    expect(screen.getByText('Triage ready')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('does not retry designed 4xx states during server prefetch', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
    const fetchSpy = vi.fn(async () =>
      Response.json(
        { error: { code: 'NO_ACTIVE_MAILBOX', message: 'Select a mailbox' } },
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await ServerTriageBoundary({
      cookieHeader: 'dm_access=token',
      enabled: true,
      children: <div>Fallback</div>,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('prefetches only for an authed mailbox that has the triage capability', () => {
    expect(shouldPrefetchTriage({ activeMailboxId: 'Gmail account-1', tier: 'pro' })).toBe(true);
    expect(shouldPrefetchTriage({ activeMailboxId: 'Gmail account-1', tier: 'free' })).toBe(true);
    expect(shouldPrefetchTriage({ activeMailboxId: null, tier: 'pro' })).toBe(false);
    expect(shouldPrefetchTriage(null)).toBe(false);
    expect(shouldPrefetchTriage({ activeMailboxId: 'Gmail account-1', tier: 'not-a-tier' })).toBe(
      false,
    );
  });

  it('does not fetch mailbox data when the route is not eligible', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const boundary = await ServerTriageBoundary({
      cookieHeader: '',
      enabled: false,
      children: <div>Triage unavailable</div>,
    });
    render(<QueryClientProvider client={makeQueryClient()}>{boundary}</QueryClientProvider>);

    expect(screen.getByText('Triage unavailable')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
