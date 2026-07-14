// @declutrmail/shared/contracts — external-integration adapter
// contracts (D201) and transport schemas (D224). Pure TypeScript /
// Zod, no React; importable by the NestJS api/worker apps without
// pulling in the component tree.

export type { KmsProvider } from './kms-provider';

// D245 cumulative Gmail-data lifecycle registry. This contract generates
// privacy copy and the Gmail metadata-header allowlist.
export {
  GMAIL_CONNECTION_DATA_INVENTORY,
  GMAIL_DATA_PROCESSORS,
  GMAIL_DATA_INVENTORY,
  GMAIL_DATA_RETENTION,
  GMAIL_DERIVED_DATA_INVENTORY,
  GMAIL_DISCONNECT_DATA_INVENTORY,
  GMAIL_INDEXED_DATA_DELETION_INVENTORY,
  GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY,
  GMAIL_MESSAGE_DATA_INVENTORY,
  GMAIL_MESSAGE_STORAGE_LABELS,
  GMAIL_METADATA_HEADERS,
  GMAIL_OAUTH_ACCESS,
  GMAIL_OPERATIONAL_AUDIT_DATA_INVENTORY,
  gmailDataInventoryItem,
} from './gmail-data-inventory';
export type {
  GmailDataCategory,
  GmailDataExportFormat,
  GmailDataInventoryItem,
  GmailDataProcessor,
  GmailDataRemovalTrigger,
} from './gmail-data-inventory';

export { DATA_EXPORT_FORMAT_MANIFEST, DATA_EXPORT_LIMITATION } from './data-export';

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

// D245 unsubscribe truthfulness — one-click endpoint acceptance,
// manual-mailto progress, and unavailable channels are distinct states.
export {
  initialUnsubscribeLifecycleStatus,
  normalizeUnsubscribeLifecycleStatus,
  UNSUBSCRIBE_LIFECYCLE_STATUSES,
  UNSUBSCRIBE_MANUAL_TRANSITIONS,
  UnsubscribeLifecycleStatusSchema,
  UnsubscribeManualStatusRequestSchema,
  UnsubscribeManualTransitionSchema,
} from './unsubscribe-lifecycle';
export type {
  LegacyUnsubscribeLifecycleStatus,
  UnsubscribeLifecycleStatus,
  UnsubscribeManualStatusRequest,
  UnsubscribeManualTransition,
} from './unsubscribe-lifecycle';

// Gmail category mirror — `gmail_category` pg_enum. Contract-tested in
// apps/api/src/senders/senders.types.ts.
export type { GmailCategory } from './gmail-category';

// U14 — Autopilot approve + dry-run preview contracts (D99/D101/D104).
export {
  AUTOPILOT_PENDING_PAGE_SIZE,
  AutopilotApproveMatchesRequestSchema,
  AutopilotApproveResultSchema,
  AutopilotPreviewSampleSchema,
  AutopilotRulePreviewResultSchema,
  AutopilotWeeklyVolumeSchema,
} from './autopilot';
export type {
  AutopilotApproveMatchesRequest,
  AutopilotApproveResult,
  AutopilotPreviewSample,
  AutopilotRulePreviewResult,
  AutopilotWeeklyVolume,
} from './autopilot';

// D19 waitlist capture — POST /api/waitlist (pricing Team row +
// marketing forms). Constant 202 body — no email-exists oracle.
export { WaitlistJoinRequestSchema } from './waitlist';
export type { WaitlistJoinRequest, WaitlistJoinResult } from './waitlist';

// D117/D118 billing transport — Zod schemas for /api/billing/* shared
// between the NestJS billing module and the FE billing screen.
export {
  BillingCycleSchema,
  BillingProviderIdSchema,
  BillingSubscriptionSchema,
  CancelRequestSchema,
  CheckoutRequestSchema,
  CheckoutSessionSchema,
  PaddleCheckoutSessionSchema,
  PurchasableTierSchema,
  RazorpayCheckoutSessionSchema,
  SubscriptionStatusSchema,
} from './billing';
export type {
  BillingCycle,
  BillingProviderId,
  BillingSubscription,
  CancelRequest,
  CheckoutRequest,
  CheckoutSession,
  PaddleCheckoutSession,
  PurchasableTier,
  RazorpayCheckoutSession,
  SubscriptionStatus,
} from './billing';
// D162 / D165 transactional-email preferences — shared between the
// PATCH /api/me/email-prefs route and the EmailSendWorker opt-out check.
export {
  DEFAULT_EMAIL_PREFS,
  EmailPrefsPatchSchema,
  EmailPrefsSchema,
  parseEmailPrefs,
} from './email-prefs';
export type { EmailPrefs, EmailPrefsPatch } from './email-prefs';

// D66 Daily Brief schedule preferences — shared between the
// PATCH /api/me/brief-prefs route and the BriefSnapshotWorker's
// generation-time weekend gate (Mon–Fri default; weekends opt-in).
export {
  BriefPrefsPatchSchema,
  BriefPrefsSchema,
  DEFAULT_BRIEF_PREFS,
  parseBriefPrefs,
} from './brief-prefs';
export type { BriefPrefs, BriefPrefsPatch } from './brief-prefs';

// D34 + D226 action-sheet skip preferences — shared between the
// PATCH /api/me/action-sheet-prefs route and the FE triage store
// hydration (the sheet is skippable per verb; the preview never is).
export {
  ActionSheetPrefsPatchSchema,
  ActionSheetPrefsSchema,
  DEFAULT_ACTION_SHEET_PREFS,
  parseActionSheetPrefs,
} from './action-sheet-prefs';
export type { ActionSheetPrefs, ActionSheetPrefsPatch } from './action-sheet-prefs';

// Settings index read (D34 + D116 + D165) — GET /api/me/settings.
export { MeSettingsSchema } from './me-settings';
export type { MeSettings } from './me-settings';

// D51 saved sender filter views — shared between the PATCH
// /api/me/sender-views route and the FE ComposeStrip Views menu.
export {
  parseSenderViews,
  SavedSenderViewSchema,
  SENDER_VIEWS_CAP,
  SenderViewsPutSchema,
  SenderViewsSchema,
} from './sender-views';
export type { SavedSenderView, SenderViewsPut } from './sender-views';

// D116 + D228 data export — GET /api/account/export format contract.
export { DataExportFormatSchema } from './data-export';
export type { DataExportFormat } from './data-export';

// Private-beta invite gate (buildout F7) — API ↔ web redirect contract
// for denied signups. See ./beta-gate.ts for the env + flow contract.
export { BETA_DENIED_PATH, BETA_DENIED_REASON, BETA_DENIED_REASON_PARAM } from './beta-gate';

// U27 — Activity feed rule attribution (D57): `rule` ref on
// `GET /api/activity` rows, resolved from `activity_log.rule_id`.
export { ActivityRuleRefSchema } from './activity';
export type { ActivityRuleRef } from './activity';

// D78–D80 Snoozed/Later review surface — list row + snooze/wake wire
// shapes shared between the snoozed controller and the FE screen.
export { SNOOZE_REASON_MAX_LENGTH, SnoozeUpdateRequestSchema } from './snoozed';
export type {
  SnoozedSenderRow,
  SnoozeUpdateRequest,
  SnoozeUpdateResult,
  WakeNowResult,
} from './snoozed';

// U18 quiet hours — GET/PUT /api/mailboxes/:id/quiet-hours (D92, D95)
// + the window math the Autopilot deferral guard evaluates (D93 seam).
export {
  isValidTimeZone,
  isWithinQuietWindow,
  minutesOfDayInZone,
  msUntilQuietWindowEnd,
  parseTimeToMinutes,
  QuietHoursConfigSchema,
} from './quiet-hours';
export type { QuietHoursConfig, QuietHoursState } from './quiet-hours';

// D205/D216/D232 account deletion — request/cancel/status transport
// shared between apps/api/src/account and the FE account-deletion feature.
export {
  AccountDeletionBasisSchema,
  AccountDeletionPendingSchema,
  AccountDeletionProjectionSchema,
  AccountDeletionRequestSchema,
  AccountDeletionStatusSchema,
  DELETION_CONFIRM_PHRASE,
  DELETION_WAIVER_PHRASE,
} from './account-deletion';
export type {
  AccountDeletionBasis,
  AccountDeletionPending,
  AccountDeletionProjection,
  AccountDeletionRequest,
  AccountDeletionStatus,
} from './account-deletion';

// D245 mailbox-only indexed-data deletion — explicit disconnect vs purge.
export {
  MAILBOX_DATA_DELETION_CONFIRM_PREFIX,
  mailboxDataDeletionConfirmPhrase,
  MailboxDataDeletionRequestSchema,
  MailboxDataDeletionStatusSchema,
  MailboxDataDeletionViewSchema,
  MailboxIndexedDataStateSchema,
} from './mailbox-data-deletion';
export type {
  MailboxDataDeletionReceipt,
  MailboxDataDeletionRequest,
  MailboxDataDeletionStatus,
  MailboxDataDeletionView,
  MailboxIndexedDataState,
} from './mailbox-data-deletion';
