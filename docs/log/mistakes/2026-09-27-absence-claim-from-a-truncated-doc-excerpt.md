## 2026-09-27 — Claimed a vendor schema lacked a field, from a truncated excerpt

**PR:** #795 (https://github.com/CT2689-Tech/DeclutrMail/pull/795); caught before this follow-up was committed
**Caught by:** manual check of the full source before committing the claim
**What happened:** To justify failing closed on a missing Upstash `budget`, I read the Database schema through a documentation search tool (Context7). Its excerpt stopped partway through the object, and I told the orchestrator and the founder that Upstash's published schema lists neither `budget` nor `type`. The full `devops/developer-api/openapi.yaml` in upstash/docs lists both: `type` (free, payg, pro, paid) and `budget` (an integer). The orchestrator accepted the fail-closed decision partly on the false claim. The decision holds on the correct fact, since a response without the documented field is off-contract. The code comment that would have carried the claim was corrected before commit.
**Correct approach:** before saying a source does not contain something, read the whole source (fetch the file and grep it), not an excerpt or a search result. An excerpt that is silent on a field is not evidence the field is absent.
**Rule:** an absence claim ("X does not list Y") needs the full source read and cited; otherwise say "not in the excerpt I read".
**Enforcement update:** none
