import type { ReactElement } from 'react';
import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';

import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';

import { QuotaChip } from './quota-chip';

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
}));

const METERED: CleanupSummaryDto = {
  metered: true,
  limit: 1000,
  used: 360,
  remaining: 640,
  resetAt: '2026-11-09T00:00:00.000Z',
};

/** Node SSR has no `window`. happy-dom does, so hide it for the server pass. */
function renderOnServer(node: ReactElement): string {
  const win = globalThis.window;
  // @ts-expect-error simulating the Node render, where `window` is absent
  delete globalThis.window;
  try {
    return renderToString(node);
  } finally {
    globalThis.window = win;
  }
}

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

it('hydrates the quota chip href from the route, not from window', async () => {
  window.history.replaceState(null, '', '/settings?cancelDeletion=1');
  const html = renderOnServer(<QuotaChip summary={METERED} />);
  expect(html).toContain('href="/billing?from=%2Fsettings"');
  expect(html).not.toContain('cancelDeletion');

  const errors: unknown[] = [];
  const container = document.createElement('div');
  document.body.append(container);
  container.innerHTML = html;
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <QuotaChip summary={METERED} />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/billing?from=%2Fsettings%3FcancelDeletion%3D1',
    );
  } finally {
    await act(async () => root?.unmount());
  }
});
