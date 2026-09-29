import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { daysSince } from './data';

function DaysProbe({ iso, now, timeZone }: { iso: string; now: number; timeZone: string }) {
  return <span>{daysSince(iso, now, timeZone)}</span>;
}

describe('daysSince hydration (DECLUTRMAIL-WEB-2C)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('SSR and the first client render agree when the IANA zone is explicit', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const iso = '2026-07-01T02:00:00.000Z';
    const now = Date.parse('2026-07-01T08:00:00.000Z');

    const container = document.createElement('div');
    container.innerHTML = renderToString(
      <DaysProbe iso={iso} now={now} timeZone="America/Los_Angeles" />,
    );
    expect(container.textContent).toBe('1');

    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(
        container,
        <DaysProbe iso={iso} now={now} timeZone="America/Los_Angeles" />,
      );
    });

    expect(container.textContent).toBe('1');
    expect(
      consoleError.mock.calls.some(([message]) => String(message).includes('Hydration failed')),
    ).toBe(false);

    await act(async () => root?.unmount());
  });
});
