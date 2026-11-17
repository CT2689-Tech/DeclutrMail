// Storybook CSF3 stories for the MCP connector's two web surfaces
// (ADR-0048, docs/spec/mcp-connector.md §4). Local CSF shims per the
// existing stories pattern; both components are presentational, so no
// network or query client is needed.
//
// Settings → Connected apps:
//   • Connected         — two apps, one never used, one unnamed
//   • Empty             — nothing connected
//   • Disconnecting     — one row's Disconnect in flight
//   • DisconnectFailed  — the failure line names the app
//   • LoadFailed        — the group's own Retry row
//
// Consent page (/connect/authorize):
//   • ConsentReady      — app, redirect host, both scopes, two accounts
//   • ConsentReadOnly   — only the requested scope is listed
//   • ConsentNoMailbox  — no Gmail account connected yet
//   • ConsentUnnamedLongHost — unnamed app, a long redirect host wraps
//   • ConsentApproving  — both buttons locked while the decision posts
//   • ConsentDeletionPending — approve refused: account deletion scheduled
//   • ConsentLoading · ConsentExpired · ConsentLoadFailed · ConsentReturning

import type { ConnectedApp, ConnectorConsent } from '@declutrmail/shared/contracts';

import { ConnectedAppsGroup } from './connected-apps-section';
import { ConsentCard, type ConsentCardState } from './consent-screen';

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

const meta: StoryMeta<typeof ConnectedAppsGroup> = {
  title: 'Settings/ConnectedApps',
  component: ConnectedAppsGroup,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Apps that can act for the person through the MCP connector, each with its own Disconnect, and the consent page that connects one.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

const CLAUDE: ConnectedApp = {
  id: '11111111-1111-4111-8111-111111111111',
  appName: 'Claude',
  scopes: ['read', 'cleanup'],
  connectedAt: '2026-11-02T10:00:00.000Z',
  lastUsedAt: '2026-11-16T08:30:00.000Z',
};
const CURSOR: ConnectedApp = {
  id: '22222222-2222-4222-8222-222222222222',
  appName: 'Cursor',
  scopes: ['read'],
  connectedAt: '2026-11-10T10:00:00.000Z',
  lastUsedAt: null,
};
const UNNAMED: ConnectedApp = {
  ...CURSOR,
  id: '33333333-3333-4333-8333-333333333333',
  appName: null,
};

const groupArgs = {
  timeZone: 'UTC',
  pendingId: null,
  failedAppName: null,
  onDisconnect: () => {},
};

export const Connected: Story<typeof ConnectedAppsGroup> = {
  args: { ...groupArgs, state: { kind: 'ready', apps: [CLAUDE, CURSOR, UNNAMED] } },
};

export const Empty: Story<typeof ConnectedAppsGroup> = {
  args: { ...groupArgs, state: { kind: 'ready', apps: [] } },
};

export const Disconnecting: Story<typeof ConnectedAppsGroup> = {
  args: { ...groupArgs, state: { kind: 'ready', apps: [CLAUDE, CURSOR] }, pendingId: CLAUDE.id },
};

export const DisconnectFailed: Story<typeof ConnectedAppsGroup> = {
  args: { ...groupArgs, state: { kind: 'ready', apps: [CLAUDE] }, failedAppName: 'Claude' },
};

export const LoadFailed: Story<typeof ConnectedAppsGroup> = {
  args: { ...groupArgs, state: { kind: 'error', onRetry: () => {} } },
};

const CONSENT: ConnectorConsent = {
  appName: 'Claude',
  redirectHost: 'claude.ai',
  scopes: ['read', 'cleanup'],
  mailboxes: ['ada@example.com', 'ada.work@example.com'],
};

const ready = (
  consent: ConnectorConsent,
  overrides: Partial<Extract<ConsentCardState, { kind: 'ready' }>> = {},
): ConsentCardState => ({
  kind: 'ready',
  consent,
  deciding: null,
  decisionError: null,
  onApprove: () => {},
  onDeny: () => {},
  ...overrides,
});

const consentStory = (state: ConsentCardState): Story<typeof ConnectedAppsGroup> => ({
  parameters: { layout: 'fullscreen' },
  render: () => <ConsentCard state={state} />,
});

export const ConsentReady = consentStory(ready(CONSENT));
export const ConsentReadOnly = consentStory(ready({ ...CONSENT, scopes: ['read'] }));
export const ConsentNoMailbox = consentStory(ready({ ...CONSENT, mailboxes: [] }));
export const ConsentUnnamedLongHost = consentStory(
  ready({
    ...CONSENT,
    appName: null,
    redirectHost: 'a-very-long-subdomain.of-an-unfamiliar-application.example.com:8443',
  }),
);
export const ConsentApproving = consentStory(ready(CONSENT, { deciding: 'approve' }));
export const ConsentDeletionPending = consentStory(
  ready(CONSENT, {
    decisionError: 'Account deletion is scheduled. Cancel it in Settings to connect an app.',
  }),
);
export const ConsentLoading = consentStory({ kind: 'loading' });
export const ConsentExpired = consentStory({ kind: 'gone' });
export const ConsentLoadFailed = consentStory({ kind: 'error', onRetry: () => {} });
export const ConsentReturning = consentStory({ kind: 'returning', redirectHost: 'claude.ai' });
