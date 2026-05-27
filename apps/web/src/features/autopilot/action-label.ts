/**
 * Maps the engine's `actionKind` enum to a user-facing verb phrase used
 * in the D104 suggestion row. Canonical K/A/U/L vocabulary per D227 —
 * Autopilot never emits Keep (no-op), so only three branches exist.
 */

import type { AutopilotActionKind } from '@/lib/api/autopilot';

/** "would archive" / "would unsubscribe" / "would move to Later". */
export function describeWouldAction(kind: AutopilotActionKind): string {
  switch (kind) {
    case 'archive':
      return 'would archive';
    case 'unsubscribe':
      return 'would unsubscribe';
    case 'later':
      return 'would move to Later';
  }
}
