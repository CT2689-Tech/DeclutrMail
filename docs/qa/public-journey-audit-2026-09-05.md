# Public journey, SEO, AEO/GEO, and outreach audit

Reviewed the current source and an isolated optimized production build, not
historical launch notes. Scope: the entire 46-page public sitemap and connected
acquisition journeys. This accompanies the bug fixes in
[the flow audit](flow-audit-2026-09-05.md).

## Findings fixed

| Finding                                                                                                  | Impact                                                                    | Change                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llms.txt` still described Active Autopilot as Pro-only while the entitlement manifest grants it on Plus | Search assistants and prospects could receive conflicting purchase advice | Corrected all three tier claims and the overly broad “every action” preview description; added crawler prose to the existing tier-truth gate. Two tests failed on the old claims and pass with the correction. |
| Default social card still used the old headline                                                          | Shared links did not match the revised landing page                       | Updated the generated card and metadata alt text. Retrieved both public image endpoints and visually inspected the default card.                                                                               |
| Pricing disclosed the OAuth scope but offered no direct route to the detailed pre-consent explanation    | A cautious buyer had to find their own path before connecting             | Added a link beside the pricing permission disclosure to `/sign-in`. The connected journey follows it before OAuth.                                                                                            |
| Landing tests asserted superseded headline, metadata, and paid-rule subhead                              | PR CI would reject the approved landing update                            | Updated the existing assertions for the new positioning and allowance copy; removed the assertion for a paid-rule paragraph that no longer exists.                                                             |
| Browser globals in the local smoke script lacked an ESLint declaration                                   | Repository-wide lint failed although application lint passed              | Declared the globals used inside Playwright browser callbacks.                                                                                                                                                 |

## Connected product journeys

The reusable `packages/e2e/specs/public-journeys.spec.ts` runs at desktop and
phone widths with no Gmail credentials:

1. Guide entry with `ref=reddit` → privacy/methodology → pricing → monthly and
   annual selection → simulator → bulk Archive preview → confirm → undo a demo
   action → signup. The OAuth click retains the original Reddit attribution
   after visiting the simulator.
2. Comparison entry with `ref=hn` → cited-sources anchor → refund terms → pricing
   → detailed Gmail permission explanation → signup with HN attribution intact.

OAuth is intercepted at the request boundary; no Google consent, account
creation, payment, or real email change occurs. The demo uses its own synthetic
state. Actual Gmail and billing rehearsals were completed previously on
founder-owned accounts; this pass does not repeat those operations.

## Verification

- **46/46 public pages** return 200 with one H1, nonempty unique titles and
  descriptions, self-consistent canonical URLs, and no accidental noindex.
- All internal page links and anchors resolve. The additional RSS destination
  resolves. Both share-image endpoints return images.
- Social-crawler requests receive title, canonical, and OG image in the raw
  HTML head, including dynamic pricing/sign-in pages.
- All emitted JSON-LD parses; the existing content tests check schema/content
  consistency. A syntax pass does not promise rich-result eligibility.
- **48 browser checks pass** on the production build: 44 accessibility/hydration
  checks plus four connected-journey/viewport cases.
- **504 public-content/unit tests pass** across 41 files.
- Production build succeeds. The prerender guard passes for **44 static public
  routes**; dynamic exceptions remain intentional. All **51 route bundle
  budgets** pass.
- The whole-site audit is repeatable with
  `node docs/eval/public-site-audit.cjs` against a local built server. It checks
  sitemap, metadata, crawler HTML, schema syntax, links, anchors, and images.

## SEO and answer-engine assessment

The public site already has a useful connected structure: task-specific Gmail
guides, concise answers, comparison pages with sources and verification dates,
a working demo, pricing, and explicit privacy/undo boundaries. Preserve those
links and distinctions. Manual cleanup, opted-in automation, and irreversible
unsubscribe requests must remain clearly separated everywhere.

Technical crawlability and coherent claims are verified here. Actual indexing,
query impressions, AI citations, and production Core Web Vitals are **not
verified**: no authenticated Search Console/Bing reports or field-performance
dataset was inspected. No rankings or conversion improvements are claimed.

Google's current guidance treats AI-search eligibility as an extension of SEO:
use accessible, useful, original content and a clear technical structure. It
explicitly says `llms.txt` is not a Google ranking requirement. We maintain this
existing file for consistency, not as a promised GEO shortcut. See
[Google's generative AI search guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide).
[Bing AI Performance](https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c)
can provide citation evidence once the property is available to the owner.

Comparison pages carry verification dates from August 13–30, 2026. This pass
verified their source-link structure and internal product claims; it did not
independently re-research every third-party vendor claim. Recheck a comparison's
specific vendor evidence before using it in a new campaign. Preserve attributable
update dates rather than bumping them automatically.

## Outreach readiness and remaining work

Use entry pages that match the promise, then let readers verify and try it:

| Audience/intent                       | Entry page                      | Next useful step                                                           |
| ------------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| Overwhelming Gmail inbox              | `/`                             | Demo or free signup                                                        |
| Wants to clean by sender              | `/how-to/clean-gmail-by-sender` | Demo and pricing                                                           |
| Concerned about granting Gmail access | `/sign-in` or `/methodology`    | Stored-data disclosure and signup                                          |
| Considering an alternative            | Relevant `/vs/...` page         | Sources, pricing, demo                                                     |
| Gmail storage full                    | `/how-to/gmail-storage-full`    | Understand permanent deletion; do not promise that archiving frees storage |

Use supported `ref` values (`hn`, `ph`, `reddit`, `simulator`, `x`, `linkedin`)
for those channels. The existing attribution contract ignores arbitrary values
such as `ref=email`; generic UTM parameters do not become durable signup source
attribution. Define and implement email/campaign attribution before claiming
campaign-level outreach reporting. Analytics remains consent-gated; the browser
journeys prove referral preservation only to the OAuth entry boundary.

Live Gmail and billing rehearsals are already complete, reconfirmed by the
founder on 2026-09-05. `FOUNDER-FOLLOWUPS.md` records billing completion on
2026-09-01; `docs/qa/launch-qa.md` records real Gmail sync checks. Direct Paddle
transaction re-verification in this session stopped at the browser login screen.
These are prior completed rehearsals, not new provider checks from this audit.

Before scaling outreach: verify the changed deployed journey, inspect
owner-accessible search/indexing reports, and
collect real product evidence with permission. Do not invent testimonials,
conversion lift, or user counts. No outreach messages or directory submissions
were sent in this session.

## Lighthouse follow-up

The production build passed the repository's Lighthouse thresholds using three
desktop runs per URL (local lab measurements, not production field data).

| Page                            | Performance | Accessibility | Best practices | SEO |
| ------------------------------- | ----------- | ------------- | -------------- | --- |
| `/`                             | 100         | 100           | 100            | 100 |
| `/pricing`                      | 100         | 100           | 100            | 91  |
| `/security`                     | 100         | 100           | 100            | 100 |
| `/how-to/clean-gmail-by-sender` | 100         | 100           | 100            | 100 |

Pricing initially scored 98 for accessibility because its plan headings jumped
from H1 to H3. They now use H2 with unchanged visual styles. After rebuilding,
three pricing runs score 100 for accessibility; all 44 pricing tests, 48 browser
checks, and the 46-page site audit pass again.

Pricing's SEO score of 91 reflects the existing dynamic route's streamed meta
description for normal browser requests. It preserves region-aware pricing.
Social-crawler requests were separately verified to receive metadata in the
raw head. This is a recorded implementation tradeoff, not a missing canonical
or a failed crawler fetch; no promise about search indexing follows from it.
