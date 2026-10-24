### 2026-10-24 — Account type, push credentials and store-purchase provider for the mobile launch
**Source:** session (mobile launch, ADR-0047, mobile-launch-plan-2026-10-24.md)
**Why:** Billing (in-app purchase plus web), push, the swipe grammar and the sign-in design are decided. These items are not, and each needs you or a credential.
**How:**
1. Developer accounts: enroll Apple Developer and Google Play, as an individual or as an entity. This sets the seller name and, for Play, how long production access takes.
2. Push: create a Firebase project and an APNs key; hand them over through the secrets inventory, never in chat.
3. Store purchases: choose between verifying store receipts and notifications ourselves, or a subscription service. Check fees and terms first; they are unverified.
4. Ask Google whether a new OAuth client in the existing project needs re-verification. The handoff design needs no new client, so this can run in parallel.
5. Set a first-30-days activation target and a monthly budget for the launch campaign.
**Verifies by:** both store accounts exist, the push credentials are in the secrets inventory, and the subscription-provider choice is recorded in the billing ADR.
**Status:** Open
