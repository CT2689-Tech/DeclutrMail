import { users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { EmailRaceLostError, UsersService } from './users.service.js';

describe('signup campaign columns', () => {
  it('copies first-touch campaign fields only onto a new user', async () => {
    const db = await freshTestDb();
    const service = new UsersService(db as never);
    const created = await db.transaction((tx) =>
      service.insertWorkspaceAndUser(tx as never, 'ada@example.com', 'hn', {
        utmSource: 'hn',
        utmMedium: 'social',
        utmCampaign: 'launch',
        landingPath: '/pricing',
      }),
    );
    const [row] = await db.select().from(users).where(eq(users.id, created.userId));
    expect(row).toMatchObject({
      signupAttributionRef: 'hn',
      signupAttributionUtmSource: 'hn',
      signupAttributionUtmMedium: 'social',
      signupAttributionUtmCampaign: 'launch',
      signupAttributionLandingPath: '/pricing',
    });

    await expect(
      db.transaction((tx) =>
        service.insertWorkspaceAndUser(tx as never, 'ada@example.com', undefined, {
          utmSource: 'google',
          landingPath: '/later',
        }),
      ),
    ).rejects.toBeInstanceOf(EmailRaceLostError);
    const [again] = await db.select().from(users).where(eq(users.id, created.userId));
    expect(again?.signupAttributionUtmSource).toBe('hn');
    expect(again?.signupAttributionLandingPath).toBe('/pricing');
  });

  it('omits a campaign value the column check would reject', async () => {
    const db = await freshTestDb();
    const service = new UsersService(db as never);
    const created = await db.transaction((tx) =>
      service.insertWorkspaceAndUser(tx as never, 'bob@example.com', undefined, {
        utmSource: 'a@b.com',
        landingPath: '/pricing?x=1',
      }),
    );
    const [row] = await db.select().from(users).where(eq(users.id, created.userId));
    expect(row?.signupAttributionUtmSource).toBeNull();
    expect(row?.signupAttributionLandingPath).toBeNull();
  });
});
