import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useNow } from './use-now';

function NowProbe() {
  const now = useNow();
  return <span>{now ?? ''}</span>;
}

describe('useNow hydration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the same empty snapshot on the server and first client render', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const container = document.createElement('div');
    container.innerHTML = renderToString(<NowProbe />);
    expect(container.textContent).toBe('');

    vi.mocked(Date.now).mockReturnValue(2_000);
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, <NowProbe />);
    });

    expect(container.textContent).toBe('2000');
    expect(
      consoleError.mock.calls.some(([message]) => String(message).includes('Hydration failed')),
    ).toBe(false);

    await act(async () => root?.unmount());
  });
});
