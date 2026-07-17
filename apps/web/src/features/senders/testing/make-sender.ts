/**
 * Test/story-only `Sender` factory. NEVER import from production code —
 * prod builds its senders from the wire via `enrichSenderRow`.
 *
 * `makeSenderRow` returns a complete, realistic wire `SenderListRow`;
 * `makeSender` runs it through the SAME `enrichSenderRow` seam live
 * data uses, with optional overrides for the derived presentation
 * fields (`name` / `lastDays` / `firstSeenMo`) applied after the
 * enrich. A FIXED epoch pins "now" so derived fields are deterministic
 * across runs.
 */

import type { SenderListRow } from '@/lib/api/senders';
import { enrichSenderRow, type Sender } from '../data';

/** Fixed "now" for deterministic derived fields (2026-07-01T00:00Z). */
export const FIXTURE_NOW = Date.parse('2026-07-01T00:00:00.000Z');

/** A complete, realistic default wire row — override per test/story. */
export function makeSenderRow(overrides: Partial<SenderListRow> = {}): SenderListRow {
  return {
    id: 'sender-1',
    displayName: 'Acme Newsletter',
    email: 'news@acme.com',
    domain: 'acme.com',
    gmailCategory: 'promotions',
    // 2 days / ~12 months before FIXTURE_NOW.
    lastSeenAt: '2026-06-29T00:00:00.000Z',
    firstSeenAt: '2025-07-06T00:00:00.000Z',
    totalReceived: 144,
    repliedCount: 0,
    monthlyVolume: 12,
    readRate: 0.2,
    volumeTrend: 'steady',
    sparkline: [3, 3, 3, 3],
    unsubscribeMethod: null,
    lastReview: null,
    protectionFlags: {
      isProtected: false,
      protectionReason: null,
      protectionSetAt: null,
    },
    policyType: null,
    unsubStatus: null,
    ...overrides,
  };
}

/**
 * Build a full `Sender` through the enrich seam. Wire-field overrides
 * feed `makeSenderRow`; the three derived fields can be pinned directly
 * (they never shadow a wire field — see the no-shadow assertion in
 * `../data`).
 */
export function makeSender(
  overrides: Partial<SenderListRow> &
    Partial<Pick<Sender, 'name' | 'lastDays' | 'firstSeenMo'>> = {},
): Sender {
  const { name, lastDays, firstSeenMo, ...rowOverrides } = overrides;
  const sender = enrichSenderRow(makeSenderRow(rowOverrides), FIXTURE_NOW);
  return {
    ...sender,
    ...(name !== undefined ? { name } : {}),
    ...(lastDays !== undefined ? { lastDays } : {}),
    ...(firstSeenMo !== undefined ? { firstSeenMo } : {}),
  };
}
