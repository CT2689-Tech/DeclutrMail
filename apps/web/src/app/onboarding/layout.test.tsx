/**
 * Tests for the onboarding auth boundary (D134 split).
 *
 * `/onboarding` sits outside the `(app)` group but is still authed —
 * its own layout supplies the `AuthProvider`. Pin the gate: while
 * `GET /api/auth/me` is in flight, children never render.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub } from '@/test/fetch-stub';

import OnboardingLayout from './layout';

describe('onboarding layout auth boundary — D134', () => {
  it('renders the auth skeleton, not children, while /api/auth/me is in flight', () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/auth/me',
        // Never resolves — pins the in-flight state.
        respond: () => new Promise<Response>(() => undefined),
      },
    ]);

    render(
      <QueryWrapper client={createTestQueryClient()}>
        <OnboardingLayout>
          <span>sync gate body</span>
        </OnboardingLayout>
      </QueryWrapper>,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('sync gate body')).not.toBeInTheDocument();
  });
});
