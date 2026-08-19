// packages/shared/src/senders/index.ts — re-exports for `@declutrmail/shared/senders`.
export { brandRoot } from './brand-root';
export { evaluateProtectionEvidence, PROTECTION_WROTE_TO_THRESHOLD } from './protection-evidence';
export type { ProtectionEvidenceInput, ProtectionEvidenceReason } from './protection-evidence';
export {
  WINDOWS,
  CONFIDENCE,
  VOLUMES,
  TREND,
  SCORE,
  FREE_MAIL_DOMAINS,
  PATTERNS,
  BUCKET_PRIORITY,
} from './thresholds';
export type { SenderBucket, VelocityBucket } from './thresholds';
