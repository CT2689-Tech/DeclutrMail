### 2026-10-24 — Decide native sign-in, billing path and developer accounts
**Source:** session (mobile prototype, ADR-0047)
**Why:** The prototype runs through the dev test-login only. A store-bound build needs three decisions that CLAUDE.md §2.0 reserves for the founder, and the developer accounts have enrollment lead time.
**How:**
1. Sign-in: approve or reject a one-time-code handoff so a system-browser Google sign-in can reach the WebView (a new auth surface; Tier 1).
2. Billing: choose free-tier-only in the app, in-app purchase through a third provider, or external link-out where the store allows it. Check each store's current rules first; they are changing.
3. Accounts: enroll Apple Developer and Google Play, as an individual or as an entity. This decides the seller name shown and, for Play, how long production access takes.
**Verifies by:** ADR-0047 gains an Accepted amendment naming the three choices, and both store accounts exist.
**Status:** Open
