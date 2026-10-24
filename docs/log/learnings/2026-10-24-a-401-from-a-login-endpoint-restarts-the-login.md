## 2026-10-24 — A 401 from a login endpoint restarts the login
**Context:** Designing the native sign-in code exchange (ADR-0049).
**Finding:** The web API client answers any 401 by refreshing the session and then redirecting to sign-in. An endpoint that signs the visitor in, and returns 401 for a bad credential, therefore sends the visitor back into the flow that just failed. The exchange returns 400 for every refusal.
**Rule (provisional):** an endpoint reachable before a session exists must not use 401 for its own refusals; check how the client treats 401 before choosing a status.
**Distillation trigger:** promote to CLAUDE.md §8 if pattern recurs >=3 times
