import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { MeSettingsController } from './me-settings.controller.js';

/**
 * SettingsModule (U23 — D34/D116/D216).
 *
 * Hosts the Settings index read (`GET /api/me/settings`) and the D34
 * action-sheet prefs write (`PATCH /api/me/action-sheet-prefs`). Lives
 * in its own module (not UsersModule) because the controller needs
 * AuthModule's guards and AuthModule already imports UsersModule —
 * mirroring NotificationsModule avoids the circular import.
 */
@Module({
  imports: [UsersModule, AuthModule],
  controllers: [MeSettingsController],
})
export class SettingsModule {}
