### 2026-10-24 — Approve the permanent app identity and the native sign-in design
**Source:** session (mobile launch, ADR-0049)
**Why:** `com.declutrmail.app` is now the iOS bundle id, the Android application id and the sign-in return scheme. Store identifiers cannot change after the first upload, and the sign-in handoff adds a session-issuing path, which is yours to review.
**How:**
1. Confirm or replace `com.declutrmail.app` before the first TestFlight or Play upload. Changing it later means editing `apps/mobile/capacitor.config.ts`, the iOS and Android identity files and `NATIVE_APP_SCHEME`; `apps/mobile/native-identity.test.ts` fails until they agree.
2. Read `docs/adr/0049-native-sign-in-handoff.md` (threat model and the device checks it could not run here) and approve or amend it.
**Verifies by:** ADR-0049 status is Accepted and the identifier is recorded in the store consoles.
**Status:** Open
