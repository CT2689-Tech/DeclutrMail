# Sender logo clarity and fallbacks

Relates to D254, D210, ADR-0024 and ADR-0034.

## Scope and ownership

This chat owns the shared Avatar component, its stories/tests, website artwork
selection/normalization and its tests, the existing avatar paint spec and these
notes. No PR dependency. Integration owner: this Codex chat. Existing copy,
mobile, worker-pool and dependency PRs remain separate.

## Design

Keep the current rounded square, Geist initial and neutral surface. Light tiles
use the existing 98%/93%/88% highlight/base/shadow tokens and a 30% foreground;
dark tiles use 30%/25%/20% and an 88% foreground. Logos retain their own color.
The name stays adjacent, left aligned, and supplies the accessible identity.
The avatar remains decorative, fixed in size and free of client state.

The refinement addresses concrete gaps rather than changing the visual system:

- Within an artwork tier, scalable `sizes="any"` candidates precede small
  bitmaps. Existing touch-icon/manifest/standard-icon tier order remains.
- Normalization rejects blank, transparent and near-solid artwork after white
  flattening and before padding. Discovery then tries the next candidate.
- Fallbacks skip leading emoji/punctuation and retain Unicode letters. An
  email-only business sender uses the domain initial (`noreply@etherscan.io`
  becomes E). A missing name can still use its domain.
- Personal mail-provider domains use the person's initial instead of displaying
  the provider's logo. This uses the existing shared free-mail domain list.
- Corrupt, missing and unreachable images retain the monogram beneath the CSS
  image layer. No new browser requests to logo providers.

## Verification

- Shared package: full suite passed; targeted avatar coverage includes decorated
  names, composed accents, Indic graphemes and letters outside the BMP.
- Website, Brandfetch and domain-icon worker suites: 71 tests passed, including
  rejection of a solid rectangular image.
- Shared and worker typechecks, scoped ESLint and formatting passed.
- Built-in browser: real SSR Avatar, synthetic senders, 24/28/44/72px in both
  themes. Confirmed cached logo, 204, corrupt image, email-only address, personal
  sender, decorated Unicode name, missing name and unknown identity.
- The existing CI paint spec now covers an HTTP 200 with corrupt image bytes.

Review screenshot is outside the repository under the chat's visualization
outputs. It contains synthetic identities only.

## Limits

This change adds no provider, paid plan, migration or cache backfill. Artwork
selection/quality changes apply on the next normal resolution or refresh;
already cached artwork is not proactively replaced. Logos are recognition aids,
not proof that a sender is authentic. This local evidence does not establish
deployment or production verification.
