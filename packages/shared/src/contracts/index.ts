// @declutrmail/shared/contracts — external-integration adapter
// contracts (D201) and transport schemas (D224). Pure TypeScript /
// Zod, no React; importable by the NestJS api/worker apps without
// pulling in the component tree.

export type { KmsProvider } from './kms-provider';

// D202 API response envelope — shared between NestJS controllers and
// FE TanStack Query hooks so the wire shape is typed end-to-end.
export type { DecodedCursor, Envelope, PaginatedEnvelope, PaginationMeta } from './envelope';
export { clampLimit, decodeCursor, encodeCursor, ok, paginated, withMeta } from './paginate';

// D168 error envelope + D169 severity tiers — the error counterpart to
// the D202 success envelope, shared BE filter ↔ FE error handling.
export type { ApiError, ErrorEnvelope, ErrorSeverityTier } from './error-envelope';
export { classifyHttpError, deriveDisplayId } from './error-envelope';

// D224 sync status transport — Zod schema + types for /api/v1/sync/status.
export { SyncStatusSchema, SyncReadinessSchema, SyncStageSchema } from './sync-status';
export type { SyncStatus, SyncReadiness, SyncStage } from './sync-status';
