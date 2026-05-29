// Storybook CSF3 stories for AdminSecurityEventsScreen (D181, D210).
//
// The screen reads from `useSecurityEvents` (TanStack Query). We
// prefill the QueryClient cache per story so each variant renders
// deterministically without a fetch round-trip — same pattern as
// `followups-screen.stories.tsx`.
//
// Mirrors the local-shim pattern used by sibling stories so the file
// typechecks before any future Storybook-runner swap (D210).

import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { securityEventsKeys } from './api/query-keys';
import { AdminSecurityEventsScreen } from './security-events-screen';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  parameters?: Record<string, unknown>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

const NOW = '2026-05-29T20:00:00.000Z';

interface Row {
  id: string;
  eventType: string;
  severity: 'info' | 'warning' | 'critical';
  occurredAt: string;
  workspaceId: string | null;
  userId: string | null;
  sourceIp: string | null;
  userAgent: string | null;
  payload: Record<string, unknown> | null;
}

function row(overrides: Partial<Row>): Row {
  return {
    id: 'evt-' + Math.random().toString(36).slice(2, 8),
    eventType: 'login.failure',
    severity: 'warning',
    occurredAt: NOW,
    workspaceId: null,
    userId: null,
    sourceIp: '203.0.113.7',
    userAgent: 'curl/8',
    payload: { provider: 'google', reason: 'missing_state_cookie' },
    ...overrides,
  };
}

const POPULATED_ROWS: Row[] = [
  row({
    eventType: 'login.failure',
    severity: 'warning',
    payload: { provider: 'google', reason: 'invalid_state' },
  }),
  row({
    eventType: 'rate_limit.breach',
    severity: 'critical',
    payload: { bucket: 'auth' },
    sourceIp: '198.51.100.42',
    userAgent: 'Mozilla/5.0 (suspected bot)',
  }),
  row({
    eventType: 'webhook.signature_failure',
    severity: 'warning',
    payload: {
      source: 'pubsub.gmail',
      reason: 'oidc_verify_failed',
      step: 2,
      subReason: 'signature_invalid',
    },
    sourceIp: null,
    userAgent: null,
  }),
  row({
    eventType: 'oauth.refresh_failed',
    severity: 'info',
    payload: {
      provider: 'google',
      reason: 'transient_failure',
      mailboxAccountId: 'mb-abc',
    },
  }),
  row({
    eventType: 'kms.access_error',
    severity: 'critical',
    payload: {
      provider: 'gcp',
      operation: 'decrypt',
      reason: 'kms_call_failed',
      keyResource: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
    },
  }),
];

const EMPTY_ROWS: Row[] = [];

/** Build an infinite-query cache entry shape. */
function infiniteEntry(rows: Row[], nextCursor: string | null = null) {
  return {
    pages: [
      {
        data: rows,
        meta: { pagination: { nextCursor, hasMore: nextCursor !== null, limit: 50 } },
      },
    ],
    pageParams: [''],
  };
}

function wrap(client: QueryClient): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <AdminSecurityEventsScreen />
    </QueryClientProvider>
  );
}

const meta: StoryMeta<typeof AdminSecurityEventsScreen> = {
  title: 'Admin / Security events',
  component: AdminSecurityEventsScreen,
  parameters: {
    layout: 'fullscreen',
    backgrounds: { default: 'newsprint' },
  },
  tags: ['autodocs'],
};

export default meta;

export const Populated: Story<typeof AdminSecurityEventsScreen> = {
  render: () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(securityEventsKeys.list({}), infiniteEntry(POPULATED_ROWS));
    return wrap(client);
  },
};

export const WithMorePages: Story<typeof AdminSecurityEventsScreen> = {
  render: () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(
      securityEventsKeys.list({}),
      infiniteEntry(POPULATED_ROWS, 'next-page-cursor'),
    );
    return wrap(client);
  },
};

export const Empty: Story<typeof AdminSecurityEventsScreen> = {
  render: () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(securityEventsKeys.list({}), infiniteEntry(EMPTY_ROWS));
    return wrap(client);
  },
};
