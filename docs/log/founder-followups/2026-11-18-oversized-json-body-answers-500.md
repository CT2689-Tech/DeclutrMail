### 2026-11-18 — A JSON body over 100 KB answers 500 on every route

**Source:** review finding on [CT2689-Tech/DeclutrMail#1209](https://github.com/CT2689-Tech/DeclutrMail/pull/1209) (MCP connector PR 1). Not caused by that PR and not fixed in it.
**Why:** Nest's body parser rejects a body over its 100 KB limit with an error that is not a Nest `HttpException`. `AllExceptionsFilter.resolve()` treats anything that is not one as `INTERNAL_ERROR`, so the caller gets a 500 and the log gets an `exception.5xx` line. Reproduced on `POST /oauth/register` with a 200 KB body; by reading the filter, every JSON route behaves the same. An anonymous caller can therefore raise 5xx counts (and any alert built on them) at will, and the rate limiter does not help: it runs after the body is parsed.
**How:** decide whether to fix it in the filter. The change is small: in `apps/api/src/common/all-exceptions.filter.ts`, answer a body-parser error (`type === 'entity.too.large'`, status 413) with its own 4xx status instead of falling through to 500, and add a test that posts an oversized body. It was left out of the connector PR because it changes a shared filter for every route.
**Verifies by:** `curl -X POST <api>/api/<any-json-route> --data-binary @200kb.json` answers 413, and no `exception.5xx` line is logged for it.
**Status:** Open
