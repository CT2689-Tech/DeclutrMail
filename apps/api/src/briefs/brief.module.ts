import { Module } from '@nestjs/common';

import { BriefController } from './brief.controller.js';
import { BriefReadService } from './brief.read-service.js';

/**
 * BriefModule (D61, D62, D63, D67, D69, D70) — read + open-tracker
 * surface for the Brief Pro feature.
 *
 * Mirrors `SendersModule` / `AutopilotModule` / `FollowupModule`
 * (ADR-0008 / D201): thin controller wired to a service that owns the
 * SELECTs against `brief_runs` plus the per-row open-tracker mutation.
 * Cross-feature writes are not in scope here — the snapshot worker is
 * the only writer to `brief_payload`.
 *
 * Eager-loadable at boot — only needs DATABASE_URL (already global
 * via DbModule).
 */
@Module({
  controllers: [BriefController],
  providers: [BriefReadService],
  exports: [BriefReadService],
})
export class BriefModule {}
