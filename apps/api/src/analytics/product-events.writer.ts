import { Inject, Injectable } from '@nestjs/common';

import type {
  ProductEventName,
  ProductEventsPort,
} from '@declutrmail/shared/analytics/product-events';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { scheduleProductEvent } from './schedule-product-event.js';

@Injectable()
export class ProductEventsWriter implements ProductEventsPort {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  record(
    name: ProductEventName,
    props: Record<string, string | number | boolean>,
    userId?: string,
  ): void {
    scheduleProductEvent(this.db, name, props, userId);
  }
}
