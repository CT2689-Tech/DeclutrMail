/**
 * Bare `/alternatives` and `/vs` have child pages but no page of their
 * own, so they 404'd while outreach copy linked `/alternatives`. Both now
 * 308 to the /compare hub, which links every page under them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const permanentRedirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ permanentRedirect }));

import AlternativesIndexRedirectPage from './alternatives/page';
import VsIndexRedirectPage from './vs/page';

afterEach(() => {
  permanentRedirect.mockClear();
});

describe('comparison hub redirects', () => {
  it.each([
    ['/alternatives', AlternativesIndexRedirectPage],
    ['/vs', VsIndexRedirectPage],
  ] as const)('%s redirects permanently to /compare', (_path, Page) => {
    Page();
    expect(permanentRedirect).toHaveBeenCalledWith('/compare');
  });
});
