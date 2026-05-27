/**
 * View-model types for the Autopilot screen (D104, D105).
 *
 * The wire shapes live in `@/lib/api/autopilot`; this file holds the
 * UI-only derivations the screen needs (e.g., the rule lookup used to
 * decorate a pending suggestion with its rule's display name).
 */

import type { AutopilotMatchDto, AutopilotRuleDto } from '@/lib/api/autopilot';

/** Pending suggestion + the rule that produced it. */
export interface SuggestionWithRule {
  match: AutopilotMatchDto;
  rule: AutopilotRuleDto | null;
}

/** Top-level UI state — one of four branches per D211. */
export type AutopilotScreenState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty'; rules: AutopilotRuleDto[] }
  | {
      kind: 'ready';
      rules: AutopilotRuleDto[];
      suggestions: SuggestionWithRule[];
    };
