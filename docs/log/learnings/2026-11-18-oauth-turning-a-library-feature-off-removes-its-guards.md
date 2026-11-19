## 2026-11-18 — Turning a library feature off also turns off the guards it carried

**Context:** PR 1 of the MCP connector (ADR-0048) configures `oidc-provider`
as an OAuth authorization server. Two fresh-context adversarial reviews ran
after the tests, negative controls and smoke were green.

**Finding:** The defects were not in code we wrote. They were in what the
library still did, or stopped doing, once configured.

- We never persist the library's own login session (`NoSessionStore`), so
  consent always goes through our session. That also removed the library's
  check that the browser resuming a request is the one that approved it. A
  resume carrying only the request's signed cookie was given the code. The
  fix binds the code release to our session at the one hook the library
  calls on resume (`findAccount`).
- Registration is open to anyone, and the library accepts every OpenID
  metadata field by default. Two of them (`sector_identifier_uri`,
  `jwks_uri`) are URLs it fetches, at registration and again when it loads
  the client. A policy that only checked the fields we cared about left an
  anonymous caller able to make the API open outbound connections and to
  store 90 KB rows.
- Our tests ran on PGlite and the HTTP layer accepted any string. Postgres
  refuses U+0000 in text and jsonb and unpaired surrogates in jsonb, so a
  null character in any parameter was a 500 with the failed query's
  parameters in the log line.
- A retention rule written as "has no grant now" also matched "had a grant
  that this same pass just removed", and deleted registrations apps still
  hold.

Every one of these stayed green under 58 negative controls, because a
negative control only proves a test notices the guard it was written for.

**Rule (provisional):** For a protocol library, review the configuration by
asking two questions of each feature switched off or left at its default:
what did this feature also enforce, and what will it do with a field an
anonymous caller chooses. Allowlist the input of an unauthenticated
endpoint; never list only what to reject.

**Distillation trigger:** promote to CLAUDE.md §8 if PR 2 or PR 3 of the
connector finds another defect of the shape "the library still did X".
