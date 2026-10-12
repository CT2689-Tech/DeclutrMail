import { describe, expect, it } from 'vitest';

import { RATE_LIMIT_METADATA } from '../common/rate-limit/rate-limit.types.js';
import { InboxReportController } from './inbox-report.controller.js';

describe('InboxReportController', () => {
  it('rate-limits the report read on the triage-load bucket', () => {
    expect(Reflect.getMetadata(RATE_LIMIT_METADATA, InboxReportController.prototype.get)).toEqual({
      bucket: 'triage-load',
    });
  });
});
