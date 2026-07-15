import { describe, expect, it } from 'vitest';

import { GMAIL_DATA_INVENTORY } from './gmail-data-inventory';
import {
  ACTIVITY_SUPPORT_BUNDLE_FILES,
  ACTIVITY_SUPPORT_BUNDLE_FORMAT,
  ACTIVITY_SUPPORT_CSV_COLUMNS,
  ACTIVITY_SUPPORT_INCLUDED_INVENTORY_IDS,
  ACTIVITY_SUPPORT_TECHNICAL_FILTER_KEYS,
  ACTIVITY_SUPPORT_TECHNICAL_RECORD_KEYS,
  ACTIVITY_SUPPORT_TECHNICAL_ROOT_KEYS,
} from './activity-support-bundle';

describe('D245 Activity support bundle contract', () => {
  it('pins the archive files and human-readable CSV fields', () => {
    expect(ACTIVITY_SUPPORT_BUNDLE_FORMAT).toBe('declutrmail-activity-support-v1');
    expect(ACTIVITY_SUPPORT_BUNDLE_FILES).toEqual([
      'summary.txt',
      'activity.csv',
      'technical-details.json',
    ]);
    expect(ACTIVITY_SUPPORT_CSV_COLUMNS).toEqual([
      'Occurred At',
      'Action',
      'Source',
      'Sender',
      'Sender Address',
      'Messages Affected',
      'Result',
      'Undo',
    ]);
  });

  it('pins the optional technical appendix allowlist', () => {
    expect(ACTIVITY_SUPPORT_TECHNICAL_ROOT_KEYS).toEqual([
      'bundleFormat',
      'generatedAt',
      'mailboxId',
      'filters',
      'records',
    ]);
    expect(ACTIVITY_SUPPORT_TECHNICAL_FILTER_KEYS).toEqual([
      'window',
      'source',
      'verbs',
      'dateFrom',
      'dateTo',
    ]);
    expect(ACTIVITY_SUPPORT_TECHNICAL_RECORD_KEYS).toEqual([
      'activityId',
      'actionAttemptId',
      'occurredAt',
      'action',
      'source',
      'executionStatus',
      'errorCode',
    ]);
  });

  it('derives the included datasets from the cumulative privacy inventory', () => {
    const expected = GMAIL_DATA_INVENTORY.filter((item) =>
      item.exportedIn.some((format) => format === 'activity-support-bundle'),
    ).map((item) => item.id);
    expect(ACTIVITY_SUPPORT_INCLUDED_INVENTORY_IDS).toEqual(expected);
    expect(expected).toEqual([
      'gmail-account-identity',
      'sender-identity',
      'actions-activity-and-undo',
    ]);
  });
});
