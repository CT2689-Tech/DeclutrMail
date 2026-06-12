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

// D106-D113 onboarding transport — Zod schemas + types for /api/onboarding/*.
export {
  ONBOARDING_PRESET_KEYS,
  OnboardingCompleteRequestSchema,
  OnboardingFirstTriageMetaSchema,
  OnboardingPresetCatalogItemSchema,
  OnboardingPresetKeySchema,
  OnboardingPresetPicksRequestSchema,
  OnboardingPresetPicksResultSchema,
  OnboardingStateSchema,
} from './onboarding';
export type {
  OnboardingCompleteRequest,
  OnboardingFirstTriageMeta,
  OnboardingPresetCatalogItem,
  OnboardingPresetKey,
  OnboardingPresetPicksRequest,
  OnboardingPresetPicksResult,
  OnboardingState,
} from './onboarding';

// ADR-0015 verb vocabulary — the shared SoT for the action verb enum,
// imported by the DB pg_enum (P5) and the Action Registry descriptors.
export {
  ACTION_TIER_RANK,
  ACTION_TIERS,
  ACTION_VERBS,
  CANONICAL_SHORTCUTS,
  COMPOSITE_PRIMARY_VERBS,
  COMPOSITE_SECONDARY_VERBS,
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
  CompositePrimaryVerb,
  CompositeSecondaryVerb,
  ExecutionKind,
  PreviewMode,
  SelectorType,
} from './verb-constants';

// D35 / D58 / D232 undo journal verb mirror — kept here (server-safe)
// so apps/api can import it without dragging JSX. The DB pg_enum is
// canonical; this type is contract-tested in apps/api/src/undo/undo.types.ts.
export type { UndoActionKind } from './undo-action-kind';

// D226 action job lifecycle — mirrored from `action_job_status` pg_enum.
// Contract-tested in apps/api/src/actions/actions.types.ts.
export type { ActionJobStatus } from './action-job-status';

// Gmail category mirror — `gmail_category` pg_enum. Contract-tested in
// apps/api/src/senders/senders.types.ts.
export type { GmailCategory } from './gmail-category';

// U14 — Autopilot approve + dry-run preview contracts (D99/D101/D104).
export {
  AutopilotApproveMatchesRequestSchema,
  AutopilotApproveResultSchema,
  AutopilotPreviewSampleSchema,
  AutopilotRulePreviewResultSchema,
} from './autopilot';
export type {
  AutopilotApproveMatchesRequest,
  AutopilotApproveResult,
  AutopilotPreviewSample,
  AutopilotRulePreviewResult,
} from './autopilot';

// D19 waitlist capture — POST /api/waitlist (pricing Team row +
// marketing forms). Constant 202 body — no email-exists oracle.
export { WaitlistJoinRequestSchema } from './waitlist';
export type { WaitlistJoinRequest, WaitlistJoinResult } from './waitlist';
