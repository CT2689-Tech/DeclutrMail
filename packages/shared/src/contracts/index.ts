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

// Error-code registry (ADR-0014) — the single source of truth for domain
// error codes + their default status/tier/retryable/message.
export type { ErrorCode, ErrorCodeSpec } from './error-codes';
export { ERROR_CODES, isErrorCode } from './error-codes';

// D224 sync status transport — Zod schema + types for /api/v1/sync/status.
export { SyncStatusSchema, SyncReadinessSchema, SyncStageSchema } from './sync-status';
export type { SyncStatus, SyncReadiness, SyncStage } from './sync-status';

// pg_enum mirrors — closed string unions that mirror `@declutrmail/db`
// pg_enums for FE consumers (the FE has no `@declutrmail/db` dep). A
// cross-package `satisfies` contract test in `apps/api` keeps these in
// lock-step with the DB source of truth at compile time.
export type { ActionJobStatus, GmailCategory, UndoActionKind } from './enum-mirrors';

// ADR-0015 verb vocabulary — the shared SoT for the action verb enum,
// imported by the DB pg_enum (P5) and the Action Registry descriptors.
export {
  ACTION_TIER_RANK,
  ACTION_TIERS,
  ACTION_VERBS,
  CANONICAL_SHORTCUTS,
  EXECUTION_KINDS,
  isActionVerb,
  PREVIEW_MODES,
  SELECTOR_TYPES,
} from './verb-constants';
export type {
  ActionTier,
  ActionVerb,
  CanonicalShortcut,
  CanonicalVerb,
  ExecutionKind,
  PreviewMode,
  SelectorType,
} from './verb-constants';
