import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingState } from '@declutrmail/shared/contracts';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { ME_QUERY_KEY } from '@/features/auth/api/me-contract';
import { ME_SETTINGS_QUERY_KEY } from '@/features/settings/api/query-options';
import { FIRST_TRIAGE_KEY, ONBOARDING_STATE_KEY } from './api/query-options';
import { syncStatusQueryKey } from './api/use-sync-status';
import { ServerOnboardingBoundary } from './server-onboarding-boundary';

const state: OnboardingState = {
  onboardedAt: null,
  skipped: false,
  goal: null,
  presetPicks: null,
  presets: [],
  verbTourCompletedAt: null,
};
const settings = { emailPrefs: { reminders: true } };
const me = { activeMailboxId: null as string | null, tier: 'pro', mailboxes: [] };

type Read = {
  path: string;
  started: number;
  cookie: string | null;
  mailbox: string | null;
  aborted: boolean;
};
function api({
  delays = {},
  activeMailboxId = null,
  authStatus = 200,
  stateStatus = 200,
  settingsStatus = 200,
  onboarding = state,
  ready = false,
  hang = [],
}: {
  delays?: Record<string, number>;
  activeMailboxId?: string | null;
  authStatus?: number;
  stateStatus?: number;
  settingsStatus?: number;
  onboarding?: OnboardingState;
  ready?: boolean;
  hang?: string[];
} = {}) {
  const reads: Read[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const headers = new Headers(init?.headers);
      const read = {
        path,
        started: Date.now(),
        cookie: headers.get('cookie'),
        mailbox: headers.get('X-Active-Mailbox-Id'),
        aborted: false,
      };
      reads.push(read);
      await new Promise<void>((resolve, reject) => {
        if (!hang.includes(path) && !delays[path]) {
          resolve();
          return;
        }
        const timer = hang.includes(path) ? undefined : setTimeout(resolve, delays[path]);
        init?.signal?.addEventListener(
          'abort',
          () => {
            if (timer !== undefined) clearTimeout(timer);
            read.aborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });
      const status =
        path === '/api/auth/me'
          ? authStatus
          : path === '/api/onboarding/state'
            ? stateStatus
            : path === '/api/me/settings'
              ? settingsStatus
              : 200;
      const data =
        path === '/api/auth/me'
          ? { ...me, activeMailboxId }
          : path === '/api/onboarding/state'
            ? onboarding
            : path === '/api/me/settings'
              ? settings
              : path === '/api/v1/sync/status'
                ? { is_ready_for_triage: ready }
                : [];
      return Response.json(
        status === 200 ? { data, meta: { pinned: 2, decided: 1 } } : { error: { code: 'FAILURE' } },
        { status },
      );
    }),
  );
  return reads;
}

function start(cookieHeader = 'dm_access=synthetic') {
  let ready = false;
  const result = ServerOnboardingBoundary({ cookieHeader, children: <div>Onboarding</div> }).then(
    (boundary) => {
      ready = true;
      return boundary;
    },
  );
  return { result, ready: () => ready };
}

type Boundary = Awaited<ReturnType<typeof ServerOnboardingBoundary>>;
function data(boundary: Boundary, key: readonly unknown[]) {
  return boundary.props.state.queries.find(
    (query: { queryKey: readonly unknown[] }) =>
      JSON.stringify(query.queryKey) === JSON.stringify(key),
  )?.state.data;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('ServerOnboardingBoundary', () => {
  it('overlaps user reads with authentication for a connected-account-free visit', async () => {
    const reads = api({
      delays: { '/api/auth/me': 600, '/api/onboarding/state': 600, '/api/me/settings': 600 },
    });
    const boundary = start();
    await vi.advanceTimersByTimeAsync(600);
    expect(boundary.ready()).toBe(true);
    expect(reads).toHaveLength(3);
    expect(
      reads.every(
        (read) =>
          read.started === 0 && read.cookie === 'dm_access=synthetic' && read.mailbox === null,
      ),
    ).toBe(true);
    const result = await boundary.result;
    expect(data(result, ONBOARDING_STATE_KEY)).toEqual(state);
    expect(data(result, ME_SETTINGS_QUERY_KEY)).toEqual(settings);
    expect(data(result, ME_QUERY_KEY)).toEqual(me);
  });

  it('starts mailbox sync after auth while slower user reads are still pending', async () => {
    const reads = api({
      activeMailboxId: 'mb-primary',
      delays: {
        '/api/auth/me': 600,
        '/api/me/settings': 1200,
        '/api/onboarding/state': 1200,
        '/api/v1/sync/status': 100,
      },
    });
    const boundary = start();
    await vi.advanceTimersByTimeAsync(600);
    const sync = reads.find((read) => read.path === '/api/v1/sync/status');
    expect(sync).toMatchObject({
      started: 600,
      mailbox: 'mb-primary',
      cookie: 'dm_access=synthetic',
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(boundary.ready()).toBe(true);
    expect(data(await boundary.result, syncStatusQueryKey('mb-primary'))).toEqual({
      is_ready_for_triage: false,
    });
  });

  it('does not speculate on user or mailbox reads without an access cookie', async () => {
    const reads = api({ authStatus: 401 });
    const boundary = start('dm_refresh=synthetic');
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.map((read) => read.path)).toEqual(['/api/auth/me']);
    expect((await boundary.result).props.state.queries).toHaveLength(0);
  });

  it('discards successful speculative data when authentication fails', async () => {
    const reads = api({ authStatus: 401, delays: { '/api/auth/me': 100 } });
    const boundary = start();
    await vi.advanceTimersByTimeAsync(100);
    expect((await boundary.result).props.state.queries).toHaveLength(0);
    expect(reads.some((read) => read.mailbox !== null)).toBe(false);
  });

  it('cancels hung speculation promptly when authentication fails', async () => {
    const reads = api({
      authStatus: 401,
      delays: { '/api/auth/me': 100 },
      hang: ['/api/onboarding/state', '/api/me/settings'],
    });
    const boundary = start();
    await vi.advanceTimersByTimeAsync(100);
    expect(boundary.ready()).toBe(true);
    expect(reads.filter((read) => read.path !== '/api/auth/me').every((read) => read.aborted)).toBe(
      true,
    );
    expect((await boundary.result).props.state.queries).toHaveLength(0);
    expect(console.warn).not.toHaveBeenCalled();
    const events = vi.mocked(console.info).mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(events).toEqual([
      expect.objectContaining({ timed_out_count: 0, unexpected_failure_count: 0 }),
    ]);
  });

  it.each([401, 403, 500])(
    'keeps a %s preferences failure absent while preserving successful gates',
    async (settingsStatus) => {
      api({ settingsStatus });
      const boundary = start();
      await vi.advanceTimersByTimeAsync(0);
      const result = await boundary.result;
      expect(data(result, ME_SETTINGS_QUERY_KEY)).toBeUndefined();
      expect(data(result, ONBOARDING_STATE_KEY)).toEqual(state);
      expect(data(result, ME_QUERY_KEY)).toEqual(me);
    },
  );

  it('does not let the earlier user-read deadline cancel later mailbox sync', async () => {
    const reads = api({
      activeMailboxId: 'mb-primary',
      delays: { '/api/auth/me': 1500, '/api/v1/sync/status': 1000 },
      hang: ['/api/me/settings'],
    });
    const boundary = start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(boundary.ready()).toBe(false);
    expect(reads.find((read) => read.path === '/api/me/settings')?.aborted).toBe(true);
    expect(reads.find((read) => read.path === '/api/v1/sync/status')?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(boundary.ready()).toBe(true);
    const result = await boundary.result;
    expect(data(result, ME_SETTINGS_QUERY_KEY)).toBeUndefined();
    expect(data(result, syncStatusQueryKey('mb-primary'))).toEqual({ is_ready_for_triage: false });
    const events = vi.mocked(console.info).mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(events.map((event) => event.timed_out_count)).toEqual([1, 0]);
  });

  it('preserves freshness timestamps when transferring user hydration', async () => {
    api({ delays: { '/api/auth/me': 900, '/api/onboarding/state': 100, '/api/me/settings': 100 } });
    const boundary = start();
    await vi.advanceTimersByTimeAsync(900);
    const result = await boundary.result;
    for (const key of [ONBOARDING_STATE_KEY, ME_SETTINGS_QUERY_KEY]) {
      const query = result.props.state.queries.find(
        (query: { queryKey: readonly unknown[] }) =>
          JSON.stringify(query.queryKey) === JSON.stringify(key),
      );
      expect(query?.state.dataUpdatedAt).toBe(100);
    }
  });

  it('keeps a failed state read absent and skips step-specific reads', async () => {
    const reads = api({ stateStatus: 500, activeMailboxId: 'mb-primary', ready: true });
    const boundary = start();
    await vi.advanceTimersByTimeAsync(0);
    const result = await boundary.result;
    expect(data(result, ONBOARDING_STATE_KEY)).toBeUndefined();
    expect(data(result, ME_SETTINGS_QUERY_KEY)).toEqual(settings);
    expect(
      reads.some((read) =>
        ['/api/autopilot/rules', '/api/onboarding/first-triage'].includes(read.path),
      ),
    ).toBe(false);
  });

  it('does not prefetch step-specific reads for completed onboarding', async () => {
    const reads = api({
      activeMailboxId: 'mb-primary',
      ready: true,
      onboarding: { ...state, onboardedAt: '2026-01-01T00:00:00Z' },
    });
    const boundary = start();
    await vi.advanceTimersByTimeAsync(0);
    await boundary.result;
    expect(
      reads.some((read) =>
        ['/api/autopilot/rules', '/api/onboarding/first-triage'].includes(read.path),
      ),
    ).toBe(false);
  });

  it.each([false, true])(
    'preserves the prerequisite for the ready mailbox step (goal chosen: %s)',
    async (goalChosen) => {
      const onboarding = goalChosen
        ? { ...state, goal: 'reduce_newsletters' as const, presetPicks: [] as [] }
        : state;
      const reads = api({
        activeMailboxId: 'mb-primary',
        ready: true,
        onboarding,
        delays: { '/api/auth/me': 100, '/api/v1/sync/status': 100 },
      });
      const boundary = start();
      await vi.advanceTimersByTimeAsync(100);
      expect(
        reads.some((read) =>
          ['/api/autopilot/rules', '/api/onboarding/first-triage'].includes(read.path),
        ),
      ).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      const path = goalChosen ? '/api/onboarding/first-triage' : '/api/autopilot/rules';
      expect(reads.find((read) => read.path === path)).toMatchObject({
        started: 200,
        mailbox: 'mb-primary',
      });
      const result = await boundary.result;
      if (goalChosen)
        expect(data(result, FIRST_TRIAGE_KEY)).toEqual({
          rows: [],
          meta: { pinned: 2, decided: 1 },
        });
    },
  );
});
