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
 * Keep is inline; affected-email previews apply to mail-moving actions.
 */
const activityUndoWindow =
  UNIFORM_UNDO_WINDOW_DAYS === null
    ? 'until the deadline shown there'
    : `for ${UNIFORM_UNDO_WINDOW_DAYS} days`;

export const softwareApplicationDescription = `Gmail cleanup with one decision per sender: Keep, Archive, Unsubscribe, Later, or Delete. Before a manual action moves email, see the matching count, a sample when available, and the planned Gmail changes. Keep records an inline decision. Unsubscribe confirms the request method and any separate cleanup. Archive, Later, and Delete can be undone from Activity ${activityUndoWindow}; a delivered unsubscribe request cannot be recalled.`;
