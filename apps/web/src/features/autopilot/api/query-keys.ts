/**
 * TanStack Query keys for the Autopilot surface (D200).
 *
 * Centralised so mutations (pause-all, dismiss) can invalidate exactly
 * the lists they affect — `rules` and `pendingSuggestions` are
 * independent slices of state.
 */

export const autopilotKeys = {
  all: ['autopilot'] as const,
  /** All rules — mode/enabled status drives both the pause UI and the rules list. */
  rules: () => ['autopilot', 'rules'] as const,
  /** D104 buffer — Observe-mode matches awaiting the user's decision. */
  pendingSuggestions: () => ['autopilot', 'pending-suggestions'] as const,
};
