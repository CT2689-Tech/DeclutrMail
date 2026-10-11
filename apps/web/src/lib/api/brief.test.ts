import { afterEach, describe, expect, it } from 'vitest';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

import { fetchBriefToday } from './brief';

afterEach(() => resetFetchStub());

describe('fetchBriefToday', () => {
  it('treats 404 as no edition', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () =>
          new Response(JSON.stringify({ message: 'Brief not found for today.' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);
    await expect(fetchBriefToday()).resolves.toEqual({ data: null });
  });

  it('treats 204 as no edition', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => new Response(null, { status: 204 }),
      },
    ]);
    await expect(fetchBriefToday()).resolves.toEqual({ data: null });
  });

  it('treats a null body as no edition', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonOk({ data: null }),
      },
    ]);
    await expect(fetchBriefToday()).resolves.toEqual({ data: null });
  });

  it('defaults a missing noise list on a real edition', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () =>
          jsonOk({
            data: {
              id: '11111111-1111-1111-1111-111111111111',
              runDateLocal: '2026-05-24',
              generatedBy: 'template',
              briefPayload: { narrative: '', reply: [], fyi: [], noise: [] },
              generatedAt: '2026-05-25T08:00:00Z',
              openedAt: null,
              emailSentAt: null,
              feedbackRating: null,
            },
          }),
      },
    ]);
    const envelope = await fetchBriefToday();
    expect(envelope.data?.noiseSenders).toEqual([]);
  });
});
