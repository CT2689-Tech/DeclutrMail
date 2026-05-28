import { Module } from '@nestjs/common';

import { createKmsProvider } from '../adapters/gcp-kms/kms-provider.factory.js';
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
 */
@Module({
  providers: [{ provide: KMS_PROVIDER, useFactory: () => createKmsProvider() }, TokenCryptoService],
  exports: [TokenCryptoService],
})
export class AuthCryptoModule {}
