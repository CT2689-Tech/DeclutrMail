import { Global, Module } from '@nestjs/common';

import { NoopProductEvents, PRODUCT_EVENTS } from './product-events.port.js';

/** Global so billing and entitlements can record without importing each other. */
@Global()
@Module({
  providers: [{ provide: PRODUCT_EVENTS, useClass: NoopProductEvents }],
  exports: [PRODUCT_EVENTS],
})
export class ProductEventsModule {}
