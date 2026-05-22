import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';

import { DbModule } from './db/db.module.js';
import { GoogleOAuthModule } from './auth/google-oauth.module.js';

/**
 * Root application module (D201). Loads env config, the global DB
 * module, and the Gmail OAuth feature module.
 */
@Module({
  imports: [ConfigModule.forRoot(), DbModule, GoogleOAuthModule],
})
export class AppModule {}
