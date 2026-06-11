/**
 * Tests for the public `(marketing)` layout (D134 public-route split).
 *
 * The invariant under test: marketing routes render with NO auth
 * round-trip. Two proofs in one render:
 *
 *   1. The layout mounts WITHOUT a QueryClientProvider in the tree.
 *      If anything in its import chain mounted `AuthProvider` (whose
 *      `useMe` calls `useQuery`), the render would throw — so a clean
 *      render is structural evidence the auth chain isn't here.
 *
 *   2. A fetch spy asserts zero network calls — no `GET /api/auth/me`,
 *      no anything. Public pages must not block on the API.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import MarketingLayout from './layout';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('(marketing) layout — D134', () => {
  it('renders children without any fetch (no /api/auth/me) and without a QueryClient', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // No QueryClientProvider wrapper on purpose — see header comment.
    render(
      <MarketingLayout>
        <span>public page body</span>
      </MarketingLayout>,
    );

    expect(screen.getByText('public page body')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
