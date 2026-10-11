import { Global, Module } from '@nestjs/common';

import { PRODUCT_EVENTS } from './product-events.port.js';
import { ProductEventsWriter } from './product-events.writer.js';

/** Global so billing and entitlements can record without importing each other. */
@Global()
@Module({
  providers: [{ provide: PRODUCT_EVENTS, useClass: ProductEventsWriter }],
  exports: [PRODUCT_EVENTS],
})
export class ProductEventsModule {}
