import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  BRIEF_SNAPSHOT_QUEUE,
  type BriefSnapshotJobData,
  createRedisConnection,
  SCORE_QUEUE,
  type ScoreJobData,
} from '@declutrmail/workers';

import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import {
  AI_CONSENT_BRIEF_QUEUE,
  AI_CONSENT_SCORE_QUEUE,
  AiConsentFollowup,
} from './ai-consent-followup.js';
import { MeSettingsController } from './me-settings.controller.js';

/**
 * SettingsModule (U23 — D34/D116/D216).
 *
 * Hosts the Settings index read (`GET /api/me/settings`) and the D34
 * action-sheet prefs write (`PATCH /api/me/action-sheet-prefs`). Lives
 * in its own module (not UsersModule) because the controller needs
 * AuthModule's guards and AuthModule already imports UsersModule —
 * mirroring NotificationsModule avoids the circular import.
 *
 * Queue producers are fail-open when `REDIS_URL` is absent, same as
 * TriageModule: settings still loads, and Allow records consent without
 * a queue to publish to.
 */
@Module({
  imports: [UsersModule, AuthModule],
  controllers: [MeSettingsController],
  providers: [
    {
      provide: AI_CONSENT_SCORE_QUEUE,
      useFactory: (): Queue<ScoreJobData> | null => {
        const url = process.env.REDIS_URL;
        if (!url) return null;
        return new Queue<ScoreJobData>(SCORE_QUEUE, { connection: createRedisConnection(url) });
      },
    },
    {
      provide: AI_CONSENT_BRIEF_QUEUE,
      useFactory: (): Queue<BriefSnapshotJobData> | null => {
        const url = process.env.REDIS_URL;
        if (!url) return null;
        return new Queue<BriefSnapshotJobData>(BRIEF_SNAPSHOT_QUEUE, {
          connection: createRedisConnection(url),
        });
      },
    },
    AiConsentFollowup,
  ],
})
export class SettingsModule {}
