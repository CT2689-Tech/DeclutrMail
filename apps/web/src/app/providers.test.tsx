/**
 * Tests for the root `Providers` (D200 + D134 public-route split).
 *
 * Before the split, `Providers` wrapped every route in `AuthProvider`,
 * so children were replaced by the auth skeleton until `GET
 * /api/auth/me` resolved. After the split the root providers are
 * auth-free: children render synchronously and no network request
 * fires at the root. Auth now lives in the `(app)` group layout and
 * `/onboarding`'s layout (tested there).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Providers } from './providers';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('root Providers — D134 split', () => {
  it('renders children synchronously with zero fetches (no auth gate at the root)', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(
      <Providers>
        <span>route body</span>
      </Providers>,
    );

    // Synchronous visibility — pre-split, AuthProvider's skeleton
    // would render here instead of the child.
    expect(screen.getByText('route body')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
