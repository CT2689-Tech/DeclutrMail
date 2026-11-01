## 2026-11-01 — A browser checkout hold outlived the attempt it named

**PR:** #1190 (https://github.com/CT2689-Tech/DeclutrMail/pull/1190)
**Caught by:** user report (founder, local smoke of the billing redesign); the first fix's gaps by the adversarial and flow-completeness reviews
**What happened:** The billing screen keeps a browser-local hold for the checkout
attempt it opened, and only the subscription read's `checkoutAttempt` could release
it. That read reports the workspace's LATEST attempt only. Once a newer attempt
existed (a Backlog Pass started in one browser, Plus bought from another), the older
hold was never mentioned again: the screen showed "Checkout started — your Backlog
Pass hasn't come through yet" indefinitely, its provider check could not see a Pass
without the server claim, no release was offered for checkout kinds, and "Update
payment method" stayed locked behind it.
**Correct approach:** A lock keyed to one server object must be resolvable by asking
about that object, not by waiting for a list read that may stop naming it. The screen
now reads `GET /api/billing/checkout/:id` for a hold the latest read does not name and
releases it on the server's own terminal state (or, for a hold the server provably
created, on its absence). The server already refuses a new checkout while any attempt
is unresolved, so the browser hold is never the double-charge guard on its own.
**Rule:** Every client-side lock needs a release path that reads the exact thing it
locks; "the next read will mention it" is not one when the read is latest-only.
**Enforcement update:** none (tests in `billing-screen.test.tsx` "a hold on a checkout
the latest read no longer names")

**The first fix repeated the defect one branch away.** Its release re-read local
storage and returned when there was no record, but a hold this browser BUILT from the
server read is never stored. The device that did not start the checkout therefore kept
the lock, now with no notice at all, which is quieter than the bug it replaced. The
same fix aborted its check on every 3s subscription poll, so a check slower than the
poll never landed, and it had no timeout. Its own tests passed because each held a
stored record and answered instantly. Fixed in `c8e7402b`: the release clears the
in-memory hold, the check is a bounded query the poll does not cancel, and tests cover
a server-built hold and a slow check, both red against the first fix.
**Rule (added):** when fixing a lock, enumerate every way the lock is CREATED and give
each its own release test; a release that reads one store cannot free a lock another
path never wrote there.
