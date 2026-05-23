// @declutrmail/shared/contracts/paginate — encode/decode/build helpers
// for the D202 cursor-pagination envelope. Pure functions, no I/O —
// safe to import from controllers, services, and FE tests alike.

import type {
  DecodedCursor,
  Envelope,
  PaginatedEnvelope,
  PaginationMeta,
} from './envelope';

/**
 * Wrap a single value in the D202 envelope. The thin helper exists so
 * controllers don't sprinkle `{ data: x }` object literals everywhere
 * — a one-line nudge to keep the contract symmetric with `paginated()`
 * below.
 *
 * No `meta` overload by design: a response with meta should use
 * `withMeta()` or the `paginated()` builder so it's clear at the call
 * site what the meta carries.
 */
export function ok<T>(data: T): Envelope<T> {
  return { data };
}

/**
 * Envelope with arbitrary meta. Use for non-pagination meta (rare —
 * pagination has its own helper below).
 */
export function withMeta<TData, TMeta>(data: TData, meta: TMeta): Envelope<TData, TMeta> {
  return { data, meta };
}

/**
 * Build a paginated envelope. The caller has already fetched its page
 * (typically `limit + 1` rows so the presence of the +1 row drives
 * `hasMore`); this helper assembles the envelope and the cursor.
 *
 * Parameters:
 *   items:       the page rows in the order the client should see them.
 *   limit:       the page size the controller honored (echoed in meta).
 *   nextCursor:  the encoded continuation token; `null` when there
 *                are no more rows. Pre-encoded so the caller controls
 *                exactly what goes into the cursor (see
 *                `encodeCursor()` below).
 *
 * Why does the caller assemble `nextCursor` rather than this helper
 * doing it? Because the cursor's `key` field is sort-column-specific
 * — `internal_date` for messages, `last_seen_at` for senders, etc. —
 * and pushing that knowledge in here would either need a callback or
 * generic constraints that obscure the call site.
 */
export function paginated<TItem>(args: {
  items: TItem[];
  limit: number;
  nextCursor: string | null;
}): PaginatedEnvelope<TItem> {
  const pagination: PaginationMeta = {
    nextCursor: args.nextCursor,
    hasMore: args.nextCursor !== null,
    limit: args.limit,
  };
  return { data: args.items, meta: { pagination } };
}

/**
 * Encode a `DecodedCursor` as an opaque base64url string. Base64url
 * (RFC 4648 §5) is used instead of plain base64 so the cursor is safe
 * to drop straight into a URL query parameter without further
 * percent-encoding.
 *
 * The cursor is NOT signed — clients are trusted with continuation
 * tokens because the controller still applies the mailbox-scoped
 * `WHERE mailbox_account_id = ?` predicate; a forged cursor can at
 * worst skip rows in the caller's own mailbox, not access another.
 */
export function encodeCursor(cursor: DecodedCursor): string {
  const json = JSON.stringify(cursor);
  // Buffer's 'base64url' encoding (Node 16+) emits the RFC 4648 §5
  // alphabet without padding — drop-in safe for URLs.
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode an opaque cursor back into `{ key, id }`. Returns `null` for
 * any malformed input — controllers should treat a `null` decode as
 * "client sent garbage" and respond with a 400 rather than a 500.
 *
 * Deliberately tolerant: a cursor older than the current encoder
 * version (no version field today; reserved for future migration)
 * should still decode if its JSON shape matches. When we need to
 * version cursors, add a `v` field here and bump it; for now the
 * shape is stable.
 */
export function decodeCursor(raw: string | undefined | null): DecodedCursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'key' in parsed &&
      'id' in parsed &&
      typeof (parsed as Record<string, unknown>).key === 'string' &&
      typeof (parsed as Record<string, unknown>).id === 'string'
    ) {
      return parsed as DecodedCursor;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clamp a client-supplied `?limit=` to a route-specific range. Saves
 * each controller from re-implementing the same min/max/default
 * dance.
 *
 *   clampLimit(undefined, { def: 25, min: 1, max: 100 })  // => 25
 *   clampLimit('500',     { def: 25, min: 1, max: 100 })  // => 100
 *   clampLimit('abc',     { def: 25, min: 1, max: 100 })  // => 25
 *   clampLimit('0',       { def: 25, min: 1, max: 100 })  // => 1
 */
export function clampLimit(
  raw: string | undefined | null,
  bounds: { def: number; min: number; max: number },
): number {
  if (raw === undefined || raw === null || raw === '') return bounds.def;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return bounds.def;
  return Math.min(bounds.max, Math.max(bounds.min, parsed));
}
