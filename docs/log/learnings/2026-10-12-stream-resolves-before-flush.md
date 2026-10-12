## 2026-10-12 — A streamed read can resolve before the HTML flushes

**Context:** Paid `/billing` still threw React #418 on about 6% of loads when invoices returned immediately. At 150ms and above, the same build was clean.

**Finding:** The placeholder tag is applied while the snapshot is pending. If that promise settles and the server renders again before flush, the cache already holds the resolved list and the replay paints it. The client still hydrates the pending snapshot, so the trees differ. Dropping that cache entry on the server pass keeps the flushed HTML on the placeholder.

**Rule (provisional):** A streamed section's server pass must paint the placeholder even when the same read has already filled the cache.

**Distillation trigger:** promote to CLAUDE.md §8 if another streamed section replays a resolved cache over its own placeholder.
