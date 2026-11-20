// Storybook CSF3 stories for the MCP connector's consent page
// (`/connect/authorize`, ADR-0048, docs/spec/mcp-connector.md §4). Local
// CSF shims per the existing stories pattern; the card is presentational.
//
//   • Ready             — app, redirect host, both scopes, two accounts
//   • ReadOnly          — only the requested scope is listed
//   • NoMailbox         — no Gmail account connected yet
//   • UnnamedLongHost   — unnamed app, a long redirect host wraps
//   • Approving · Denying — both buttons locked while the decision posts
//   • DeletionPending   — approve refused: account deletion scheduled
//   • DecisionFailed    — the decision did not go through; both stay open
//   • Loading · Gone · LoadFailed · Returning

import type { ConnectorConsent } from '@declutrmail/shared/contracts';

import { ConsentCard, type ConsentCardState } from './consent-screen';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
};

const meta: StoryMeta<typeof ConsentCard> = {
  title: 'Connect/ConsentCard',
  component: ConsentCard,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Where a person decides whether an app may act for them: the app, the host it returns to, what it may do, and which Gmail accounts it reaches.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

const CONSENT: ConnectorConsent = {
  appName: 'Claude',
  redirectHost: 'claude.ai',
  scopes: ['read', 'cleanup'],
  mailboxes: ['ada@example.com', 'ada.work@example.com'],
  signedInAs: 'ada@example.com',
  blocked: null,
};

const ready = (
  consent: ConnectorConsent,
  overrides: Partial<Extract<ConsentCardState, { kind: 'ready' }>> = {},
): Story<typeof ConsentCard> => ({
  args: {
    state: {
      kind: 'ready',
      consent,
      deciding: null,
      decisionError: null,
      onApprove: () => {},
      onDeny: () => {},
      onSwitchAccount: () => {},
      switching: false,
      ...overrides,
    },
  },
});

export const Ready = ready(CONSENT);
export const ReadOnly = ready({ ...CONSENT, scopes: ['read'] });
export const NoMailbox = ready({ ...CONSENT, mailboxes: [] });
export const UnnamedLongHost = ready({
  ...CONSENT,
  appName: null,
  redirectHost: 'a-very-long-subdomain.of-an-unfamiliar-application.example.com:8443',
});
export const Approving = ready(CONSENT, { deciding: 'approve' });
export const Denying = ready(CONSENT, { deciding: 'deny' });
export const DeletionPending = ready({ ...CONSENT, blocked: 'deletion_pending' });
export const NotAvailable = ready({
  ...CONSENT,
  signedInAs: 'grace@example.com',
  blocked: 'not_available',
});
export const Switching = ready(CONSENT, { switching: true });
export const DecisionFailed = ready(CONSENT, {
  decisionError: 'That did not go through. Try again.',
});
export const Loading: Story<typeof ConsentCard> = { args: { state: { kind: 'loading' } } };
export const Gone: Story<typeof ConsentCard> = { args: { state: { kind: 'gone' } } };
export const LoadFailed: Story<typeof ConsentCard> = {
  args: { state: { kind: 'error', onRetry: () => {} } },
};
export const Returning: Story<typeof ConsentCard> = {
  args: { state: { kind: 'returning', redirectHost: 'claude.ai' } },
};
