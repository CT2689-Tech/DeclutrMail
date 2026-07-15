import { GMAIL_DATA_INVENTORY } from './gmail-data-inventory';

export const ACTIVITY_SUPPORT_BUNDLE_FORMAT = 'declutrmail-activity-support-v1' as const;

export const ACTIVITY_SUPPORT_BUNDLE_FILES = [
  'summary.txt',
  'activity.csv',
  'technical-details.json',
] as const;

export const ACTIVITY_SUPPORT_CSV_COLUMNS = [
  'Occurred At',
  'Action',
  'Source',
  'Sender',
  'Sender Address',
  'Messages Affected',
  'Result',
  'Undo',
] as const;

export const ACTIVITY_SUPPORT_TECHNICAL_ROOT_KEYS = [
  'bundleFormat',
  'generatedAt',
  'mailboxId',
  'filters',
  'records',
] as const;

export const ACTIVITY_SUPPORT_TECHNICAL_FILTER_KEYS = [
  'window',
  'source',
  'verbs',
  'dateFrom',
  'dateTo',
  'outcomes',
] as const;

export const ACTIVITY_SUPPORT_TECHNICAL_RECORD_KEYS = [
  'activityId',
  'actionAttemptId',
  'occurredAt',
  'action',
  'source',
  'executionStatus',
  'errorCode',
] as const;

export const ACTIVITY_SUPPORT_INCLUDED_INVENTORY_IDS = Object.freeze(
  GMAIL_DATA_INVENTORY.filter((item) =>
    item.exportedIn.some((format) => format === 'activity-support-bundle'),
  ).map((item) => item.id),
);
