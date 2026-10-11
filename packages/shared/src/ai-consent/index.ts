export {
  aiConsentFromPartial,
  aiConsentPatch,
  aiConsentView,
  briefConsentActive,
  briefLlmEnabled,
  consentCard,
  EMPTY_AI_CONSENT,
  explainLlmEnabled,
  explanationsConsentActive,
  grantedAiConsentInsert,
} from './gate.js';
export type {
  AiConsentBriefState,
  AiConsentCard,
  AiConsentDecision,
  AiConsentExplanationsState,
  AiConsentPatch,
  AiConsentStored,
  AiConsentView,
  ConsentMark,
} from './gate.js';
export { validateLlmOutput } from './output.js';
export type { LlmOutputVerdict } from './output.js';
export { PLAIN_STALE_CLAIM, plainVolumeExplanation } from './plain.js';
export { quoteUntrusted, sanitizeUntrusted } from './sanitize.js';
export { AiConsentDecisionSchema, AiConsentViewSchema } from './schema.js';
