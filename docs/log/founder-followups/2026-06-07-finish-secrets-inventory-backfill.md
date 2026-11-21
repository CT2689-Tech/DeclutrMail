### 2026-06-07 — Finish the secrets inventory backfill

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-06-07.
**Why:** `docs/runbooks/secrets-inventory.md` says where each secret lives, but the recovery path depends on a password-manager copy nobody can check from the repo, three rows still lack a rotation date, and the quarterly review it asks for is not scheduled anywhere.
**How:**
1. Mirror each inventory row into your password manager: label, value, vendor URL, rotation steps. Never paste values into the repo.
2. Fill the `Rotated` cell for the Vercel billing-watchdog token (line 153), the beta invite allowlist (line 268) and the local GitHub token (line 300). If the beta gate is retired (production sets `BETA_GATE_ENABLED=false`), remove that row instead.
3. Add a quarterly review entry in `docs/log/founder-followups/`, as the "Rotation cadence" section (line 363) asks: re-read the inventory, rotate anything older than 12 months, mirror rotations to the vault.
**Verifies by:** every row has a date or `n/a` with a reason, and the quarterly entry exists.
**Who:** Founder
**Status:** Open
