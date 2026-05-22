import { Module } from '@nestjs/common';

import { createKmsProvider } from '../adapters/gcp-kms/kms-provider.factory.js';
import { GoogleOAuthController } from './google-oauth.controller.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { KMS_PROVIDER, TokenCryptoService } from './token-crypto.service.js';

/**
 * GoogleOAuthModule — the Gmail OAuth connect feature (D4, D201).
 *
 * Wires the KmsProvider adapter (chosen by `createKmsProvider` per
 * environment), the D14 envelope-encryption service, the OAuth service,
 * and the controller. The DB instance comes from the global DbModule.
 */
@Module({
  controllers: [GoogleOAuthController],
  providers: [
    { provide: KMS_PROVIDER, useFactory: () => createKmsProvider() },
    TokenCryptoService,
    GoogleOAuthService,
  ],
})
export class GoogleOAuthModule {}
