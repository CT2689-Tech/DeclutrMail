// @declutrmail/shared/flags — pure flag resolution (ADR-0025).
//
// Platform-agnostic on purpose: callers hand in an env record, so the
// same functions serve the API/workers (process.env at runtime), the
// web build (next.config.ts snapshot), and tests (literal objects).

import { FLAG_MANIFEST, FEATURE_FLAGS, type FeatureFlag } from './manifest';

/** `darkMode` → `DM_FLAG_DARK_MODE`. */
export function flagEnvKey(flag: FeatureFlag): string {
  return `DM_FLAG_${flag.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
}

const TRUTHY = new Set(['1', 'true', 'on', 'yes']);
const FALSY = new Set(['0', 'false', 'off', 'no']);

/**
 * Resolve one flag against a raw env value. Unset or unrecognized
 * values fall back to the manifest default — a typo'd override can
 * never dark-launch or kill a feature silently.
 */
export function resolveFlag(flag: FeatureFlag, envValue: string | undefined): boolean {
  const normalized = envValue?.trim().toLowerCase();
  if (normalized !== undefined) {
    if (TRUTHY.has(normalized)) return true;
    if (FALSY.has(normalized)) return false;
  }
  return FLAG_MANIFEST[flag].default;
}

/** Resolve the whole manifest against an env record (e.g. process.env). */
export function resolveAllFlags(
  env: Record<string, string | undefined>,
): Record<FeatureFlag, boolean> {
  const out = {} as Record<FeatureFlag, boolean>;
  for (const flag of FEATURE_FLAGS) {
    out[flag] = resolveFlag(flag, env[flagEnvKey(flag)]);
  }
  return out;
}
