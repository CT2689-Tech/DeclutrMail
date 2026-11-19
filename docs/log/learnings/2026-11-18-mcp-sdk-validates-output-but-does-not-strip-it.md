## 2026-11-18 — The MCP SDK validates a tool's output but does not strip it, and it forwards exception text

**Context:** Building the connector's ten tools on `@modelcontextprotocol/server` 2.4.0 (the v2 SDK, newer than most of what an agent remembers about MCP). ADR-0048 rule 3 says a tool may return only fields registered in `gmail-data-inventory.ts`. Each tool declares an `outputSchema`, so it was tempting to treat the SDK as the enforcement.

**Finding:** Probed with a throwaway handler before writing any tool (checked 2026-11-18 against 2.4.0):

- A result with an **extra field** passes. The SDK validates `structuredContent` against the output schema — a missing required field is an error — but returns the object the handler gave it, extra keys included. Zod strips on `parse`; the SDK does not use the parsed value.
- A handler that **throws** has its `error.message` sent to the client as the tool's text content. A driver error ("relation … does not exist", a connection string) would reach the model verbatim.
- A result with `isError: true` is **not validated** against the output schema at all.
- `scopeChallenge: requireScopes(...)` answers HTTP 403 with `WWW-Authenticate: … insufficient_scope` before the handler runs. It reads scopes from `authInfo`, which the server takes on trust from whoever built it.
- A pre-2026 client is answered as `text/event-stream` even with `responseMode: 'json'`.

So the wrapper around every tool (`McpServerService.register`) does three things the SDK does not: parses the result through the tool's own schema and returns the **parsed** value, catches everything and maps it to a closed set of tool errors (unknown ones become a fixed sentence and a Sentry event), and re-checks the scope inside the handler.

**Rule (provisional):** A library that advertises a schema is not thereby enforcing it. Before relying on a boundary a dependency seems to give you, write the four-line probe: extra field, thrown error, error result, missing permission. Then assert the property in your own test with a negative control ("result not parsed through the schema" and "raw exception text reaches the assistant" are both in the connector's control list).

**Distillation trigger:** A second place where a declared schema or contract was assumed to filter and did not.
