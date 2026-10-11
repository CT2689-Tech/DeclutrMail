import type { ProductEventName } from './product-events.js';

/** Keys the product_events.props CHECK allows. Keep in lockstep with migration 0085. */
export const PRODUCT_EVENT_PROP_KEYS = [
  'kind',
  'plan',
  'requested_bucket',
  'duration_s',
  'emails',
  'template',
  'mode',
  'error_class',
  'provider',
  'mailbox_id',
] as const;

export type ProductEventPropKey = (typeof PRODUCT_EVENT_PROP_KEYS)[number];

const PROP_KEY_SET = new Set<string>(PRODUCT_EVENT_PROP_KEYS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCALAR = /^[A-Za-z0-9._+-]{1,64}$/;
const ERROR_CLASS = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
export const EMAIL_LINK_TEMPLATES = [
  'sync_complete',
  'sync_reminder_24h',
  'lapse',
  'weekly',
  'weekly_detail',
  'sync_failed',
  'gmail_reconnect',
  'deletion_scheduled',
] as const;

export type EmailLinkTemplate = (typeof EMAIL_LINK_TEMPLATES)[number];

const EMAIL_TEMPLATES = new Set<string>(EMAIL_LINK_TEMPLATES);
const REQUESTED_BUCKETS = new Set(['1', '2-10', '11-100', '101-1000', '1001+']);
const DURATION_BUCKETS = new Set([0, 30, 60, 120, 300, 600, 1800, 3600, 7200]);
const EMAIL_BUCKETS = new Set([0, 100, 1000, 10000, 50000, 100000]);

export interface SanitizedProductEvent {
  name: ProductEventName;
  props: Record<string, string | number | boolean>;
  userId?: string;
}

/**
 * Drop the whole event when any prop is outside the allowlist.
 * A failing insert must never be the caller's problem, and a bad prop
 * must never land in the table.
 */
export function sanitizeProductEvent(
  name: ProductEventName,
  props: Record<string, string | number | boolean>,
  userId?: string,
): SanitizedProductEvent | null {
  if (userId !== undefined && !UUID.test(userId)) return null;
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!PROP_KEY_SET.has(key)) return null;
    const accepted = acceptProp(name, key as ProductEventPropKey, value);
    if (accepted === null) return null;
    clean[key] = accepted;
  }
  return userId === undefined ? { name, props: clean } : { name, props: clean, userId };
}

function acceptProp(
  name: ProductEventName,
  key: ProductEventPropKey,
  value: string | number | boolean,
): string | number | boolean | null {
  if (typeof value === 'string' && value.includes('@')) return null;
  switch (key) {
    case 'kind':
      return name === 'signin_provider' && (value === 'gmail' || value === 'workspace')
        ? value
        : null;
    case 'plan':
      return typeof value === 'string' && SCALAR.test(value) ? value : null;
    case 'requested_bucket':
      return typeof value === 'string' && REQUESTED_BUCKETS.has(value) ? value : null;
    case 'duration_s':
      return typeof value === 'number' && DURATION_BUCKETS.has(value) ? value : null;
    case 'emails':
      return typeof value === 'number' && EMAIL_BUCKETS.has(value) ? value : null;
    case 'template':
      return typeof value === 'string' && EMAIL_TEMPLATES.has(value) ? value : null;
    case 'mode':
      return value === 'login' || value === 'connect' || value === 'reconnect' ? value : null;
    case 'error_class':
      return typeof value === 'string' && ERROR_CLASS.test(value) ? value : null;
    case 'provider':
      return value === 'google' ? value : null;
    case 'mailbox_id':
      return typeof value === 'string' && UUID.test(value) ? value : null;
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

const DURATION_FLOORS = [0, 30, 60, 120, 300, 600, 1800, 3600, 7200] as const;
const EMAIL_FLOORS = [0, 100, 1000, 10000, 50000, 100000] as const;

export function bucketDurationSeconds(durationMs: number): number {
  const seconds = Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs / 1000)) : 0;
  return floorBucket(DURATION_FLOORS, seconds);
}

export function bucketEmailCount(count: number): number {
  const emails = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return floorBucket(EMAIL_FLOORS, emails);
}

export function sanitizeErrorClass(name: string): string {
  return ERROR_CLASS.test(name) ? name : 'UnknownError';
}

function floorBucket(floors: readonly number[], value: number): number {
  let bucket = floors[0] ?? 0;
  for (const floor of floors) {
    if (value >= floor) bucket = floor;
  }
  return bucket;
}
