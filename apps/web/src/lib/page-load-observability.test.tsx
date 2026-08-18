import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { storeConsent } from './cookie-consent';
import { pageLoadSurface, PageLoadObservability } from './page-load-observability';
import { Providers } from '@/app/providers';

const h = vi.hoisted(() => ({
  report: undefined as ((metric: Record<string, unknown>) => void) | undefined,
  track: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/web-vitals', () => ({
  useReportWebVitals: (report: (metric: Record<string, unknown>) => void) => {
    h.report = report;
  },
}));

vi.mock('./posthog', () => ({ track: h.track }));

beforeEach(() => {
  h.report = undefined;
  h.track.mockClear();
  window.localStorage.removeItem('dm-cookie-consent');
  document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
  window.history.replaceState({}, '', '/senders/0198d95f-a409-7000-8000-000000000001');
});

describe('PageLoadObservability', () => {
  it('has bounded attribution for every App Router page', () => {
    const appRoot = path.join(process.cwd(), 'src/app');
    const pagePaths: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(absolute);
        if (entry.isFile() && entry.name === 'page.tsx') {
          const relative = path.relative(appRoot, directory);
          const route = relative
            .split(path.sep)
            .filter((segment) => !/^\(.+\)$/.test(segment))
            .map((segment) => (segment.startsWith('[') ? 'sample' : segment))
            .join('/');
          pagePaths.push(`/${route}`.replace(/\/$/, '') || '/');
        }
      }
    };
    visit(appRoot);

    expect(pagePaths.filter((pathname) => pageLoadSurface(pathname) === 'other')).toEqual([]);
  });

  it('is installed once by the root providers shared by every route', async () => {
    render(
      <Providers>
        <span>route body</span>
      </Providers>,
    );

    await waitFor(() => expect(h.report).toEqual(expect.any(Function)));
  });

  it('reports a Core Web Vital against a bounded route without identifiers', async () => {
    storeConsent('all');
    render(<PageLoadObservability />);

    act(() => {
      h.report?.({
        id: 'v4-1',
        name: 'LCP',
        value: 1875.4567,
        rating: 'good',
        navigationType: 'navigate',
      });
    });

    await waitFor(() =>
      expect(h.track).toHaveBeenCalledWith('web_vital_reported', {
        surface: 'sender_detail',
        metric: 'LCP',
        value: 1875.457,
        rating: 'good',
        navigation_type: 'navigate',
      }),
    );
  });

  it('emits each metric once if React re-registers the Web Vitals callback', async () => {
    storeConsent('all');
    render(<PageLoadObservability />);
    const metric = {
      id: 'v4-duplicate',
      name: 'CLS',
      value: 0.04,
      rating: 'good',
      navigationType: 'navigate',
    };

    act(() => {
      h.report?.(metric);
      h.report?.(metric);
    });

    await waitFor(() => expect(h.track).toHaveBeenCalledTimes(1));
  });

  it('buffers the metric until analytics consent is granted on the current load', async () => {
    window.history.replaceState({}, '', '/private-looking-segment?sender_q=user@example.com');
    render(<PageLoadObservability />);

    act(() => {
      h.report?.({
        id: 'v4-2',
        name: 'TTFB',
        value: 312.2,
        rating: 'good',
        navigationType: 'reload',
      });
    });
    expect(h.track).not.toHaveBeenCalled();

    act(() => storeConsent('all'));

    await waitFor(() =>
      expect(h.track).toHaveBeenCalledWith('web_vital_reported', {
        surface: 'other',
        metric: 'TTFB',
        value: 312.2,
        rating: 'good',
        navigation_type: 'reload',
      }),
    );
    expect(h.track).toHaveBeenCalledTimes(1);
  });
});
