import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';

import { DbModule } from './db/db.module.js';
import { GoogleOAuthModule } from './auth/google-oauth.module.js';

/**
 * The Gmail OAuth connect feature is loaded ONLY when
 * `GMAIL_CONNECT_ENABLED=true`. Two reasons:
 *  1. The connect routes are unauthenticated until the D109/D224 auth
 *     layer lands, so they must be off by default.
 *  2. `GoogleOAuthModule` eagerly builds the KMS provider at bootstrap;
 *     leaving the module unimported means a missing KMS/encryption env
 *     can never brick API boot while the feature is off.
 * Node's --env-file flag populates `process.env` before any module code
 * runs, so this check is reliable at decoration time.
 */
const gmailConnectEnabled = process.env.GMAIL_CONNECT_ENABLED === 'true';

/**
 * Root application module (D201). Loads env config, the global DB
 * module, and — when enabled — the Gmail OAuth feature module.
 */
@Module({
  imports: [ConfigModule.forRoot(), DbModule, ...(gmailConnectEnabled ? [GoogleOAuthModule] : [])],
})
export class AppModule {}
