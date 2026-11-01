## 2026-11-01 — A browser checkout hold outlived the attempt it named

**PR:** pending (feat/d119-billing-screen-redesign)
**Caught by:** user report (founder, local smoke of the billing redesign)
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
