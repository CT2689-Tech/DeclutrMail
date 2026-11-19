// Storybook CSF3 stories for Settings → Connected apps (ADR-0048,
// docs/spec/mcp-connector.md §4). Local CSF shims per the existing
// stories pattern; the group is presentational, so no network or query
// client is needed. The consent page has its own file
// (`consent-screen.stories.tsx`).
//
//   • Connected         — three apps: one never used, one unnamed
//   • SameName          — two apps with one name; the host tells them apart
//   • Empty             — nothing connected
//   • Disconnecting     — one Disconnect in flight, every row locked
//   • DisconnectUnconfirmed — the line names the app and the next action
//   • LoadFailed        — the group's own Retry row

import type { ConnectedApp } from '@declutrmail/shared/contracts';

import { ConnectedAppsGroup } from './connected-apps-section';

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
          'Apps that can act for the person through the MCP connector, each with its own Disconnect.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

const CLAUDE: ConnectedApp = {
  id: '11111111-1111-4111-8111-111111111111',
  appName: 'Claude',
  redirectHosts: ['claude.ai'],
  scopes: ['read', 'cleanup'],
  connectedAt: '2026-11-02T10:00:00.000Z',
  lastUsedAt: '2026-11-16T08:30:00.000Z',
};
const CURSOR: ConnectedApp = {
  id: '22222222-2222-4222-8222-222222222222',
  appName: 'Cursor',
  redirectHosts: ['127.0.0.1'],
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

export const SameName: Story<typeof ConnectedAppsGroup> = {
  args: {
    ...groupArgs,
    state: {
      kind: 'ready',
      apps: [
        CLAUDE,
        {
          ...CLAUDE,
          id: '44444444-4444-4444-8444-444444444444',
          redirectHosts: ['claude.example'],
        },
      ],
    },
  },
};

export const Empty: Story<typeof ConnectedAppsGroup> = {
  args: { ...groupArgs, state: { kind: 'ready', apps: [] } },
};

export const Disconnecting: Story<typeof ConnectedAppsGroup> = {
  args: { ...groupArgs, state: { kind: 'ready', apps: [CLAUDE, CURSOR] }, pendingId: CLAUDE.id },
};

export const DisconnectUnconfirmed: Story<typeof ConnectedAppsGroup> = {
  args: { ...groupArgs, state: { kind: 'ready', apps: [CLAUDE] }, failedAppName: 'Claude' },
};

export const LoadFailed: Story<typeof ConnectedAppsGroup> = {
  args: { ...groupArgs, state: { kind: 'error', onRetry: () => {} } },
};
