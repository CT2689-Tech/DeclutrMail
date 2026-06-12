// apps/api/src/waitlist/waitlist.service.ts — waitlist capture writes
// (D19 pricing page Team row + marketing forms).
//
// One job: idempotent insert into `waitlist`. Dedupe rides the citext
// unique index on `email` via `ON CONFLICT DO NOTHING`, so a duplicate
// submit is indistinguishable from a fresh one at the HTTP layer (no
// email-exists oracle — the controller returns the same 202 either way).

import { Inject, Injectable, Logger } from '@nestjs/common';

import { waitlist } from '@declutrmail/db';
import type { WaitlistJoinRequest } from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Insert the signup; silently keep the existing row on a duplicate
   * email (citext — case never creates a second row). Never throws on
   * conflict; infra failures DO propagate so the caller returns a real
   * 5xx instead of a fake 202.
   */
  async join(input: WaitlistJoinRequest): Promise<void> {
    const inserted = await this.db
      .insert(waitlist)
      .values({
        email: input.email,
        tierInterest: input.tierInterest ?? null,
        source: input.source,
      })
      .onConflictDoNothing({ target: waitlist.email })
      .returning({ id: waitlist.id });

    // Privacy (D7): never log the address — attribution + outcome only.
    this.logger.log(
      `waitlist.join source=${input.source} tierInterest=${input.tierInterest ?? 'none'} duplicate=${inserted.length === 0}`,
    );
  }
}
