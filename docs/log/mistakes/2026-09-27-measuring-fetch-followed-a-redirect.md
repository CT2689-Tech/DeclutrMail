## 2026-09-27 — A measuring fetch followed a redirect and credited /demo with the inbox simulator's weight

**PR:** #806 (https://github.com/CT2689-Tech/DeclutrMail/pull/806)

**Caught by:** the new budget check's own non-200 guard (`redirect: 'manual'`), on its first run against a real build

**What happened:** To check whether the build manifest describes what each route loads, I fetched every route from `next start` with Node's default `fetch`, which follows redirects. /demo's page is `permanentRedirect('/inbox-simulator')`, so the HTML I measured as /demo's was the simulator's, and I reported that /demo loads 55 kB the manifest misses. The same report called /faq and /compare "equal real weight" from a manifest-derived number; in the served HTML they are 7.9 kB apart. Both claims fed a budget-policy decision before I retracted them.

**Correct approach:** fetch with `redirect: 'manual'` and check the status before attributing a response to a route, and check any "these weigh the same" claim against the served HTML before it reaches a decision.

**Rule:** A measurement belongs to the URL that answered, not the URL requested: never follow redirects in a measuring fetch.

**Enforcement update:** `scripts/check-web-bundle-budget.mjs` fails any non-200 that is not a declared redirect, and verifies each declared redirect's target, with contract tests (#806).
