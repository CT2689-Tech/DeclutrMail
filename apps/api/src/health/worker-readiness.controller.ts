import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { workerHeartbeatIsFresh } from '@declutrmail/workers';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

/** External monitor stays live in the API even when the worker is completely gone. */
@Controller('worker-readyz')
export class WorkerReadinessController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}
  @Get()
  async readiness(@Res() res: Response): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let healthy = false;
    try {
      healthy = await Promise.race([
        workerHeartbeatIsFresh(this.db),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 2000);
        }),
      ]);
    } catch {
      /* Dependency failures produce the same bounded, opaque result. */
    } finally {
      if (timer) clearTimeout(timer);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded' });
  }
}
