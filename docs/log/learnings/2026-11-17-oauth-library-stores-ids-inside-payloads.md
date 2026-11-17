## 2026-11-17 — An OAuth library's payload can carry the secret you hashed the key for

**Context:** PR 1 of the MCP connector (ADR-0048) puts `oidc-provider`
behind a storage adapter that must keep only hashes of tokens, codes and
request ids. The adapter hashed the lookup key and stripped `jti` from the
stored payload, and the first version looked finished.

**Finding:** Two things only showed up by running it.

- The library's Interaction payload also holds `returnTo`, a URL that ends
  in the request id. The hash-only test (dump every `oauth_*` row, assert no
  raw value appears) failed on it. The fix is to not store `returnTo` and
  rebuild it from the configured issuer on read — which also stops the
  resume URL depending on the request's Host header.
- Scopes listed in the library's top-level `scopes` option are OpenID scopes.
  Putting our resource scopes there made every approval loop back to a second
  consent prompt. Resource scopes belong only in
  `features.resourceIndicators.getResourceServerInfo`.

Also: the MCP TypeScript SDK's v2 packages (`@modelcontextprotocol/server`)
ship resource-server helpers only. The authorization-server router exists in
the frozen v1 line alone, so it is not a maintained base for an AS.

**Rule (provisional):** When a library owns a record's shape, prove a
"never stored" claim by scanning what was actually written, not by reading
the fields you chose to strip. Prototype the library's full flow against an
in-memory adapter before mapping it onto tables.

**Distillation trigger:** promote to CLAUDE.md §8.5 if a second "we do not
store X" claim is found false by a row scan rather than by review.
