// @declutrmail/shared/copy — canonical user-facing copy modules.
//
// Importers should pull from here (or the named submodule) rather
// than inlining strings, so the microcopy audit hooks (D194/D209/D228)
// only have to guard a single source of truth.

export {
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_BADGE_LEAD,
  PRIVACY_STORAGE_LABEL,
  PRIVACY_NEVER_LABEL,
  GMAIL_PREVIEW_FIELD_LABEL,
  OAUTH_SCOPE_DISCLOSURE,
  CASA_VERIFICATION_APPROVED_ON,
  CASA_VERIFICATION_APPROVED_MONTH,
} from './privacy';

export { BUSINESS_POSTAL_ADDRESS, postalAddressLine, hasPostalAddress } from './postal-address';

export {
  PROTECTION_REASON_IDS,
  WEAK_PROTECTION_REASON_IDS,
  isWeakProtectionReason,
  normalizeProtectionReason,
  protectionReasonClause,
  protectionReasonLabel,
  type ProtectionReasonId,
} from './protection';

export {
  ACTION_SAFETY_SUMMARY,
  ACTION_PREVIEW_CLAIM,
  DELETE_RECOVERY_CLAIM,
  MANUAL_ACTION_SCOPE_CLAIM,
  BRIEF_AI_DISCLOSURE,
  RECOMMENDATION_AI_DISCLOSURE,
  AI_PROCESSING_DISCLOSURE,
  ANALYTICS_PRIVACY_CLAIM,
} from './action-safety';
