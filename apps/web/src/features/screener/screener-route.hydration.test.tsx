import { act } from '@testing-library/react';
import type { ComponentProps, ReactNode, SetStateAction } from 'react';
import type * as ReactApi from 'react';
import { useLayoutEffect, useRef } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ScreenerRowApi from './screener-row';

const replayProbe = vi.hoisted(() => ({
  enabled: false,
  queuedVerb: null as string | null,
  hydratedAtClick: [] as boolean[],
  previewIntents: [] as string[],
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactApi>();
  return {
    ...actual,
    // A first-commit intent can be accepted and then cleared by the normal
    // initial mailbox reset effect. Observe the real setter, delegating every
    // update unchanged, so the unlocked control proves the guard's branch.
    useState: <S,>(initial: S | (() => S)) => {
      const [value, setValue] = actual.useState(initial);
      const observedSetter = actual.useCallback(
        (next: SetStateAction<S>) => {
          if (
            replayProbe.enabled &&
            typeof next === 'object' &&
            next !== null &&
            'rowId' in next &&
            'verb' in next &&
            typeof next.verb === 'string'
          ) {
            replayProbe.previewIntents.push(next.verb);
          }
          setValue(next);
        },
        [setValue],
      );
      return [value, observedSetter];
    },
  };
});
vi.mock('./screener-row', async (importOriginal) => {
  const actual = await importOriginal<typeof ScreenerRowApi>();
  const { useHydrated } = await import('@/lib/use-hydrated');
  function ReplayControl(props: ComponentProps<typeof actual.ScreenerRow>) {
    const hydrated = useHydrated();
    const controls = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      if (!hydrated && replayProbe.queuedVerb) {
        const verb = replayProbe.queuedVerb;
        replayProbe.queuedVerb = null;
        controls.current
          ?.querySelector(`[data-verb="${verb}"]`)
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }, [hydrated]);
    return (
      <div ref={controls}>
        {(['keep', 'archive', 'unsubscribe', 'later', 'delete'] as const).map((verb) => (
          <button
            key={verb}
            data-verb={verb}
            onClick={() => {
              replayProbe.hydratedAtClick.push(hydrated);
              props.onVerbClick(verb);
            }}
          >
            {verb}
          </button>
        ))}
        {props.pendingVerb && <span data-preview={props.pendingVerb}>Preview</span>}
      </div>
    );
  }
  return {
    ...actual,
    ScreenerRow: (props: ComponentProps<typeof actual.ScreenerRow>) =>
      replayProbe.enabled ? <ReplayControl {...props} /> : <actual.ScreenerRow {...props} />,
  };
});

// Isolate the paid queue's hydration from the already-resolved auth gate.
vi.mock('@/features/billing/tier-gate', () => ({
  TierGate: ({ children }: { children: ReactNode }) => children,
}));
// This regression concerns query snapshots, not remote image loading.
vi.mock('@declutrmail/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Avatar: () => <span aria-hidden="true" />,
}));
vi.mock('@/features/auth/auth-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOptionalAuth: () => ({
    me: {
      user: { id: 'user', email: 'reader@example.com' },
      activeMailboxId: 'mailbox',
      mailboxes: [{ id: 'mailbox', email: 'reader@example.com', readiness: 'ready' }],
    },
  }),
}));

import { undoKeys } from '@/features/undo/query-keys';
import type { InFlightActionGroup } from '@/lib/api/actions';
import { screenerCountQueryOptions, screenerQueueQueryOptions } from './api/query-options';
import { SCREENER_QUEUE } from './data';
import { ScreenerRoute } from './screener-route';

describe('Screener initial document hydration', () => {
  afterEach(() => {
    replayProbe.enabled = false;
    replayProbe.queuedVerb = null;
    replayProbe.hydratedAtClick = [];
    replayProbe.previewIntents = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([false, true, 'in-flight'] as const)(
    'matches SSR when a shared read completes before hydration: %s',
    async (countCompletesBeforeHydration) => {
      // Other reads may start after mounting; they must not manufacture data
      // during this diagnostic's first server-to-browser render transition.
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>(() => undefined)),
      );
      const options = { defaultOptions: { queries: { retry: false, staleTime: 30_000 } } };
      const source = new QueryClient(options);
      await source.fetchQuery(screenerQueueQueryOptions(async () => [SCREENER_QUEUE[0]!]));
      const state = dehydrate(source);
      const server = new QueryClient(options);
      const browser = new QueryClient(options);
      const tree = (client: QueryClient) => (
        <QueryClientProvider client={client}>
          <HydrationBoundary state={state}>
            <ScreenerRoute />
          </HydrationBoundary>
        </QueryClientProvider>
      );
      const container = document.createElement('div');
      container.innerHTML = renderToString(tree(server));
      expect(container.textContent).not.toContain('5 senders awaiting a first review');
      if (countCompletesBeforeHydration === true) {
        // The real app chrome mounts the same count observer before the
        // route's independently-hydrating boundary. Its completed request
        // is already in the shared browser cache when the route first renders.
        await browser.fetchQuery(screenerCountQueryOptions(async () => ({ pending: 5 })));
      }
      if (countCompletesBeforeHydration === 'in-flight') {
        const group: InFlightActionGroup = {
          groupId: 'running-group',
          verb: 'archive',
          mixedVerbs: false,
          running: true,
          total: 1,
          done: 0,
          failed: 0,
          senderCount: 1,
          leadSenderName: null,
          startedAt: '2026-10-03T00:00:00.000Z',
          senderIds: [SCREENER_QUEUE[0]!.senderId],
        };
        await browser.fetchQuery({
          queryKey: undoKeys.inFlight('mailbox'),
          queryFn: async () => [group],
        });
      }
      const onRecoverableError = vi.fn();
      let root: Root | undefined;
      try {
        await act(async () => {
          root = hydrateRoot(container, tree(browser), { onRecoverableError });
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(onRecoverableError).not.toHaveBeenCalled();
        if (countCompletesBeforeHydration === true) {
          expect(container.textContent).toContain('5 senders awaiting a first review');
        }
        if (countCompletesBeforeHydration === 'in-flight') {
          expect(container.querySelector('.dm-screener-row')).toHaveAttribute('aria-busy', 'true');
        }
      } finally {
        await act(async () => root?.unmount());
        source.clear();
        server.clear();
        browser.clear();
      }
    },
  );

  it.each(
    (['keep', 'archive', 'unsubscribe', 'later', 'delete', 'unlocked-control'] as const).flatMap(
      (intent) => (['replay', 'first-commit'] as const).map((phase) => ({ intent, phase })),
    ),
  )('preserves the live action lock during $phase: $intent', async ({ intent, phase }) => {
    // The actual SSR accordion initially has no verb buttons. A stable
    // control host exercises its real screen callback during React replay,
    // without changing the lock hook or the screen's state machine.
    replayProbe.enabled = true;
    const fetch = vi.fn((_input: string | URL | Request) => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetch);
    const options = { defaultOptions: { queries: { retry: false, staleTime: Infinity } } };
    const source = new QueryClient(options);
    await source.fetchQuery(screenerQueueQueryOptions(async () => [SCREENER_QUEUE[0]!]));
    const state = dehydrate(source);
    const server = new QueryClient(options);
    const browser = new QueryClient(options);
    const tree = (client: QueryClient) => (
      <QueryClientProvider client={client}>
        <HydrationBoundary state={state}>
          <ScreenerRoute />
        </HydrationBoundary>
      </QueryClientProvider>
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree(server));
    if (intent !== 'unlocked-control') {
      const group: InFlightActionGroup = {
        groupId: 'running-group',
        verb: 'archive',
        mixedVerbs: false,
        running: true,
        total: 1,
        done: 0,
        failed: 0,
        senderCount: 1,
        leadSenderName: null,
        startedAt: '2026-10-03T00:00:00.000Z',
        senderIds: [SCREENER_QUEUE[0]!.senderId],
      };
      await browser.fetchQuery({
        queryKey: undoKeys.inFlight('mailbox'),
        queryFn: async () => [group],
      });
    }
    const verb = intent === 'unlocked-control' ? 'archive' : intent;
    const button = container.querySelector<HTMLButtonElement>(`[data-verb="${verb}"]`)!;
    if (phase === 'first-commit') replayProbe.queuedVerb = verb;
    const onRecoverableError = vi.fn();
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, tree(browser), { onRecoverableError });
        // A genuine discrete replay flushes hydration effects first. The
        // separate first-commit case dispatches from a layout effect to
        // exercise the earlier callback with its false hydration snapshot.
        if (phase === 'replay') button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(replayProbe.hydratedAtClick).toEqual([phase === 'replay']);
      expect(replayProbe.previewIntents).toEqual(intent === 'unlocked-control' ? ['archive'] : []);
      if (phase === 'replay') {
        expect(container.querySelector('[data-preview]') !== null).toBe(
          intent === 'unlocked-control',
        );
      }
      expect(fetch.mock.calls.some(([input]) => String(input).includes('/decide'))).toBe(false);
    } finally {
      await act(async () => root?.unmount());
      source.clear();
      server.clear();
      browser.clear();
    }
  });
});
