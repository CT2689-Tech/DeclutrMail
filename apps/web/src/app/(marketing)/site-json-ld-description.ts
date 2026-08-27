// The SoftwareApplication `description` for the marketing layout's
// site-wide JSON-LD graph (D132 SEO batch, D245 undo-window copy truth).
//
// Lives in its own module rather than inline in `layout.tsx`: Next's
// generated route types constrain a `layout.tsx` file to its recognized
// special exports (`default`, `metadata`, etc.) and fail `tsc --noEmit`
// on anything else, so this constant cannot be exported from there. A
// plain sibling file has no such restriction, and it lets the D245
// regression guard read the resolved value without rendering the layout.

import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements/undo-window';

/**
 * D245: same derive-or-hedge shape as every other undo-window site.
 * ADR-0030: leads with the preview guarantee, keeps the sender as the
 * mechanism — see `layout.tsx` for the full history of that wording.
 */
export const softwareApplicationDescription =
  UNIFORM_UNDO_WINDOW_DAYS === null
    ? 'Gmail cleanup that previews every action before it runs — the current matching count, an available sample, and the exact Gmail changes — then takes one decision per sender: Keep, Archive, Unsubscribe, Later, or Delete. Archive and Later are reversible from Activity for the plan’s undo window; a delivered unsubscribe request cannot be recalled.'
    : `Gmail cleanup that previews every action before it runs — the current matching count, an available sample, and the exact Gmail changes — then takes one decision per sender: Keep, Archive, Unsubscribe, Later, or Delete. Archive and Later are reversible from Activity for ${UNIFORM_UNDO_WINDOW_DAYS} days; a delivered unsubscribe request cannot be recalled.`;
