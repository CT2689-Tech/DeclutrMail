import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { freshTestPglite } from '../src/testing/index.js';

const rollback = readFileSync(
  new URL('../migrations/0098_billing_checkout_attempts.rollback', import.meta.url),
  'utf8',
);
describe('checkout evidence migration safety', () => {
  it('keeps retained billing metadata behind server-only RLS', async () => {
    const pg = await freshTestPglite();
    expect(
      (
        await pg.query<{ relrowsecurity: boolean }>(
          "SELECT relrowsecurity FROM pg_class WHERE oid='billing_checkout_attempts'::regclass",
        )
      ).rows,
    ).toEqual([{ relrowsecurity: true }]);
    expect(
      (await pg.query("SELECT * FROM pg_policies WHERE tablename='billing_checkout_attempts'"))
        .rows,
    ).toEqual([]);
  });
  it('refuses populated rollback and preserves purchase evidence', async () => {
    const pg = await freshTestPglite();
    await pg.exec(
      "INSERT INTO workspaces(id,name) VALUES ('11111111-1111-4111-8111-111111111111','synthetic'); INSERT INTO billing_checkout_attempts(id,workspace_id,tier,cycle,provider_price_id,currency_code) VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','plus','annual','pri_test','USD');",
    );
    await expect(pg.exec(rollback)).rejects.toThrow('Retained checkout attempts');
    await pg.exec('ROLLBACK');
    expect(
      (
        await pg.query<{ n: number }>(
          'SELECT count(*)::integer AS n FROM billing_checkout_attempts',
        )
      ).rows[0]?.n,
    ).toBe(1);
  });
});
