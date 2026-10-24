import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, lt } from 'drizzle-orm';

import { nativeAuthTickets, type NativeAuthTicket } from '@declutrmail/db';
import {
  NATIVE_HANDOFF_TTL_MS,
  NATIVE_START_TICKET_TTL_MS,
  nativeConnectTicketRequestSchema,
  type NativeConnectTicketRequest,
} from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

type TicketKind = 'handoff' | 'connect_start';

/** SHA-256 hex. The database holds this, never the code that hashes to it. */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Native sign-in tickets (ADR-0049).
 *
 * A ticket is a one-time code that moves a decision between the system
 * browser and the app shell, which share no cookies. Each code is 32 random
 * bytes; only its hash is stored, so the table cannot be read for a
 * redeemable code, and neither kind holds a token.
 *
 * Redemption is one `DELETE … RETURNING`: the row leaves in the same
 * statement that hands it to the caller, so two racing redeems cannot both
 * succeed and a replay finds nothing. A wrong verifier therefore burns the
 * code too, which is deliberate: whoever holds a code but not the verifier
 * gets exactly one guess.
 */
@Injectable()
export class NativeAuthService {
  private readonly logger = new Logger(NativeAuthService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /** The browser finished sign-in; hold the session for the app that proves it asked. */
  async stageHandoff(input: {
    userId: string;
    sessionId: string;
    /** Base64url SHA-256 of the app's PKCE verifier. */
    challenge: string;
    /** Path the server decided the app lands on once signed in. */
    returnTo: string;
  }): Promise<string> {
    return this.stage({
      kind: 'handoff',
      userId: input.userId,
      sessionId: input.sessionId,
      codeChallenge: input.challenge,
      returnTo: input.returnTo,
      ttlMs: NATIVE_HANDOFF_TTL_MS,
    });
  }

  /** The signed-in app asks the browser to run a Gmail connect for it. */
  async stageConnect(input: {
    userId: string;
    sessionId: string;
    options: NativeConnectTicketRequest;
  }): Promise<string> {
    return this.stage({
      kind: 'connect_start',
      userId: input.userId,
      sessionId: input.sessionId,
      options: input.options,
      ttlMs: NATIVE_START_TICKET_TTL_MS,
    });
  }

  /**
   * Consume a ticket of `kind`. Null when the code is unknown, expired,
   * already used, or belongs to the other kind (which is left in place).
   */
  async redeem(kind: TicketKind, code: string): Promise<NativeAuthTicket | null> {
    const [row] = await this.db
      .delete(nativeAuthTickets)
      .where(
        and(
          eq(nativeAuthTickets.codeHash, hashCode(code)),
          eq(nativeAuthTickets.kind, kind),
          gt(nativeAuthTickets.expiresAt, new Date()),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * The targets a `connect_start` ticket was issued with, re-parsed on the
   * way out: the column is jsonb, and what leaves it is not trusted just
   * because this service wrote it.
   */
  connectOptions(ticket: NativeAuthTicket): NativeConnectTicketRequest | null {
    const parsed = nativeConnectTicketRequestSchema.safeParse(ticket.options ?? {});
    return parsed.success ? parsed.data : null;
  }

  /** RFC 7636 S256: challenge = base64url(SHA-256(verifier)), compared in constant time. */
  static verifierMatches(verifier: string, challenge: string): boolean {
    const expected = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
    const actual = Buffer.from(challenge);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private async stage(input: {
    kind: TicketKind;
    userId: string;
    sessionId: string;
    codeChallenge?: string;
    returnTo?: string;
    options?: NativeConnectTicketRequest;
    ttlMs: number;
  }): Promise<string> {
    await this.sweepExpired();
    const code = randomBytes(32).toString('base64url');
    await this.db.insert(nativeAuthTickets).values({
      kind: input.kind,
      codeHash: hashCode(code),
      userId: input.userId,
      sessionId: input.sessionId,
      ...(input.codeChallenge !== undefined ? { codeChallenge: input.codeChallenge } : {}),
      ...(input.returnTo !== undefined ? { returnTo: input.returnTo } : {}),
      ...(input.options !== undefined ? { options: input.options } : {}),
      expiresAt: new Date(Date.now() + input.ttlMs),
    });
    return code;
  }

  /**
   * Expired tickets never match a redeem, so this is housekeeping, not
   * correctness. It rides on the next stage instead of a cron so the table
   * needs no scheduler, and a failure is logged and skipped: a sign-in must
   * not fail because old rows could not be removed.
   */
  private async sweepExpired(): Promise<void> {
    try {
      await this.db.delete(nativeAuthTickets).where(lt(nativeAuthTickets.expiresAt, new Date()));
    } catch (err) {
      this.logger.warn(
        `Expired native ticket sweep failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }
}
