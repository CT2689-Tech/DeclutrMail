/**
 * User-facing label override for the 5 launch presets (D101 + D124).
 *
 * The BE's `automation_rules.name` carries the preset's installed name
 * (set by the seed script + the apply-worker). For most presets the BE
 * name is fine — but `auto_screen_new_senders` ships with the
 * default-name "Auto-screen new senders", which uses the banned
 * product-UI verb "Screen" (D227 — only K/A/U/L are user-facing). At
 * the UI layer we substitute the canonical Later vocabulary so the
 * Autopilot screen stays compliant without round-tripping the rename
 * through a BE migration.
 *
 * When the BE rename lands (tracked in FOUNDER-FOLLOWUPS.md), this
 * file becomes a no-op — `preset_key` → BE name is the source of truth
 * and the override map can be deleted.
 */

import type { AutopilotPresetKey } from '@/lib/api/autopilot';

const PRESET_LABEL_OVERRIDES: Partial<Record<AutopilotPresetKey, string>> = {
  // D227: "Screen" is an internal enum, never a user-facing verb. The
  // canonical fourth verb is Later (L); the preset's actionKind is
  // already 'later'.
  auto_screen_new_senders: 'Later for new senders',
};

/**
 * Returns the user-facing label for a rule. Prefers an override; falls
 * back to the BE-supplied name. The fallback is what makes this
 * forward-compatible: when the BE catches up, no override means we
 * surface whatever name the BE chose.
 */
export function presetDisplayName(
  presetKey: AutopilotPresetKey | null,
  fallbackName: string,
): string {
  if (presetKey == null) return fallbackName;
  return PRESET_LABEL_OVERRIDES[presetKey] ?? fallbackName;
}
