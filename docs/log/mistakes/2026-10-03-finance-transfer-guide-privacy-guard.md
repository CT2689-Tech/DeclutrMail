## 2026-10-03 — HTTP deadline wording triggered a privacy-copy guard

**PR:** #877 (https://github.com/CT2689-Tech/DeclutrMail/pull/877)
**Caught by:** verify-no-body-storage in CI
**What happened:** Technical HTTP deadline prose matched the guard for prohibited Gmail-content counter claims. The reporter was uploading private finance artifacts, with no Gmail-content access.
**Correct approach:** Describe the HTTP transfer and metadata parsing deadline precisely; run the guard before pushing the corrected candidate.
**Rule:** Check new documentation against privacy-copy guards before claiming CI readiness.
**Enforcement update:** none; no allowlist or guard bypass.
