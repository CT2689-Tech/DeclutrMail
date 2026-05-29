import { Module } from '@nestjs/common';

import { createKmsProvider } from '../adapters/gcp-kms/kms-provider.factory.js';
import { SecurityEventsService } from '../security-events/security-events.service.js';
import { KMS_PROVIDER, TokenCryptoService } from './token-crypto.service.js';

/**
 * AuthCryptoModule (D14 + D205).
 *
 * Standalone module that provides ONLY `TokenCryptoService` and its
 * KMS dependency. Extracted out of the old `GoogleOAuthModule` so the
 * mailbox-disconnect path (in `MailboxAccountsModule`) can use envelope
 * decryption WITHOUT importing the OAuth controller + Google client
 * surface area.
 *
 * Symmetric with how `RateLimitModule` is global — auth crypto is a
 * cross-feature dependency; the feature modules that need it import
 * this module by name.
 *
 * D181 wiring: `SecurityEventsService` (provided by the global
 * `SecurityEventsModule`) is injected into the KMS factory so wrap /
 * unwrap failures emit a `kms.access_error` audit row. The recorder
 * is fire-and-forget — a failed audit insert never alters the
 * envelope-encrypt path.
 */
@Module({
  providers: [
    {
      provide: KMS_PROVIDER,
      useFactory: (securityEvents: SecurityEventsService) =>
        createKmsProvider(process.env, {
          onAccessError: ({ operation, reason, keyResource }) => {
            void securityEvents.record({
              eventType: 'kms.access_error',
              severity: 'critical',
              payload: { provider: 'gcp', operation, reason, keyResource },
            });
          },
        }),
      inject: [SecurityEventsService],
    },
    TokenCryptoService,
  ],
  exports: [TokenCryptoService],
})
export class AuthCryptoModule {}
