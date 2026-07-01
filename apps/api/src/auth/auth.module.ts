import { Logger, Module, type Provider, forwardRef } from '@nestjs/common';
import { Redis } from 'ioredis';

import { EntitlementsModule } from '../common/entitlements/entitlements.module.js';
import { MailboxAccountsModule } from '../mailboxes/mailbox-accounts.module.js';
// `forwardRef` is used below to break the AuthModule ↔ MailboxAccountsModule cycle.
import { SyncModule } from '../sync/sync.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthCryptoModule } from './auth-crypto.module.js';
import { AuthController } from './auth.controller.js';
import { AuthSignupOrchestrator } from './auth-signup.orchestrator.js';
import { CsrfService } from './csrf.service.js';
import { DevAuthController } from './dev-auth.controller.js';
import { GoogleOAuthController } from './google-oauth.controller.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { JwtGuard } from './jwt.guard.js';
import { JwtService } from './jwt.service.js';
import { SESSIONS_REDIS, SessionsService } from './sessions.service.js';

const bootLogger = new Logger('AuthModule');

/**
 * Redis client used by `SessionsService` for the revoke-cache. Falls
 * back to `null` when `REDIS_URL` is unset — the service then does a
 * DB read on every JwtGuard hit, which is correct but slower.
 *
 * We use a separate connection from BullMQ + RateLimit so a Redis blip
 * surfaces as fast cache misses rather than queued retries.
 */
const sessionsRedisProvider: Provider = {
  provide: SESSIONS_REDIS,
  useFactory: (): Redis | null => {
    const url = process.env.REDIS_URL;
    if (!url) {
      bootLogger.warn(
        'REDIS_URL not set — SessionsService revoke-cache disabled. DB hit on every JwtGuard request.',
      );
      return null;
    }
    return new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
  },
};

/**
 * AuthModule (D155, D205).
 *
 * Owns: sessions, guards, OAuth callbacks, first-time signup
 * orchestration (the D205 exception).
 *
 * Imports sibling modules whose services the orchestrator needs:
 *   - UsersModule           (find-or-create users)
 *   - MailboxAccountsModule (mailbox upsert during connect)
 *   - SyncModule            (initial-sync enqueue)
 *   - AuthCryptoModule      (token envelope encryption)
 *   - EntitlementsModule    (tier on /me + connect-mailbox inbox gate, D19/D77/D81)
 *
 * Exports JwtGuard so feature modules can protect their routes via
 * `@UseGuards(JwtGuard)` without importing AuthModule transitively.
 */
@Module({
  imports: [
    AuthCryptoModule,
    EntitlementsModule,
    UsersModule,
    forwardRef(() => MailboxAccountsModule),
    SyncModule,
  ],
  // DevAuthController is always registered but its handler 404s unless
  // the dev-login is explicitly enabled in a non-prod env (see the
  // triple gate in dev-auth.controller.ts + the boot refuse in main.ts).
  controllers: [AuthController, GoogleOAuthController, DevAuthController],
  providers: [
    GoogleOAuthService,
    AuthSignupOrchestrator,
    SessionsService,
    JwtService,
    CsrfService,
    JwtGuard,
    sessionsRedisProvider,
  ],
  exports: [JwtGuard, JwtService, CsrfService, SessionsService],
})
export class AuthModule {}
