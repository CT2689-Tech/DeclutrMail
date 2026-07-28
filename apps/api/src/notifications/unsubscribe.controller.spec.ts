import { beforeAll, describe, expect, it } from 'vitest';

import { UnsubscribeController } from './unsubscribe.controller.js';
import { signUnsubscribeToken } from './unsubscribe-token.js';

describe('UnsubscribeController', () => {
  beforeAll(() => {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'y'.repeat(32);
  });

  function build(preferences: unknown = { emailPrefs: {} }) {
    const updates: unknown[] = [];
    const db = {
      update: () => ({ set: (v: unknown) => ({ where: async () => void updates.push(v) }) }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ preferences }] }),
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

  it('never resurrects an existing opt-out — only narrows', async () => {
    // The user already opted out of reminders. Unsubscribing from
    // syncComplete must NOT flip reminders back on — an unauthenticated
    // endpoint may only ever turn preferences OFF.
    const { controller, updates } = build({ emailPrefs: { reminders: false } });
    const token = await signUnsubscribeToken({ userId: 'u-1', category: 'syncComplete' });
    await controller.unsubscribe(token);
    const written = JSON.stringify(updates);
    expect(written).toContain('"syncComplete":false');
    expect(written).toContain('"reminders":false');
    expect(written).not.toContain('"reminders":true');
  });

  it('preserves stored keys it does not recognise', async () => {
    // A bag written by a future release (or a corrupted one) must pass
    // through untouched apart from the single flipped category —
    // materialising today's defaults over it would erase choices.
    const { controller, updates } = build({
      profilePreset: 'calm',
      emailPrefs: { reminders: false, futureCategory: true },
    });
    const token = await signUnsubscribeToken({ userId: 'u-1', category: 'syncComplete' });
    await controller.unsubscribe(token);
    const written = JSON.stringify(updates);
    expect(written).toContain('"futureCategory":true');
    expect(written).toContain('"reminders":false');
    expect(written).toContain('"profilePreset":"calm"');
    expect(written).toContain('"syncComplete":false');
  });

  it('GET escapes the token into the form action', async () => {
    const { controller } = build();
    const html = await controller.confirmPage('a"><script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&quot;');
  });
});
