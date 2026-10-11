import { Injectable } from '@nestjs/common';

import type {
  ProductEventName,
  ProductEventsPort,
} from '@declutrmail/shared/analytics/product-events';

/** Nest injection token. WS4b replaces the no-op binding. */
export const PRODUCT_EVENTS = Symbol('PRODUCT_EVENTS');

export const noopProductEvents: ProductEventsPort = {
  record(): void {
    // Intentionally empty. Recording must never throw.
  },
};

@Injectable()
export class NoopProductEvents implements ProductEventsPort {
  record(
    name: ProductEventName,
    props: Record<string, string | number | boolean>,
    userId?: string,
  ): void {
    void name;
    void props;
    void userId;
  }
}

/** Call sites use this so a recorder failure cannot fail the request. */
export function recordProductEvent(
  port: ProductEventsPort | undefined,
  name: ProductEventName,
  props: Record<string, string | number | boolean>,
  userId?: string,
): void {
  try {
    (port ?? noopProductEvents).record(name, props, userId);
  } catch {
    // Product analytics is optional.
  }
}
