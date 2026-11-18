import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ActionPreviewOutcome, ActionPreviewView } from '@declutrmail/shared/contracts';

import { installFetchStub, jsonOk, jsonServerError } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import {
  ConfirmCard,
  ConfirmScreen,
  gmailComposeHref,
  type ConfirmCardState,
  type ConfirmFailure,
} from './confirm-screen';

const ID = '0198d95f-a409-7000-8000-000000000001';
const PATH = `/api/action-previews/${ID}`;
const UNAVAILABLE = 'This request is not available';
const EXPIRED = 'This request expired';
const NEXT_STEP = 'Ask your assistant to prepare it again.';

/** In-flight controls stay focusable: unavailable, not removed from the tab order. */
const unavailable = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true';

const PREVIEW: ActionPreviewView = {
  id: ID,
  verb: 'archive',
  state: 'pending',
  appName: 'Claude',
  mailboxEmail: 'ada@example.com',
  senderCount: 7,
  emailCount: 412,
  senderNames: ['The Shop', 'Daily Deals', 'Travel Club', 'Gadget News', 'Fitness Weekly'],
  olderThanDays: null,
  wakeAt: null,
  expiresAt: '2026-11-18T20:15:00.000Z',
  confirmedAt: null,
  outcome: null,
};

const OUTCOME: ActionPreviewOutcome = {
  appliedSenders: 7,
  requestedEmails: 412,
  actionStatus: 'queued',
  skipped: [],
};

const view = (overrides: Partial<ActionPreviewView> = {}): ActionPreviewView => ({
  ...PREVIEW,
  ...overrides,
});

const applied = (
  outcome: Partial<ActionPreviewOutcome> = {},
  overrides: Partial<ActionPreviewView> = {},
): ActionPreviewView =>
  view({ state: 'applied', outcome: { ...OUTCOME, ...outcome }, ...overrides });

const jsonError = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function renderReady(
  preview: ActionPreviewView = PREVIEW,
  overrides: Partial<Extract<ConfirmCardState, { kind: 'ready' }>> = {},
) {
  return render(
    <ConfirmCard
      state={{
        kind: 'ready',
        preview,
        confirming: false,
        failure: null,
        onConfirm: () => {},
        ...overrides,
      }}
    />,
  );
}

function renderReceipt(preview: ActionPreviewView) {
  return render(<ConfirmCard state={{ kind: 'applied', preview, outcome: preview.outcome! }} />);
}

function renderScreen(handlers: Parameters<typeof installFetchStub>[0], previewId = ID) {
  installFetchStub(handlers);
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <ConfirmScreen previewId={previewId} />
    </QueryWrapper>,
  );
}

const read = (preview: unknown = PREVIEW) => ({
  method: 'GET' as const,
  path: PATH,
  respond: () => jsonOk({ data: preview }),
});

const items = () => screen.getAllByRole('listitem').map((item) => item.textContent);
const bodyText = () => document.body.textContent ?? '';
const occurrences = (needle: string) => bodyText().split(needle).length - 1;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConfirmCard — the request', () => {
  it('shows who asked, which Gmail account, the senders, the count, where email goes and how to undo', () => {
    renderReady();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Archive 7 senders?');
    expect(bodyText()).toContain('Claude asked for this in ada@example.com.');
    expect(items()).toEqual([
      'The Shop',
      'Daily Deals',
      'Travel Club',
      'Gadget News',
      'Fitness Weekly',
      'and 2 more',
      '412 emails in your inbox',
      'Moves out of your inbox, stays in Gmail.',
      'Undo from Activity for 30 days.',
    ]);
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
    // The way out changes nothing: it is a link, not a second request.
    expect(screen.getByRole('link', { name: 'Not now' }).getAttribute('href')).toBe('/home');
  });

  it('says the count, the destination and the undo once each', () => {
    renderReady();
    expect(occurrences('412')).toBe(1);
    expect(occurrences('Moves out of your inbox')).toBe(1);
    expect(occurrences('Undo')).toBe(1);
  });

  it('says when the request expires', () => {
    renderReady();
    const time = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(
      new Date(PREVIEW.expiresAt),
    );
    expect(bodyText()).toContain(`This request expires at ${time}.`);
  });

  it.each([
    ['keep', 'Keep'],
    ['archive', 'Archive'],
    ['unsubscribe', 'Unsubscribe'],
    ['later', 'Later'],
    ['delete', 'Delete'],
  ] as const)('names the %s button with the verb itself', (verb, label) => {
    renderReady(view({ verb, senderCount: 1, senderNames: ['The Shop'] }));
    expect(screen.getByRole('button').textContent).toBe(label);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`${label} 1 sender?`);
  });

  it.each(['keep', 'unsubscribe'] as const)(
    '%s moves no email already here, so it prints no email count',
    (verb) => {
      renderReady(view({ verb, emailCount: 0 }));
      expect(bodyText()).not.toMatch(/\d+ emails?\b/);
      expect(bodyText()).not.toContain('in your inbox');
    },
  );

  it('prints a true zero for a verb that moves email', () => {
    renderReady(view({ verb: 'delete', emailCount: 0 }));
    expect(items()).toContain('0 emails in your inbox');
  });

  it('names the window when only older email is covered', () => {
    renderReady(view({ verb: 'delete', emailCount: 1, olderThanDays: 90 }));
    expect(items()).toContain('1 email in your inbox, older than 90 days');
    expect(items()).toContain('Email in Inbox moves to Gmail Trash.');
  });

  it('says when Later brings the email back', () => {
    const wakeAt = '2026-11-25T09:00:00.000Z';
    renderReady(view({ verb: 'later', wakeAt }));
    const when = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(wakeAt));
    expect(items()).toContain(`Returns to your inbox ${when}.`);
  });

  it('does not invent a name for an app that registered without one', () => {
    renderReady(view({ appName: null }));
    expect(bodyText()).toContain('Unnamed app asked for this in ada@example.com.');
  });

  it('lists no "more" line when every sender is named', () => {
    renderReady(view({ senderCount: 2, senderNames: ['The Shop', 'Daily Deals'] }));
    expect(bodyText()).not.toContain('more');
  });

  it('renders an app name and a sender name as text, never as markup or a link', () => {
    const hostile = '<img src=x onerror=alert(1)><a href="https://evil.example">click</a>';
    const { container } = renderReady(
      view({ appName: hostile, senderCount: 1, senderNames: [hostile] }),
    );
    expect(container.querySelector('img')).toBeNull();
    expect(
      [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href')),
    ).toEqual(['/home']);
    expect(occurrences(hostile)).toBe(2);
  });

  it('a request confirmed earlier that has no result says so, and the verb retries it', () => {
    renderReady(view({ state: 'confirmed' }));
    expect(screen.getByRole('status').textContent).toBe(
      'We could not confirm this started. Press Archive to try again.',
    );
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
  });

  it('locks the button while the confirmation is in flight', () => {
    renderReady(PREVIEW, { confirming: true });
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(unavailable(button)).toBe(true);
    // Still focusable: a native `disabled` would throw focus to <body>.
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Confirming…');
  });

  it('a locked button ignores a second press', () => {
    const onConfirm = vi.fn();
    renderReady(PREVIEW, { confirming: true, onConfirm });
    fireEvent.click(screen.getByRole('button'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it.each([
    ['limit', 'You have reached this month’s limit on your plan. Upgrade to continue.', '/billing'],
    [
      'mailbox',
      'This Gmail account is not connected to DeclutrMail. Reconnect it in Settings.',
      '/settings',
    ],
    ['unsubscribe_off', 'Unsubscribe requests cannot be sent right now. Try again later.', null],
    ['not_started', 'DeclutrMail could not start this. Try again in a minute.', null],
    ['unknown', 'That did not go through. Try again.', null],
  ] as const)(
    'a %s failure gives the cause and the next step, and keeps the request',
    (failure, copy, href) => {
      renderReady(PREVIEW, { failure: failure satisfies ConfirmFailure });
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain(copy);
      // Cause + next step: two sentences, no more.
      expect(copy.split(/(?<=\.)\s/)).toHaveLength(2);
      expect(alert.querySelector('a')?.getAttribute('href') ?? null).toBe(href);
      expect(unavailable(screen.getByRole('button', { name: 'Archive' }))).toBe(false);
    },
  );
});

describe('ConfirmCard — every sender can be seen', () => {
  const NAMES = [
    'Alpha Deals',
    'Beta Books',
    'Gamma Travel',
    'Delta Gadgets',
    'Epsilon Fitness',
    'My Bank',
    'Zeta News',
  ];
  const disclosure = () => document.querySelector('details');
  const open = () => {
    // jsdom does not run the summary's activation behaviour.
    const details = disclosure()!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
  };
  const texts = (root: ParentNode | null) =>
    [...(root?.querySelectorAll('li') ?? [])].map((item) => item.textContent);
  /** The always-visible short list: the sender list outside the disclosure. */
  const shortList = () =>
    [...document.querySelectorAll('ul')].find(
      (list) => !list.closest('details') && list.textContent?.includes(NAMES[0]!),
    ) ?? null;
  const fullList = () => screen.getByRole('region', { name: 'All senders', hidden: true });

  it('lists the first five and offers the rest behind one disclosure', () => {
    renderReady(view({ senderCount: 7, senderNames: NAMES }));
    expect(texts(shortList())).toEqual(NAMES.slice(0, 5));
    expect(disclosure()!.open).toBe(false);
    expect(disclosure()!.querySelector('summary')!.textContent).toBe('Show all 7 senders');
    // The sixth sender is the one a long request could otherwise hide.
    expect(texts(fullList())).toEqual(NAMES);
  });

  it('opening it shows every sender once, in a region the keyboard can scroll', () => {
    renderReady(view({ senderCount: 7, senderNames: NAMES }));
    open();
    expect(shortList()).toBeNull();
    const region = screen.getByRole('region', { name: 'All senders' });
    expect(texts(region)).toEqual(NAMES);
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.style.overflowY).toBe('auto');
    expect(region.style.maxHeight).not.toBe('');
    for (const name of NAMES) expect(occurrences(name), name).toBe(1);
  });

  it('closing it brings the first five back', () => {
    renderReady(view({ senderCount: 7, senderNames: NAMES }));
    open();
    const details = disclosure()!;
    details.open = false;
    fireEvent(details, new Event('toggle'));
    expect(texts(shortList())).toEqual(NAMES.slice(0, 5));
  });

  it('five or fewer senders need no disclosure', () => {
    renderReady(view({ senderCount: 5, senderNames: NAMES.slice(0, 5) }));
    expect(disclosure()).toBeNull();
    expect(items().slice(0, 5)).toEqual(NAMES.slice(0, 5));
  });

  it('keeps the true count when a sender has left the index since', () => {
    renderReady(view({ senderCount: 1_000, senderNames: NAMES }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Archive 1,000 senders?');
    expect(disclosure()!.querySelector('summary')!.textContent).toBe('Show all 1,000 senders');
    expect(texts(fullList())).toEqual([...NAMES, 'and 993 more']);
  });

  it('renders every name in the full list as text', () => {
    const hostile = '<a href="https://evil.example">My Bank</a>';
    const { container } = renderReady(
      view({ senderCount: 6, senderNames: [...NAMES.slice(0, 5), hostile] }),
    );
    expect(texts(fullList())).toContain(hostile);
    expect(container.querySelector('a[href^="https://evil.example"]')).toBeNull();
  });
});

describe('ConfirmCard — states with nothing to press', () => {
  it('a request that is not available names no cause and has no button', () => {
    render(<ConfirmCard state={{ kind: 'unavailable' }} />);
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).toContain(UNAVAILABLE);
    expect(text).toContain(NEXT_STEP);
    // Four different reasons share this answer; the page claims none.
    expect(text).not.toMatch(/expired|disconnected|another/i);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('an expired request says so, differently from one that is not available', () => {
    render(<ConfirmCard state={{ kind: 'expired', confirmedEarlier: false }} />);
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).toContain(EXPIRED);
    expect(text).toContain(NEXT_STEP);
    expect(text).not.toContain(UNAVAILABLE);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a failed load claims no cause it cannot know', () => {
    render(<ConfirmCard state={{ kind: 'error', onRetry: () => {} }} />);
    expect(bodyText()).toContain('Could not load this request');
    expect(bodyText()).not.toMatch(/your connection/i);
  });

  it('loading is announced', () => {
    render(<ConfirmCard state={{ kind: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading request…');
  });
});

describe('ConfirmCard — the receipt', () => {
  it('says what was started, that it is running, and where to see it', () => {
    renderReceipt(applied());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Confirmed');
    expect(screen.getByRole('status').textContent).toBe(
      'Archive started for 7 senders. It covers 412 emails. It is running now.',
    );
    expect(screen.getByRole('link', { name: 'Open Activity' }).getAttribute('href')).toBe(
      '/activity',
    );
    expect(bodyText()).toContain('You can go back to your assistant.');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says it has finished only when the server says so', () => {
    renderReceipt(applied({ actionStatus: 'done' }));
    expect(screen.getByRole('status').textContent).toContain('It has finished.');
    expect(screen.getByRole('status').textContent).not.toContain('running');
  });

  it('Keep records a decision: no email count and no progress line', () => {
    renderReceipt(
      applied(
        { appliedSenders: 2, requestedEmails: 0, actionStatus: null },
        { verb: 'keep', senderCount: 2 },
      ),
    );
    expect(screen.getByRole('status').textContent).toBe('Keep recorded for 2 senders.');
  });

  it('a failed job is never shown as a receipt', () => {
    renderReceipt(applied({ actionStatus: 'failed' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('This did not complete');
    expect(bodyText()).not.toContain('Confirmed');
    expect(bodyText()).not.toMatch(/started for|running|finished/);
    expect(screen.getByRole('alert').textContent).toContain(NEXT_STEP);
    expect(screen.getByRole('link', { name: 'Open Activity' })).toBeTruthy();
  });

  it('names each skipped sender with its reason', () => {
    renderReceipt(
      applied({
        appliedSenders: 2,
        skipped: [
          { senderId: 's1', name: 'My Bank', reason: 'protected', composeUrl: null },
          { senderId: 's2', name: null, reason: 'not_found', composeUrl: null },
          { senderId: 's3', name: 'Busy Co', reason: 'in_progress', composeUrl: null },
          { senderId: 's4', name: 'Plain Corp', reason: 'no_channel', composeUrl: null },
          { senderId: 's5', name: 'New Corp', reason: 'unknown', composeUrl: null },
        ],
      }),
    );
    expect(screen.getByRole('status').textContent).toContain('Archive started for 2 of 7 senders.');
    expect(items()).toEqual([
      'My Bank: Protected, so it was skipped.',
      'A sender no longer listed: No longer in this Gmail account.',
      'Busy Co: Another change is already running for it.',
      'Plain Corp: Offers no unsubscribe link.',
      'New Corp: Not checked for an unsubscribe link yet.',
    ]);
  });

  it('says so when nothing was started for any sender', () => {
    renderReceipt(
      applied(
        {
          appliedSenders: 0,
          requestedEmails: 0,
          actionStatus: null,
          skipped: [{ senderId: 's1', name: 'My Bank', reason: 'protected', composeUrl: null }],
        },
        { verb: 'delete', senderCount: 1, senderNames: ['My Bank'] },
      ),
    );
    expect(screen.getByRole('status').textContent).toBe('Delete was not started for any sender.');
  });

  it('a mailto sender gets a Gmail draft link the person sends', () => {
    const composeUrl =
      'https://mail.google.com/mail/?authuser=ada%40example.com&view=cm&fs=1&to=leave%40club.example';
    renderReceipt(
      applied(
        {
          appliedSenders: 0,
          requestedEmails: 0,
          actionStatus: null,
          skipped: [{ senderId: 's1', name: 'The Club', reason: 'mailto', composeUrl }],
        },
        { verb: 'unsubscribe', senderCount: 1 },
      ),
    );
    const link = screen.getByRole('link', { name: 'Open Gmail draft' });
    expect(link.getAttribute('href')).toBe(composeUrl);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(items()).toEqual([
      'The Club: Unsubscribes by email. Send the draft from Gmail. Open Gmail draft',
    ]);
  });

  it.each([
    ['another site', 'https://evil.example/mail/?view=cm'],
    ['a script URL', 'javascript:alert(1)'],
    ['a look-alike host', 'https://mail.google.com.evil.example/mail/'],
    ['plain http', 'http://mail.google.com/mail/?view=cm'],
  ])('never turns %s into something to press', (_label, composeUrl) => {
    renderReceipt(
      applied({
        skipped: [{ senderId: 's1', name: 'The Club', reason: 'mailto', composeUrl }],
      }),
    );
    expect(screen.queryByRole('link', { name: 'Open Gmail draft' })).toBeNull();
    expect(
      [...document.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href')),
    ).toEqual(['/activity']);
  });

  it('a compose link on a sender skipped for another reason is not shown', () => {
    renderReceipt(
      applied({
        skipped: [
          {
            senderId: 's1',
            name: 'My Bank',
            reason: 'protected',
            composeUrl: 'https://mail.google.com/mail/?view=cm&to=x%40y.example',
          },
        ],
      }),
    );
    expect(screen.queryByRole('link', { name: 'Open Gmail draft' })).toBeNull();
  });
});

describe('gmailComposeHref', () => {
  it('accepts only an https Gmail URL', () => {
    expect(gmailComposeHref('https://mail.google.com/mail/?view=cm&to=a%40b.example')).toBe(
      'https://mail.google.com/mail/?view=cm&to=a%40b.example',
    );
  });

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['a relative path', '/mail/?view=cm'],
    ['another host', 'https://evil.example/mail/'],
    ['a look-alike host', 'https://mail.google.com.evil.example/'],
    ['userinfo before the host', 'https://mail.google.com@evil.example/'],
    ['credentials on the Gmail host', 'https://user:pass@mail.google.com/mail/'],
    ['a username on the Gmail host', 'https://user@mail.google.com/mail/'],
    ['a password on the Gmail host', 'https://:pass@mail.google.com/mail/'],
    ['another Google host', 'https://accounts.google.com/'],
    ['plain http', 'http://mail.google.com/mail/'],
    ['another port', 'https://mail.google.com:8443/mail/'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['mailto:', 'mailto:leave@club.example'],
  ])('refuses %s', (_label, url) => {
    expect(gmailComposeHref(url)).toBeNull();
  });
});

describe('ConfirmScreen', () => {
  it('loads the request named in the URL and shows it', async () => {
    renderScreen([read()]);
    expect(await screen.findByRole('button', { name: 'Archive' })).toBeTruthy();
    expect(bodyText()).toContain('Claude asked for this in ada@example.com.');
  });

  it.each([
    ['a made-up id', 'not-a-preview-id'],
    ['a path traversal', '..%2F..%2Fauth%2Flogout'],
    ['an empty id', ''],
  ])('%s is not available and reads nothing', async (_label, previewId) => {
    let calls = 0;
    renderScreen(
      [
        {
          method: 'GET',
          path: /.*/,
          respond: () => {
            calls += 1;
            return jsonOk({ data: PREVIEW });
          },
        },
      ],
      previewId,
    );
    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    expect(calls).toBe(0);
  });

  it.each([
    ['another person’s request (404)', 'PREVIEW_NOT_FOUND'],
    ['the connector switched off (404)', 'NOT_FOUND'],
  ])('%s is not available and is not retried', async (_label, code) => {
    let calls = 0;
    renderScreen([
      {
        method: 'GET',
        path: PATH,
        respond: () => {
          calls += 1;
          return jsonError(404, code);
        },
      },
    ]);
    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1);
    expect(screen.queryByText(EXPIRED)).toBeNull();
  });

  it('a request that expired before the page opened says expired, not unavailable', async () => {
    renderScreen([read(view({ state: 'expired' }))]);
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a request that was confirmed but expired unrecorded points at Activity, not at "prepare it again" alone', async () => {
    renderScreen([read(view({ state: 'expired', confirmedAt: '2026-11-18T20:05:00.000Z' }))]);
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
    expect(
      screen.getByText(/It was confirmed, but DeclutrMail has no record that it started/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Activity' }).getAttribute('href')).toBe(
      '/activity',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('an expired request nobody confirmed does not mention Activity', async () => {
    renderScreen([read(view({ state: 'expired' }))]);
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open Activity' })).toBeNull();
    expect(screen.queryByText(/It was confirmed/)).toBeNull();
  });

  it('a signed-out visitor keeps the loading line while sign-in takes over', async () => {
    let calls = 0;
    renderScreen([
      {
        method: 'GET',
        path: PATH,
        respond: () => {
          calls += 1;
          return jsonError(401, 'UNAUTHORIZED');
        },
      },
      // The client tries one refresh before giving up on the session.
      { method: 'POST', path: '/api/auth/refresh', respond: () => jsonError(401, 'UNAUTHORIZED') },
    ]);
    await waitFor(() => expect(calls).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByRole('status').textContent).toBe('Loading request…');
    expect(screen.queryByText('Could not load this request')).toBeNull();
  });

  it('a server error offers Try again and recovers', async () => {
    let healthy = false;
    renderScreen([
      {
        method: 'GET',
        path: PATH,
        respond: () => (healthy ? jsonOk({ data: PREVIEW }) : jsonServerError()),
      },
    ]);
    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 5_000 });
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    healthy = true;
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: 'Archive' })).toBeTruthy();
  });

  it('refuses a body it cannot read rather than showing a half-filled request', async () => {
    renderScreen([read({ ...PREVIEW, verb: 'unprotect' })]);
    expect(
      await screen.findByRole('button', { name: 'Try again' }, { timeout: 5_000 }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'unprotect' })).toBeNull();
  });

  it('pressing the verb confirms once and shows what the server recorded', async () => {
    const posted: string[] = [];
    renderScreen([
      read(),
      {
        method: 'POST',
        path: `${PATH}/confirm`,
        respond: (_req, url) => {
          posted.push(url.pathname);
          return jsonOk({ data: applied() });
        },
      },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    expect(await screen.findByRole('heading', { name: 'Confirmed' })).toBeTruthy();
    expect(posted).toEqual([`${PATH}/confirm`]);
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('a second and third press while the first is in flight send nothing more', async () => {
    let posts = 0;
    let release: (response: Response) => void = () => {};
    renderScreen([
      read(),
      {
        method: 'POST',
        path: `${PATH}/confirm`,
        respond: () => {
          posts += 1;
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        },
      },
    ]);
    const button = await screen.findByRole('button', { name: 'Archive' });
    fireEvent.click(button);
    await waitFor(() => expect(posts).toBe(1));
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts).toBe(1);
    release(jsonOk({ data: applied() }));
    expect(await screen.findByRole('heading', { name: 'Confirmed' })).toBeTruthy();
    expect(posts).toBe(1);
  });

  it('a request already applied opens on its receipt, with nothing to press', async () => {
    renderScreen([read(applied({ actionStatus: 'done' }))]);
    expect(await screen.findByRole('heading', { name: 'Confirmed' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a request that expired between load and the press becomes the expired state', async () => {
    renderScreen([
      read(),
      {
        method: 'POST',
        path: `${PATH}/confirm`,
        respond: () => jsonError(410, 'PREVIEW_EXPIRED'),
      },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a request whose app was disconnected between load and the press is not available', async () => {
    renderScreen([
      read(),
      {
        method: 'POST',
        path: `${PATH}/confirm`,
        respond: () => jsonError(404, 'PREVIEW_NOT_FOUND'),
      },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByText(EXPIRED)).toBeNull();
  });

  it.each([
    [402, 'FREE_CAP_REACHED', 'You have reached this month’s limit on your plan.', '/billing'],
    [409, 'NO_ACTIVE_MAILBOX', 'This Gmail account is not connected to DeclutrMail.', '/settings'],
    [409, 'UNSUB_SEND_DISABLED', 'Unsubscribe requests cannot be sent right now.', null],
    [503, 'QUEUE_UNAVAILABLE', 'DeclutrMail could not start this.', null],
    [500, 'INTERNAL_ERROR', 'That did not go through.', null],
    // A 409 with a code this page does not know is not a mailbox problem.
    [409, 'SOMETHING_NEW', 'That did not go through.', null],
  ] as const)(
    'a %i %s on confirm keeps the request and says why',
    async (status, code, copy, href) => {
      renderScreen([
        read(),
        { method: 'POST', path: `${PATH}/confirm`, respond: () => jsonError(status, code) },
      ]);
      fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(copy);
      expect(alert.querySelector('a')?.getAttribute('href') ?? null).toBe(href);
      expect(screen.queryByText('Confirmed')).toBeNull();
      expect(unavailable(screen.getByRole('button', { name: 'Archive' }))).toBe(false);
    },
  );

  it('pressing again after a failure retries and reaches the receipt', async () => {
    let attempt = 0;
    renderScreen([
      read(),
      {
        method: 'POST',
        path: `${PATH}/confirm`,
        respond: () => {
          attempt += 1;
          return attempt === 1 ? jsonError(503, 'QUEUE_UNAVAILABLE') : jsonOk({ data: applied() });
        },
      },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByRole('heading', { name: 'Confirmed' })).toBeTruthy();
    expect(attempt).toBe(2);
  });

  it('refuses a confirmation answer it cannot read rather than showing a receipt', async () => {
    renderScreen([
      read(),
      {
        method: 'POST',
        path: `${PATH}/confirm`,
        respond: () => jsonOk({ data: { state: 'applied' } }),
      },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    expect((await screen.findByRole('alert')).textContent).toContain('That did not go through.');
    expect(screen.queryByText('Confirmed')).toBeNull();
  });
});
