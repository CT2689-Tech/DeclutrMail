import { afterEach, describe, expect, it } from 'vitest';
import { fetchRuleSenders } from './autopilot-sender-rules';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

describe('sender rule search wire contract', () => {
  afterEach(resetFetchStub);

  it('sends the controller search parameter and cursor in the mailbox scope', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/autopilot/senders',
        respond: (request, url) => {
          expect(url.searchParams.get('q')).toBe('weekly@synthetic.invalid');
          expect(url.searchParams.has('query')).toBe(false);
          expect(url.searchParams.get('cursor')).toBe('next-page');
          expect(request.headers.get('x-active-mailbox-id')).toBe('mailbox-test');
          return jsonOk({ data: { senders: [], nextCursor: null }, meta: {} });
        },
      },
    ]);
    await expect(
      fetchRuleSenders(
        'weekly@synthetic.invalid',
        'next-page',
        new AbortController().signal,
        'mailbox-test',
      ),
    ).resolves.toEqual({ senders: [], nextCursor: null });
  });
});
