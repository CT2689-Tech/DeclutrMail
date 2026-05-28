import { Module } from '@nestjs/common';

import { UsersService } from './users.service.js';

/**
 * UsersModule (D205). Exports `UsersService` so AuthModule (the
 * documented D205 exception) can inject it for signup orchestration,
 * and so other modules can read user identity via DI.
 */
@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
