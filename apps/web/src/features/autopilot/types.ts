/**
 * View-model types for the Autopilot screen (D99–D105).
 *
 * The wire shapes live in `@/lib/api/autopilot`; this file holds the
 * UI-only derivations the screen needs (e.g., the rule lookup used to
 * decorate a pending suggestion with its rule's display name).
 */

import type {
  AutopilotMatchDto,
  AutopilotRuleDto,
  AutopilotRulePreviewResultDto,
} from '@/lib/api/autopilot';

/** Pending suggestion + the rule that produced it. */
export interface SuggestionWithRule {
  match: AutopilotMatchDto;
  rule: AutopilotRuleDto | null;
}

/**
 * D104 — pending suggestions grouped under the rule that produced
 * them. `rule` is null only for orphan matches whose rule no longer
 * appears in the rules list (defensive; should not happen with the
 * preset-only V2 surface).
 */
export interface RuleSuggestionGroup {
  rule: AutopilotRuleDto | null;
  matches: AutopilotMatchDto[];
}

/** Dry-run preview panel state for one rule (D103 scoped per D192). */
export type RulePreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; result: AutopilotRulePreviewResultDto };

/** Top-level UI state — one of four branches per D211. */
export type AutopilotScreenState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; retry: () => void }
  | { kind: 'empty'; rules: AutopilotRuleDto[] }
  | {
      kind: 'ready';
      rules: AutopilotRuleDto[];
      suggestions: SuggestionWithRule[];
    };
