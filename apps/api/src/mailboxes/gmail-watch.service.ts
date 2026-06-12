import { Inject, Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { and, eq } from 'drizzle-orm';

import { mailboxAccounts } from '@declutrmail/db';
import { clearGmailWatchState, persistGmailWatchState, RateLimiter } from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { TokenCryptoService } from '../auth/token-crypto.service.js';
import { GmailClientService } from '../gmail/gmail-client.service.js';

/** Outcome of one best-effort watch/stop call — for logs + tests. */
export type GmailWatchOutcome =
  | 'watched'
  | 'stopped'
  | 'skipped_disabled' // GMAIL_PUBSUB_TOPIC unset — watch pipeline off.
  | 'skipped_no_token' // row missing or no stored OAuth credentials.
  | 'failed'; // Gmail call failed — logged; renewal sweep heals.

/**
 * Local per-call quota pacing for the API-side watch calls. These are
 * one-shot lifecycle calls (connect / disconnect / deletion purge), not
 * bulk loops, so each gets a fresh limiter — the same coarse per-call
 * accounting the worker uses (ADR-0005; `users.watch` is billed higher
 * server-side, but one call per connect cannot approach the window).
 */
const GMAIL_QUOTA_UNITS_PER_MIN = 12_000;
const GMAIL_QUOTA_WINDOW_MS = 60_000;

/**
 * GmailWatchService (D8, D225, D229) — the API-side `users.watch`
 * lifecycle, owned by MailboxAccountsModule per the plan's module map
 * ("Pub/Sub watch lifecycle").
 *
 * Call sites:
 *   - `AuthSignupOrchestrator.connect` / `.addMailbox` — watch right
 *     after the OAuth connect/reconnect commits. Initial sync is NOT
 *     ready yet at that point and that is fine: the webhook treats
 *     pushes for unsynced mailboxes as designed no-ops
 *     (`sync_state_uninitialized` / `deferred_initial_sync_in_flight`),
 *     and the subscription is already live the moment the mailbox
 *     reaches `ready` — no missed-push window. The 6h
 *     `WatchRenewalWorker` then keeps it alive (and heals a failed
 *     connect-time watch once the mailbox is ready).
 *   - `MailboxAccountsService.disconnect` — `users.stop` BEFORE the
 *     token is revoked (a revoked token cannot stop the watch).
 *   - `stopAllForUser` — the U22 account-deletion purge hook.
 *
 * EVERY method is best-effort and non-throwing: a Gmail hiccup must
 * never fail an OAuth connect, a disconnect, or a deletion purge. Each
 * failure is logged with a stable `kind` for Cloud Logging.
 *
 * Privacy (D7/D228): watch/stop traffic carries topic + label ids +
 * historyId + expiration only — no message content.
 */
@Injectable()
export class GmailWatchService {
  private readonly logger = new Logger(GmailWatchService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly tokenCrypto: TokenCryptoService,
  ) {}

  /** The Pub/Sub topic resource, or null when the pipeline is off. */
  private topicName(): string | null {
    const topic = process.env.GMAIL_PUBSUB_TOPIC;
    return topic && topic.length > 0 ? topic : null;
  }

  /**
   * Subscribe one mailbox's notifications (`users.watch`) and persist
   * the returned historyId + expiration (see `gmail-watch-state.ts`
   * for where + why). Best-effort — never throws.
   */
  async watchMailbox(mailboxAccountId: string): Promise<GmailWatchOutcome> {
    const topic = this.topicName();
    if (!topic) {
      this.logger.log(`gmail_watch.skipped_disabled mailbox=${mailboxAccountId}`);
      return 'skipped_disabled';
    }
    try {
      const client = await this.clientFor(mailboxAccountId);
      if (!client) {
        return 'skipped_no_token';
      }
      const result = await client.watch(topic);
      await persistGmailWatchState(this.db, mailboxAccountId, {
        history_id: result.historyId,
        expiration: new Date(result.expirationMs).toISOString(),
        renewed_at: new Date().toISOString(),
      });
      this.logger.log(
        `gmail_watch.watched mailbox=${mailboxAccountId} ` +
          `expiration=${new Date(result.expirationMs).toISOString()}`,
      );
      return 'watched';
    } catch (err) {
      // Best-effort: the 6h renewal sweep heals this within one tick.
      this.logger.warn(
        `gmail_watch.watch_failed mailbox=${mailboxAccountId} ` +
          `error=${err instanceof Error ? err.message : String(err)}`,
      );
      return 'failed';
    }
  }

  /**
   * End one mailbox's notifications (`users.stop`) and clear the
   * persisted watch state. MUST run while the OAuth grant is still
   * valid — the disconnect path calls this BEFORE revoking the token.
   * Best-effort — never throws (Gmail treats a stop with no active
   * watch as a no-op, so retries and double-calls are safe).
   */
  async stopMailbox(mailboxAccountId: string): Promise<GmailWatchOutcome> {
    if (!this.topicName()) {
      return 'skipped_disabled';
    }
    try {
      const client = await this.clientFor(mailboxAccountId);
      if (!client) {
        return 'skipped_no_token';
      }
      await client.stopWatch();
      await clearGmailWatchState(this.db, mailboxAccountId);
      this.logger.log(`gmail_watch.stopped mailbox=${mailboxAccountId}`);
      return 'stopped';
    } catch (err) {
      this.logger.warn(
        `gmail_watch.stop_failed mailbox=${mailboxAccountId} ` +
          `error=${err instanceof Error ? err.message : String(err)}`,
      );
      return 'failed';
    }
  }

  /**
   * Stop notifications for EVERY active mailbox a user owns — the U22
   * account-deletion purge hook (D232). Per-mailbox isolation: one
   * failed stop is counted and the loop continues, so a single bad
   * grant cannot block a deletion purge.
   */
  async stopAllForUser(
    userId: string,
  ): Promise<{ stopped: number; failed: number; skipped: number }> {
    const rows = await this.db
      .select({ id: mailboxAccounts.id })
      .from(mailboxAccounts)
      .where(and(eq(mailboxAccounts.userId, userId), eq(mailboxAccounts.status, 'active')));
    let stopped = 0;
    let failed = 0;
    let skipped = 0;
    for (const { id } of rows) {
      const outcome = await this.stopMailbox(id);
      if (outcome === 'stopped') {
        stopped += 1;
      } else if (outcome === 'failed') {
        failed += 1;
      } else {
        skipped += 1;
      }
    }
    return { stopped, failed, skipped };
  }

  /**
   * Load the mailbox row, decrypt its refresh token (D14 envelope
   * decryption), and return a token-bound Gmail client — the API-side
   * sibling of the worker composition root's `getGmailClient`. Returns
   * `null` when the row is missing or has no stored credentials
   * (disconnected rows have their tokens nullified).
   */
  private async clientFor(mailboxAccountId: string): Promise<GmailClientService | null> {
    const [account] = await this.db
      .select({
        id: mailboxAccounts.id,
        encryptedRefreshToken: mailboxAccounts.encryptedRefreshToken,
        dekEncrypted: mailboxAccounts.dekEncrypted,
      })
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, mailboxAccountId))
      .limit(1);
    if (!account?.encryptedRefreshToken || !account.dekEncrypted) {
      this.logger.warn(`gmail_watch.skipped_no_token mailbox=${mailboxAccountId}`);
      return null;
    }
    const refreshToken = await this.tokenCrypto.decrypt(
      account.encryptedRefreshToken,
      account.dekEncrypted,
    );
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error('Google OAuth is not configured: set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.');
    }
    const oauth = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    oauth.setCredentials({ refresh_token: refreshToken });
    return new GmailClientService(
      oauth,
      new RateLimiter(GMAIL_QUOTA_UNITS_PER_MIN, GMAIL_QUOTA_WINDOW_MS),
    );
  }
}
