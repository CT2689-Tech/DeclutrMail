## 2026-10-12 — A streamed invoice read can hydrate as its resolved tree

**Context:** Complimentary `/billing` hydrated after the shell stopped seeding the subscription query. A paid plan still threw React #418. The server HTML was the invoice skeleton. The client rendered the provider's "Try again" result.

**Finding:** Invoice history is stream-prefetched and not awaited. Next can deliver the fulfilled Flight value before the client hydrates. TanStack promotes a synchronous `then` during render, so the first client tree is the resolved list while the flushed HTML is still the skeleton. Wrapping the promise in `Promise.resolve` is not enough once that value is already in the cache.

**Rule (provisional):** A section streamed as pending must keep its server placeholder through the hydration render, and only reveal the resolved value after mount.

**Distillation trigger:** promote to CLAUDE.md §8 if another streamed section hydrates a fulfilled payload over its own skeleton.
