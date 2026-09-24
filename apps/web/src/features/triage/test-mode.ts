/**
 * Test helper — pick the Triage view mode the way a returning user's
 * device does: through the persisted per-device preference. Focus mode
 * is the default; the suites that exercise the list's expand → verb
 * path opt into it here instead of through a test-only prop.
 */
import { TRIAGE_MODE_STORAGE_KEY } from './triage-screen';

export function storeTriageMode(mode: 'focus' | 'list'): void {
  window.localStorage.setItem(`dm.${TRIAGE_MODE_STORAGE_KEY}`, JSON.stringify(mode));
}
