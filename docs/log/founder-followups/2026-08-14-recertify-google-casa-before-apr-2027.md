### 2026-08-14 — Recertify the Google OAuth (CASA) verification before 21 Apr 2027

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-14.
**Why:** The CASA verification behind Google OAuth recertifies every year. The recorded approval is 21 April 2026 (`CASA_VERIFICATION_APPROVED_ON`, `packages/shared/src/copy/privacy.ts:77`), and every public mention reads that one constant. No code can do the recertification.
**How:**
1. Around 20 Feb 2027, start the CASA reassessment with the assessor and Google.
2. When Google approves, update `CASA_VERIFICATION_APPROVED_ON` and the month and letter-of-validation constants next to it in `privacy.ts`.
3. Run `pnpm --filter @declutrmail/web exec vitest run`; `apps/web/src/features/marketing/casa-claim.test.ts` fails if a date is written anywhere else.
4. Related: `docs/log/founder-followups/2026-11-17-mcp-connector-google-verification.md`.
**Verifies by:** the constant matches Google's new approval date and the web tests pass.
**Who:** Founder
**Status:** Open
