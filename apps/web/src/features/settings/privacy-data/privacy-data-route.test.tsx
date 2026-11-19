import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { installFetchStub, jsonNotFound, jsonOk } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import {
  PrivacyDataContent,
  PrivacyDataFooter,
  PRIVACY_DATA_EXPORT_COPY,
} from './privacy-data-content';
import { PrivacyDataRoute } from './privacy-data-screen';

vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => ({ me: { mailboxes: [] } }) }));
vi.mock('@/features/billing/api/use-billing-subscription', () => ({
  useBillingSubscription: () => ({ data: undefined }),
}));

const REQUESTS_ROW = 'Cleanup requests from a connected app, waiting for your confirmation';

function renderRoute(grants: () => Response) {
  installFetchStub([{ method: 'GET', path: '/api/oauth/grants', respond: grants }]);
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <PrivacyDataRoute
        privacyContent={<PrivacyDataContent />}
        footerContent={<PrivacyDataFooter />}
        exportCopy={PRIVACY_DATA_EXPORT_COPY}
      />
    </QueryWrapper>,
  );
}

describe('PrivacyDataRoute — what a connected app can read', () => {
  it('is said once the connector answers for this person', async () => {
    renderRoute(() => jsonOk({ data: { apps: [] } }));
    expect(await screen.findByText(REQUESTS_ROW)).toBeInTheDocument();
    expect(screen.getAllByText(/An app you connect can read it\./).length).toBeGreaterThan(5);
  });

  it('is not said where the connector is off (404)', async () => {
    const grants = vi.fn(() => jsonNotFound());
    const { container } = renderRoute(grants);
    await waitFor(() => expect(grants).toHaveBeenCalled());
    // Give a wrongly-shown answer the chance to render before checking.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.textContent).not.toContain('An app you connect');
    expect(screen.queryByText(REQUESTS_ROW)).toBeNull();
  });
});
