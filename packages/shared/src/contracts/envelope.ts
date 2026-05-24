// @declutrmail/shared/contracts/envelope — D202 API response envelope.
//
// Every HTTP API response from the NestJS api app wraps its payload in
// one of the envelope shapes below. The envelope is intentionally tiny:
// a `data` field plus an optional `meta` field. Errors travel through
// the shared `AllExceptionsFilter` and are NOT this module's concern —
// see `apps/api/src/common/all-exceptions.filter.ts` for the error
// shape (HTTP-status-driven, also D202).
//
// Why a contract package?
//
//  - It lets the BE controllers and the FE TanStack Query hooks share
//    one definitively-typed contract — change the shape here and both
//    sides see the compile error. Without this, each controller
//    inlines its own `{ data; meta }` literal type (see e.g.
//    `apps/api/src/undo/undo.controller.ts`) and the FE has to mirror
//    it by hand, which is exactly the kind of drift D200 + D202 are
//    designed to prevent.
//
//  - The package has no React surface, so the NestJS apps can import
//    it without pulling in the component tree — same arrangement as
//    `contracts/kms-provider.ts`.
//
// Scope of this module: types only. Implementation helpers
// (`okEnvelope`, `paginated`, cursor parse/encode) live alongside it
// in `paginate.ts` because they import these types.

/**
 * The simplest D202 envelope — used by every read endpoint that
 * returns a single resource OR a list short enough that pagination
 * would be over-engineering (e.g. the undo tray, the sender-detail
 * recent-messages list at its 10-row cap per D46).
 *
 * `meta` is optional — controllers may omit it entirely when they have
 * nothing useful to attach. This is intentional: forcing every
 * single-resource response to carry an empty `meta: {}` object would
 * bloat payloads and obscure when meta is actually meaningful.
 */
export interface Envelope<TData, TMeta = undefined> {
  data: TData;
  /** Optional response-level metadata. Absent on plain single-resource reads. */
  meta?: TMeta;
}

/**
 * Cursor-pagination metadata — the standard `meta.pagination` block
 * for list endpoints. D202 mandates cursor pagination over offset
 * pagination so a paginated stream stays correct under concurrent
 * inserts (e.g. a sync worker appending `mail_messages` while the
 * client pages through them).
 *
 * The cursor is opaque to the client — it should never be parsed or
 * constructed in the FE. Treat it as a token: pass back the
 * `nextCursor` you received on the next request to continue.
 *
 * `hasMore` is a redundant convenience flag — `nextCursor != null`
 * implies more pages exist, but FE code reads better as `hasMore`.
 * Keep both; they are derived from the same source and cannot
 * disagree.
 *
 * `limit` is the server-honored page size — may be smaller than the
 * requested limit if the controller clamps to a route-specific
 * ceiling (e.g. Undo's `MAX_LIST_LIMIT`).
 */
export interface PaginationMeta {
  /** Opaque continuation token; pass back as `?cursor=...` on the next request. */
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

/**
 * Convenience alias for paginated list responses — saves callers from
 * spelling out the meta shape on every endpoint signature.
 *
 * Usage in a controller return type:
 *
 *   async list(): Promise<PaginatedEnvelope<SenderListRow>> { ... }
 *
 * Equivalent to `Envelope<TItem[], { pagination: PaginationMeta }>`.
 */
export interface PaginatedEnvelope<TItem> extends Envelope<
  TItem[],
  { pagination: PaginationMeta }
> {
  meta: { pagination: PaginationMeta };
}

/**
 * Decoded cursor — what the server reads after base64url-decoding the
 * opaque `nextCursor` it issued earlier. Stable shape across endpoints
 * so the parse/encode helpers in `paginate.ts` can be generic.
 *
 * `key` is the sort column's value at the boundary row; `id` is the
 * row id used as the tie-breaker to keep ordering deterministic when
 * multiple rows share the same `key` (e.g. two messages with the same
 * `internal_date` to the second). Both fields together form the
 * keyset-pagination predicate the controller emits to the DB:
 *
 *   WHERE (sort_col, id) < (key, id)  ORDER BY sort_col DESC, id DESC
 */
export interface DecodedCursor {
  /** Sort column value at the page boundary. */
  key: string;
  /** Row id at the page boundary — tie-breaker for deterministic ordering. */
  id: string;
}
