// apps/api/src/waitlist/waitlist.service.ts — waitlist capture writes
// (D19 pricing page Team row + marketing forms).
//
// One job: idempotent insert into `waitlist`. Dedupe is
// `ON CONFLICT DO NOTHING` with no target, so it matches whichever
// unique constraint is present. A duplicate submit is indistinguishable
// from a fresh one at the HTTP layer (no email-exists oracle — the
// controller returns the same 202 either way).

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { users, waitlist } from '@declutrmail/db';
import type { WaitlistJoinRequest, WaitlistV1JoinRequest } from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { classifyProvider, type ProviderClass } from './provider-classifier.js';

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
      .onConflictDoNothing()
      .returning({ id: waitlist.id });

    // Privacy (D7): never log the address — attribution + outcome only.
    this.logger.log(
      `waitlist.join source=${safeSource(input.source)} tierInterest=${input.tierInterest ?? 'none'} duplicate=${inserted.length === 0}`,
    );
  }

  /**
   * Pro or provider waitlist. Idempotent on (email, tier, provider).
   * Never logs the address. A provider signup always classifies so the
   * growth event can carry `provider_class`. The stored provider stays
   * the visitor's pick when they made one.
   */
  async joinLaunch(
    input: WaitlistV1JoinRequest,
    userId?: string,
  ): Promise<{ status: 'joined' | 'already_joined'; providerClass: ProviderClass | null }> {
    const email = await this.resolveEmail(input.email, userId);
    const tier = input.kind === 'pro' ? 'pro' : null;
    let provider: string | null = null;
    let providerClass: ProviderClass | null = null;
    if (input.kind === 'provider') {
      providerClass = await classifyProvider(email);
      provider = input.provider ?? providerClass;
    }
    const status = await this.insertLaunchRow(email, tier, provider, input);
    this.logger.log(
      `waitlist.v1 kind=${input.kind} source=${safeSource(input.source)} status=${status} providerPicked=${Boolean(input.provider)}`,
    );
    return { status, providerClass };
  }

  private async resolveEmail(
    email: string | undefined,
    userId: string | undefined,
  ): Promise<string> {
    if (email) return email;
    if (!userId) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Email is required.',
      });
    }
    const [row] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Email is required.',
      });
    }
    return row.email;
  }

  private async insertLaunchRow(
    email: string,
    tier: string | null,
    provider: string | null,
    input: WaitlistV1JoinRequest,
  ): Promise<'joined' | 'already_joined'> {
    const existing = await this.findLaunchRow(email, tier, provider);
    if (existing) return 'already_joined';
    try {
      await this.db.insert(waitlist).values({
        email,
        tier,
        provider,
        source: input.source,
        wouldPay: input.wouldPay ?? null,
        contactOptIn: input.contactOptIn ?? false,
      });
      return 'joined';
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const filled = await this.fillEmptyLaunchRow(email, tier, provider, input);
      return filled ? 'joined' : 'already_joined';
    }
  }

  private async findLaunchRow(
    email: string,
    tier: string | null,
    provider: string | null,
  ): Promise<{ id: string } | undefined> {
    const [row] = await this.db
      .select({ id: waitlist.id })
      .from(waitlist)
      .where(
        and(
          eq(waitlist.email, email),
          sql`coalesce(${waitlist.tier}, '') = ${tier ?? ''}`,
          sql`coalesce(${waitlist.provider}, '') = ${provider ?? ''}`,
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * A unique violation on the composite key means this kind is already
   * stored. An older empty row (no tier, no provider) can still be filled.
   */
  private async fillEmptyLaunchRow(
    email: string,
    tier: string | null,
    provider: string | null,
    input: WaitlistV1JoinRequest,
  ): Promise<boolean> {
    const updated = await this.db
      .update(waitlist)
      .set({
        tier,
        provider,
        ...(input.wouldPay !== undefined ? { wouldPay: input.wouldPay } : {}),
        ...(input.contactOptIn ? { contactOptIn: true } : {}),
      })
      .where(
        and(
          eq(waitlist.email, email),
          sql`${waitlist.tier} is null`,
          sql`${waitlist.provider} is null`,
        ),
      )
      .returning({ id: waitlist.id });
    return updated.length > 0;
  }
}

function safeSource(source: string): string {
  return source.includes('@') ? 'redacted' : source;
}

function isUniqueViolation(err: unknown): boolean {
  type PgErr = { code?: string; cause?: PgErr };
  const e = err as PgErr;
  return e?.code === '23505' || e?.cause?.code === '23505';
}
