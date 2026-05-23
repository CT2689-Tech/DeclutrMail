import { Module } from '@nestjs/common';

import { createKmsProvider } from '../adapters/gcp-kms/kms-provider.factory.js';
import { SyncModule } from '../sync/sync.module.js';
import { GoogleOAuthController } from './google-oauth.controller.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { KMS_PROVIDER, TokenCryptoService } from './token-crypto.service.js';

/**
 * GoogleOAuthModule — the Gmail OAuth connect feature (D4, D201).
 *
 * Imported by AppModule ONLY when `GMAIL_CONNECT_ENABLED=true`. Wires the
 * KmsProvider adapter (chosen by `createKmsProvider` per environment),
 * the D14 envelope-encryption service, the OAuth service, and the
 * controller. The DB instance comes from the global DbModule.
 *
 * Imports `SyncModule` so a completed connect can enqueue the initial
 * backfill (D157) — the sync feature is reached only via its exported
 * `SyncService` facade (D201 module boundary).
 */
@Module({
  imports: [SyncModule],
  controllers: [GoogleOAuthController],
  providers: [
    { provide: KMS_PROVIDER, useFactory: () => createKmsProvider() },
    TokenCryptoService,
    GoogleOAuthService,
  ],
})
export class GoogleOAuthModule {}
