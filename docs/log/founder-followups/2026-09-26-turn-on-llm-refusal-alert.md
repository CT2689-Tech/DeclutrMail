### 2026-09-26 — Turn on the alert for a refused Anthropic account

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-09-26.
**Why:** When Anthropic refuses our calls (credit, limit or key), the worker logs `llm.provider_rejected` and stops calling. A log line pages nobody until the GCP log metric and alert policy exist, and creating them needs GCP credentials. On 2026-09-24 a refusal went unseen for about 20 hours (`scripts/setup-llm-rejection-alert.mjs` header).
**How:**
1. Run `gcloud auth login`.
2. Run `node scripts/setup-llm-rejection-alert.mjs --apply`. It creates the metric `llm_provider_rejected` and the alert policy, reuses the existing admin email channel, then reads both back.
3. Run the drill from the original entry (`git show cb785809:FOUNDER-FOLLOWUPS.md`, 2026-09-26): one synthetic log line marked DRILL. Expect one alert email within about 5 minutes.
4. If the script already says configured, check in GCP Monitoring that the policy is enabled and not snoozed.
**Verifies by:** `node scripts/setup-llm-rejection-alert.mjs` prints `Configured:` and exits 0, and the drill email arrives naming `reason=other`.
**Who:** Founder
**Status:** Open
