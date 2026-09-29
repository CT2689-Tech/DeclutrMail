## 2026-09-27 — `waitFor` exits on its first passing check, so it can't prove a value survived a later event

**Context:** Writing the regression test for #808's stale-read race — a background poll's response landing after a save's `setQueryData`, potentially clobbering the just-saved value.

**Finding:** The test resolves the stale response, then checks the cache holds the saved (not the stale) value. Wrapping that check in `waitFor(() => expect(cache).toMatchObject({enabled: false}))` passed on BOTH the fixed code and a negative control with the fix disabled — the assertion is already true the instant the save's own `onSuccess` runs, before the stale response has even landed, so `waitFor`'s first poll (near-immediate) sees the correct value and returns, whether or not the race is actually guarded. A test that passes identically with the guard removed is exactly the "guard that cannot fail" class (§8), just on the test side of the fence rather than the product side. Caught only because the fix was verified against a deliberate negative control, not by reading the test.

**Rule (provisional):** `waitFor` is for "this becomes true" — a value that starts wrong and should end right. It is the wrong tool for "this stays right after X" when the right state already holds before X happens. For that shape, resolve the deferred promise, then flush with a real timer delay (a `setTimeout` a `waitFor` wouldn't short-circuit) before the one-shot assertion — and always run the negative control on the finished test, not just the finished code.

**Distillation trigger:** promote to CLAUDE.md §8 if another `waitFor`-around-a-post-race assertion is found passing on a broken negative control.
