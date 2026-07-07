/**
 * SyncStatus contract tests (D224).
 *
 * Round-trip a known-good payload through the Zod schema and assert
 * representative invalid shapes are rejected. The schema is the
 * UI/server contract — if these tests pass, the wire format is locked.
 */

import { describe, expect, it } from 'vitest';

import { SyncStatusSchema, type SyncStatus } from './sync-status';

const VALID_QUEUED: SyncStatus = {
  readiness_status: 'queued',
  current_stage: 'queued',
  progress_pct: 0,
  is_ready_for_triage: false,
};

const VALID_SYNCING: SyncStatus = {
  readiness_status: 'syncing',
  current_stage: 'fetching_metadata',
  progress_pct: 42,
  is_ready_for_triage: false,
};

const VALID_READY: SyncStatus = {
  readiness_status: 'ready',
  current_stage: 'ready',
  progress_pct: 100,
  is_ready_for_triage: true,
};

const VALID_FAILED: SyncStatus = {
  readiness_status: 'failed',
  current_stage: 'failed',
  progress_pct: 17,
  is_ready_for_triage: false,
  error_code: 'GMAIL_QUOTA_EXCEEDED',
};

describe('SyncStatusSchema', () => {
  it.each([
    ['queued', VALID_QUEUED],
    ['syncing', VALID_SYNCING],
    ['ready', VALID_READY],
    ['failed with error_code', VALID_FAILED],
  ])('parses a valid %s payload (round-trip preserves shape)', (_label, payload) => {
    const parsed = SyncStatusSchema.parse(payload);
    expect(parsed).toEqual(payload);
  });

  it('accepts last_synced_at as an ISO datetime', () => {
    const parsed = SyncStatusSchema.parse({
      ...VALID_READY,
      last_synced_at: '2026-07-07T18:04:12.000Z',
    });
    expect(parsed.last_synced_at).toBe('2026-07-07T18:04:12.000Z');
  });

  it('accepts last_synced_at: null (no completed run yet)', () => {
    const parsed = SyncStatusSchema.parse({
      ...VALID_QUEUED,
      last_synced_at: null,
    });
    expect(parsed.last_synced_at).toBeNull();
  });

  it('accepts an OMITTED last_synced_at (pre-field responses stay valid)', () => {
    expect(SyncStatusSchema.parse(VALID_READY).last_synced_at).toBeUndefined();
  });

  it('rejects a non-datetime last_synced_at', () => {
    const result = SyncStatusSchema.safeParse({
      ...VALID_READY,
      last_synced_at: 'yesterday-ish',
    });
    expect(result.success).toBe(false);
  });

  it('accepts the incremental failure pair (at + code), null, or omitted', () => {
    const withError = SyncStatusSchema.parse({
      ...VALID_READY,
      last_sync_error_at: '2026-07-07T18:10:00.000Z',
      last_sync_error_code: 'GMAIL_HISTORY_GONE',
    });
    expect(withError.last_sync_error_code).toBe('GMAIL_HISTORY_GONE');

    const cleared = SyncStatusSchema.parse({
      ...VALID_READY,
      last_sync_error_at: null,
      last_sync_error_code: null,
    });
    expect(cleared.last_sync_error_at).toBeNull();

    expect(SyncStatusSchema.parse(VALID_READY).last_sync_error_at).toBeUndefined();
  });

  it('rejects a non-datetime last_sync_error_at and an empty error code', () => {
    expect(SyncStatusSchema.safeParse({ ...VALID_READY, last_sync_error_at: 'nope' }).success).toBe(
      false,
    );
    expect(SyncStatusSchema.safeParse({ ...VALID_READY, last_sync_error_code: '' }).success).toBe(
      false,
    );
  });

  it('rejects progress_pct > 100', () => {
    const result = SyncStatusSchema.safeParse({
      ...VALID_SYNCING,
      progress_pct: 101,
    });
    expect(result.success).toBe(false);
  });

  it('rejects progress_pct < 0', () => {
    const result = SyncStatusSchema.safeParse({
      ...VALID_SYNCING,
      progress_pct: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer progress_pct', () => {
    const result = SyncStatusSchema.safeParse({
      ...VALID_SYNCING,
      progress_pct: 42.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown readiness_status value', () => {
    const result = SyncStatusSchema.safeParse({
      ...VALID_QUEUED,
      readiness_status: 'paused',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown current_stage value', () => {
    const result = SyncStatusSchema.safeParse({
      ...VALID_QUEUED,
      current_stage: 'reading_bodies',
    });
    expect(result.success).toBe(false);
  });

  it('rejects "Screen" as a stage value (D227 internal-only verb)', () => {
    const result = SyncStatusSchema.safeParse({
      ...VALID_QUEUED,
      current_stage: 'screen',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields (strict mode — extra keys could leak content)', () => {
    const result = SyncStatusSchema.safeParse({
      ...VALID_SYNCING,
      // E.g. an accidental body-content field; the schema must reject it.
      latest_message_subject: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const result = SyncStatusSchema.safeParse({
      readiness_status: 'syncing',
      current_stage: 'fetching_metadata',
      progress_pct: 10,
      // missing is_ready_for_triage
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty error_code (must be omitted when absent, not empty)', () => {
    const result = SyncStatusSchema.safeParse({
      ...VALID_FAILED,
      error_code: '',
    });
    expect(result.success).toBe(false);
  });
});
