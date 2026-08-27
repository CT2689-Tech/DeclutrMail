import { describe, expect, it } from 'vitest';

import { subscriptions, users, workspaces } from '../src';
import { freshTestDb } from '../src/testing';

describe('signup attribution constraints', () => {
  it('requires detail exactly when self-report is other', async () => {
    const db = await freshTestDb();
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Attribution constraints' })
      .returning({ id: workspaces.id });
    const workspaceId = workspace!.id;

    await expect(
      db.insert(users).values({
        workspaceId,
        email: 'missing-detail@example.test',
        signupAttributionHeardFrom: 'other',
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(users).values({
        workspaceId,
        email: 'unexpected-detail@example.test',
        signupAttributionHeardFrom: 'hn',
        signupAttributionHeardDetail: 'should not be stored',
      }),
    ).rejects.toThrow();

    await db.insert(users).values({
      workspaceId,
      email: 'valid-other@example.test',
      signupAttributionHeardFrom: 'other',
      signupAttributionHeardDetail: 'Newsletter',
    });

    await expect(
      db.insert(subscriptions).values({
        workspaceId,
        provider: 'paddle',
        providerSubscriptionId: 'sub_missing_detail',
        tier: 'plus',
        status: 'active',
        providerPriceId: 'pri_test',
        billingCycle: 'monthly',
        signupAttributionHeardFrom: 'other',
      }),
    ).rejects.toThrow();
  });
});
