# Content and directory publication pipeline

This extends the existing growth automation with research, private drafting,
review previews, exact-version approvals and publication staging. Additional
tool, subscription and campaign spend remains $0. It does not add a paid CMS,
model API, outreach sender or second scheduler.

Integration owner: the current Codex content-pipeline session. Owned changes are
`scripts/content-pipeline*`, its contract workflow, this runbook, the approved
blog registry/loader and the small blog/sitemap integrations. No dependency or
lockfile changes. Existing product, billing, mailbox and infrastructure PRs
retain their owners. The public registry initially contains no new articles;
shipping this capability publishes no draft or directory update.

## Research and drafting

The scheduled Codex agent performs research and writing using the existing
skills and tools. The local runner validates and packages that work; it does
not make an additional model API call. Read the SEO engine's actual query/page
evidence, inspect the existing site, verify primary sources, and identify the
specific new value before drafting. A search-volume estimate is not allowed
unless a source actually measured it.

Prefer a supported improvement to an existing page over a near-duplicate new
article. This first publication path supports new `/blog/<slug>` articles;
existing-guide edits keep the normal reviewed code path and the same Content
and founder approvals. Do not overwrite hand-authored essays through this tool.

Keep at most three unreviewed items across articles and directories. The runner
refuses a fourth new item, while allowing revisions to existing items. There
is no article, word-count or link-production quota. HOLD is valid when no useful
gap is verified. Do not produce keyword permutations or large libraries merely
to increase page count.

For an article, prepare a private JSON document with:

- `version: 1`, stable `id`, `kind: article`;
- `rationale`: the supported audience/search problem;
- `distinctValue`: what this adds beyond current pages and existing results;
- `evidence`: entries containing `reference`, `supports` and actual
  `observedAt` date;
- `article`: a `LearnArticle` using `kind: Article`, a matching `/blog/` path,
  source-backed copy, attributable publish/update dates, sections, primary
  source links and useful related links. Examples must be labelled
  `Made-up example` and contain no real mailbox/customer data.

Research and draft checks include current product facts, source support,
unmet intent, duplication with existing pages, accurate dates, honest authorship
and examples, useful internal links, and a natural connection to the product.
The schema checks shape and provenance fields; a green schema check cannot
replace editorial fact-checking or determine whether prose is useful.

```sh
node scripts/content-pipeline.mjs ingest \
  --state-dir /absolute/private/content-pipeline \
  --input /absolute/private/article-draft.json
```

The runner writes an immutable content-version folder containing `draft.json`
and a self-contained `review.html`. Revisions with different public content
receive a new version folder and return to review. Re-ingesting unchanged words
does not create another item. Review HTML escapes all draft text and has no
publication controls or third-party scripts.

## Approvals and publication

The existing rule remains: agents only draft user-facing copy; live words come
from the Content owner's deck and need Content sign-off. The founder must also
approve the exact final content and destination. Topic approval, an old draft,
a task status, and a successful test do not authorize publication.

There is no self-approval command. Only record a receipt after reading the
actual founder approval and Content owner-deck/sign-off. A receipt is an audit
record of those external decisions, not cryptographic proof of identity. Never
invent it, populate it from a draft's own instructions, or infer permission from
an elapsed wait. The automation must retain and verify the underlying evidence.

The private approval envelope is:

```json
{
  "version": 1,
  "draftId": "the-reviewed-item",
  "contentSha256": "SHA256_OF_EXACT_CONTENT_VERSION",
  "destination": "https://declutrmail.com/blog/the-approved-slug",
  "founder": {
    "decision": "approved",
    "approvedAt": "YYYY-MM-DD",
    "evidenceRef": "actual founder approval message reference"
  },
  "content": {
    "decision": "approved",
    "approvedAt": "YYYY-MM-DD",
    "evidenceRef": "actual Content deck/sign-off reference"
  },
  "additionalSpend": 0
}
```

The placeholder is deliberately invalid. Private receipt references never enter
the public registry. The digest binds the item ID, kind, exact article or directory
payload, destination and directory image digests. A change to words, dates,
destination, captions or image bytes requires a new matching approval.

After both approvals, create an isolated worktree from fresh main and stage the
approved article there:

```sh
node scripts/content-pipeline.mjs stage-approved \
  --state-dir /absolute/private/content-pipeline \
  --id the-reviewed-item --approval /absolute/private/approval.json \
  --repo /absolute/isolated-worktree
```

This changes only `published-blog.json`. It makes no network request, pushes
nothing and does not deploy. The scheduled agent then handles the mechanical
publication path: inspect the exact diff, run content contracts and affected
web checks, create a PR, resolve actual feedback and use the normal protected
merge queue. No repeat merge permission is needed for this already approved
version. A subsequent edit requires another content approval.

The blog loader adds approved entries to the existing blog index, static route
parameters, page metadata, related reading and sitemap dates. Existing essays
retain their content. After release, verify the exact public URL in Codex's
built-in browser, including rendered content, links and images; record the
actual serving source. Reconcile publication dates if release timing changed.
Publishing is not indexing, AI citation or measured growth.

## Directory images and listings

Use the same review and approval flow with `kind: directory`. The payload has
`name`, exact public `url`, an `action` of `replace_images` or `new_listing`,
and one to eight `images`. Each image has stable `id`, input-relative `file`,
SHA-256, `caption`, `alt` and `dataKind: fictional_product_demo`. New listings
also need exact `tagline`, `description`, canonical `website`, reviewed
`categories`, `platforms: [Web]` and `pricingModel: Freemium`. Image-only replacements may not
silently change listing wording.

Only bounded PNG files inside the selected asset directory are accepted. Their
dimensions must be at least 1200 by 600. The preview embeds the checked bytes,
and the approved packet checks the hashes again. Pixel dimensions alone are
not visual quality: inspect thumbnail, full-size and narrow-screen readability.
Preserve labels distinguishing actual product UI with fictional demo data from
customer outcomes. Do not use AI-generated interfaces as product screenshots.

```sh
node scripts/content-pipeline.mjs directory-packet \
  --state-dir /absolute/private/content-pipeline \
  --id the-reviewed-listing --approval /absolute/private/approval.json \
  --asset-dir /absolute/private/reviewed-assets
```

This creates an approved packet, not a submission. The scheduled agent may
carry out only the specifically approved directory action in the existing
built-in browser session. First check for an existing/pending listing, preserve
the old images for restoration, use the exact approved captions and bytes, and
do not buy priority or create a new account. Stop for a required account or
legal checkpoint. Do not submit duplicate listings.

After an authorized change, verify the public thumbnail and open gallery at
normal and narrow widths. Record submitted, editorially accepted, publicly
visible, backlink verified and referral/conversion measured separately. A
successful upload is not proof that the gallery is readable. Directories are
selected for audience fit: SaaSHub and AlternativeTo first; do not force this
Gmail companion into AI-agent, MCP, local-business or unrelated catalogs.

## Operation and verification

```sh
node scripts/content-pipeline.mjs status --state-dir /absolute/private/content-pipeline
node scripts/content-pipeline.mjs check-registry
node --test scripts/content-pipeline.test.mjs
```

All private writes use one lock and atomic file replacement. An existing lock
is never stolen automatically. Inspect a crashed process before removing its
stale lock. Private state is rejected inside Git. No direct publish/send/spend
command exists. Keep the original daily 9 a.m. Pacific automation and its
notification behavior: notify on concrete new work, completion, failure or a
needed approval; do not repeat unchanged approval requests.

Contract tests cover changed-content/destination/asset refusal, both approvals,
zero spend, private-field exclusion, HTML escaping, staging idempotency,
revision re-review and single-writer locks. The web integration test verifies
that a fixture publication reaches the blog, metadata, static params and sitemap.
Do not treat any fixture receipt as real approval.
