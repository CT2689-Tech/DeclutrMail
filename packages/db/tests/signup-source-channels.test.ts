import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { freshTestPglite } from '../src/testing';
const forward = readFileSync(
  new URL('../migrations/0099_signup_source_channels.sql', import.meta.url),
  'utf8',
);
const rollback = readFileSync(
  new URL('../migrations/0099_signup_source_channels.rollback', import.meta.url),
  'utf8',
);
const W = '11111111-1111-4111-8111-111111111111';
async function seed(
  pg: Awaited<ReturnType<typeof freshTestPglite>>,
  userChoice = 'friend',
  paidChoice = 'friend',
) {
  await pg.query('INSERT INTO workspaces(id,name) VALUES ($1,$2)', [W, 'synthetic']);
  await pg.query(
    'INSERT INTO users(workspace_id,email,signup_attribution_heard_from) VALUES ($1,$2,$3)',
    [W, 'synthetic@example.test', userChoice],
  );
  await pg.query(
    "INSERT INTO subscriptions(workspace_id,provider,provider_subscription_id,tier,status,provider_price_id,billing_cycle,signup_attribution_heard_from) VALUES ($1,'paddle','sub_synthetic','plus','active','pri_synthetic','monthly',$2)",
    [W, paidChoice],
  );
}
describe('source choice migration', () => {
  it('accepts new choices in user and paid attribution while keeping tracked-ref validation', async () => {
    const pg = await freshTestPglite();
    await seed(pg);
    for (const channel of ['google', 'ai_assistant', 'youtube', 'instagram', 'tiktok']) {
      await pg.query('UPDATE users SET signup_attribution_heard_from=$1', [channel]);
      await pg.query('UPDATE subscriptions SET signup_attribution_heard_from=$1', [channel]);
    }
    await expect(pg.exec("UPDATE users SET signup_attribution_ref='google'")).rejects.toThrow();
    await expect(
      pg.exec("UPDATE users SET signup_attribution_heard_from='junk'"),
    ).rejects.toThrow();
  });
  it.each([
    ['google', 'friend'],
    ['friend', 'youtube'],
  ])('refuses rollback with retained new answers (%s/%s)', async (user, paid) => {
    const pg = await freshTestPglite();
    await seed(pg, user, paid);
    await expect(pg.exec(rollback)).rejects.toThrow('Retained new source answers');
    await pg.exec('ROLLBACK');
    expect(
      (await pg.query<{ v: string }>('SELECT signup_attribution_heard_from AS v FROM users'))
        .rows[0]?.v,
    ).toBe(user);
    expect(
      (
        await pg.query<{ v: string }>(
          'SELECT signup_attribution_heard_from AS v FROM subscriptions',
        )
      ).rows[0]?.v,
    ).toBe(paid);
  });
  it('rolls back and reapplies without relabeling legacy answers', async () => {
    const pg = await freshTestPglite();
    await seed(pg);
    await pg.exec(rollback);
    await expect(
      pg.exec("UPDATE users SET signup_attribution_heard_from='google'"),
    ).rejects.toThrow();
    expect(
      (await pg.query<{ v: string }>('SELECT signup_attribution_heard_from AS v FROM users'))
        .rows[0]?.v,
    ).toBe('friend');
    await pg.exec(forward);
    await pg.exec("UPDATE users SET signup_attribution_heard_from='google'");
  });
});
