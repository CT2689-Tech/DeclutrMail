### 2026-09-01 — Let phone users exclude a Senders filter

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-09-01.
**Why:** On `/senders`, "not active" and the other excluded filters are reached only by alt-click or right-click on a chip (`apps/web/src/features/senders/filters.tsx`). Phones have neither, so half the filters are out of reach on mobile, and nothing on screen says so. The desktop labels were fixed on 2026-09-01; the phone control was deferred.
**How:**
1. Verify first, at 375px and on a real phone, that no gesture reaches the exclude state today.
2. Add a visible control in the phone filter sheet, for example an Include / Exclude choice per chip. A long-press alone is hidden, so pair it with something on screen.
3. Add a Storybook story, and keep the `aria-label` text that tells "only X" from "not X".
**Verifies by:** at 375px a user can set "not active" with a visible control, and `/ct-qa senders-filtering` passes that step.
**Who:** Engineering (an agent can do it)
**Status:** Open
