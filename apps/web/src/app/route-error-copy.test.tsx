// Every route error page renders after a render failed, and a boundary
// cannot see whether a mutation committed before that. So no page may
// claim what the error left unchanged ("Your settings are unchanged",
// "Nothing in Gmail changed"): it says what failed and what to do next.
// Thirteen pages carried such a claim until 2026-09-28 (PR #784).

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/error-capture', () => ({
  captureErrorBoundaryException: () => Promise.resolve(),
}));
vi.mock('@/lib/sentry', () => ({ initSentryBrowser: () => Promise.resolve() }));

type ErrorPage = { default: (props: { error: Error; reset: () => void }) => ReactNode };

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Every `error.tsx` under `app/`, derived from disk so a new page is covered. */
function errorPagesFromFs(directory = APP_DIR): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const pages = entries
    .filter((entry) => entry.isFile() && entry.name === 'error.tsx')
    .map((entry) => path.join(directory, entry.name));
  for (const entry of entries) {
    if (entry.isDirectory()) pages.push(...errorPagesFromFs(path.join(directory, entry.name)));
  }
  return pages.sort();
}

const ERROR_PAGES = errorPagesFromFs().map((file) => path.relative(APP_DIR, file));

const STATE_CLAIM =
  /\b(unchanged|untouched)\b|\bnothing (was|in gmail|changed)\b|still being recorded/i;

afterEach(() => cleanup());

describe('route error pages', () => {
  it('finds every route error page', () => {
    // A walk that found nothing would pass every check below.
    expect(ERROR_PAGES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(ERROR_PAGES)('%s claims nothing about state it cannot see', async (file) => {
    const { default: Page } = (await import(
      /* @vite-ignore */ path.join(APP_DIR, file)
    )) as ErrorPage;
    const { container } = render(<Page error={new Error('render failed')} reset={() => {}} />);
    expect(container.textContent).toMatch(/\w/);
    expect(container.textContent).not.toMatch(STATE_CLAIM);
  });
});
