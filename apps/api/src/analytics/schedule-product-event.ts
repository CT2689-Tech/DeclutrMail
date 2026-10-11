import { Logger } from '@nestjs/common';

import { productEvents, type NewProductEventRow } from '@declutrmail/db';
import {
  sanitizeProductEvent,
  type SanitizedProductEvent,
} from '@declutrmail/shared/analytics/sanitize-product-event';
import type { ProductEventName } from '@declutrmail/shared/analytics/product-events';

const logger = new Logger('ProductEvents');

export interface ProductEventInsert {
  insert(table: typeof productEvents): {
    values(row: NewProductEventRow): PromiseLike<unknown>;
  };
}

/**
 * Fire-and-forget insert. A rejected insert is logged and swallowed.
 * Callers must invoke this AFTER their own transaction commits.
 */
export function scheduleProductEvent(
  db: ProductEventInsert,
  name: ProductEventName,
  props: Record<string, string | number | boolean>,
  userId?: string,
): void {
  const sanitized = sanitizeProductEvent(name, props, userId);
  if (!sanitized) {
    logger.warn(`dropped ${name}`);
    return;
  }
  try {
    void Promise.resolve(db.insert(productEvents).values(rowFrom(sanitized))).catch(
      (err: unknown) => {
        logger.warn(
          `insert failed for ${sanitized.name}: ${err instanceof Error ? err.name : 'error'}`,
        );
      },
    );
  } catch (err) {
    logger.warn(
      `insert failed for ${sanitized.name}: ${err instanceof Error ? err.name : 'error'}`,
    );
  }
}

function rowFrom(event: SanitizedProductEvent): NewProductEventRow {
  return {
    event: event.name,
    props: event.props,
    ...(event.userId ? { userId: event.userId } : {}),
  };
}
