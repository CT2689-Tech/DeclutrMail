import { beforeAll, describe, expect, it } from 'vitest';

import { UnsubscribeController } from './unsubscribe.controller.js';
import { signUnsubscribeToken } from './unsubscribe-token.js';

describe('UnsubscribeController', () => {
  beforeAll(() => {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'y'.repeat(32);
  });

  function build() {
    const updates: unknown[] = [];
    const db = {
      update: () => ({ set: (v: unknown) => ({ where: async () => void updates.push(v) }) }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ preferences: { emailPrefs: {} } }] }),
        }),
      }),
    };
    return { controller: new UnsubscribeController(db as never), updates };
  }

  it('flips the category off for a valid token', async () => {
    const { controller, updates } = build();
    const token = await signUnsubscribeToken({ userId: 'u-1', category: 'reminders' });
    const res = await controller.unsubscribe(token);
    expect(res.status).toBe('ok');
    expect(JSON.stringify(updates)).toContain('"reminders":false');
  });

  it('returns 200 for an invalid token and writes nothing', async () => {
    const { controller, updates } = build();
    const res = await controller.unsubscribe('garbage');
    expect(res.status).toBe('ok');
    expect(updates).toHaveLength(0);
  });

  it('returns 200 for a missing token and writes nothing', async () => {
    const { controller, updates } = build();
    const res = await controller.unsubscribe(undefined);
    expect(res.status).toBe('ok');
    expect(updates).toHaveLength(0);
  });

  it('GET never mutates, even with a perfectly valid token', async () => {
    const { controller, updates } = build();
    const token = await signUnsubscribeToken({ userId: 'u-1', category: 'reminders' });
    const html = await controller.confirmPage(token);
    // Link prefetchers (Outlook Safe Links, malware scanners) issue this
    // GET without any human involved. If it mutated, a scanner would
    // unsubscribe users from mail they never opened.
    expect(updates).toHaveLength(0);
    expect(html).toContain('<form method="POST"');
    expect(html).toContain('Unsubscribe');
  });

  it('GET escapes the token into the form action', async () => {
    const { controller } = build();
    const html = await controller.confirmPage('a"><script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&quot;');
  });
});
