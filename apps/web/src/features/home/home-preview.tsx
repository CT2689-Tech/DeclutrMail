'use client';

import Link from 'next/link';
import { AppShell } from '@declutrmail/shared';

import { HomeView } from './home-view';
import { HOME_PREVIEW_STATES, type HomePreviewState } from './home-preview-state';
import styles from './home-view.module.css';

const action = { label: 'Review senders', href: '/senders' };

const ready = {
  kind: 'ready' as const,
  hero: { label: 'emails cleared', value: 3310 },
  since: '2026-08-11T12:00:00.000Z',
  secondary: [
    { label: 'Emails archived', value: 3000 },
    { label: 'Emails deleted', value: 310 },
    { label: 'Senders decided', value: 41 },
  ],
  action,
};

const summary = {
  metered: true,
  limit: 1000,
  used: 360,
  remaining: 640,
  resetAt: '2026-11-01T00:00:00.000Z',
};

const steps = [
  { kind: 'unsub_archive' as const, senderCount: 158, emailCount: 2400, senderIds: ['a'] },
  { kind: 'largest' as const, senderCount: 10, sizeLabel: '2.1 GB', senderIds: ['b'] },
  { kind: 'later_due' as const, senderCount: 3, senderIds: ['c'] },
];

/**
 * Every Home state inside the app shell, for preview and local QA.
 * Fixture numbers only. Sentences still come from the decks.
 */
export function HomePreview({ state }: { state: HomePreviewState }) {
  return (
    <div className="dm-app-viewport" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <AppShell active="home" onNavigate={() => undefined} accountInitial="A">
          <nav className={styles.previewNav} aria-label="Home preview states">
            {HOME_PREVIEW_STATES.map((id) => (
              <Link
                key={id}
                href={`/home-preview?state=${id}`}
                className="dm-external-link"
                aria-current={id === state ? 'page' : undefined}
              >
                {id}
              </Link>
            ))}
          </nav>
          <HomeView {...fixture(state)} />
        </AppShell>
      </div>
    </div>
  );
}

function fixture(state: HomePreviewState): Parameters<typeof HomeView>[0] {
  switch (state) {
    case 'full':
      return {
        state: ready,
        summary,
        nextSteps: steps,
        senderSizeView: true,
        reportSizeLabel: '7.7 GB',
        timeZone: 'UTC',
      };
    case 'no-size':
      return {
        state: ready,
        summary,
        nextSteps: steps,
        senderSizeView: false,
        reportSizeLabel: '7.7 GB',
        timeZone: 'UTC',
      };
    case 'caught-up':
      return { state: ready, summary, nextSteps: [], indexedEmailCount: 47, timeZone: 'UTC' };
    case 'empty':
      return { state: { kind: 'empty', syncing: false, action } };
    case 'syncing':
      return { state: { kind: 'empty', syncing: true, action } };
    case 'queued':
      return { state: { kind: 'empty', syncing: true, queued: true, action } };
    case 'failed':
      return { state: { kind: 'sync-failed', needsReconnect: false } };
    case 'reconnect':
      return { state: { kind: 'sync-failed', needsReconnect: true } };
    case 'loading':
      return { state: { kind: 'loading' } };
    case 'error':
      return { state: { kind: 'error', error: new Error('offline'), retry: () => undefined } };
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}
