# Product copy and hierarchy review — 2026-10-03

Three independent reviewers checked product accuracy, copy/repetition, and visual
hierarchy. The scope was the homepage, its shared illustrations, the product guide,
methodology, permission/onboarding entry, and selected Triage and Daily Brief states.
This is a focused review, not a complete audit of every authenticated product screen.

## What users see first

Repository verified:

- Homepage **Start free** opens `/sign-in`, the permission checkpoint headed
  “Know what you are sharing before you connect.” **Continue with Google** starts OAuth.
- A new Google signup returns to `/onboarding`. The user's state determines whether
  setup shows connection recovery, scan progress, goal/starting-rule selection,
  first Triage, or protection review. Finishing or skipping normally opens `/home`.
- Returning sign-in normally opens `/home`. Incomplete onboarding is gated back to
  `/onboarding`.
- The sidebar calls the `/home` group **Overview**; the screen itself uses **Home**.
- Validated pricing intent is preserved and can open Billing instead of Home.
- A direct unauthenticated visit to `/onboarding` has a separate Promise → Connect path.

Evidence: `apps/api/src/auth/google-oauth.controller.ts` (existing-session and
callback destinations), `apps/web/src/features/marketing/auth-entry/auth-entry.tsx`,
`apps/web/src/features/marketing/landing/urls.ts`,
`apps/web/src/features/onboarding/derive-step.ts`,
`apps/web/src/features/onboarding/use-onboarding-gate.ts`,
`apps/web/src/app/onboarding/page.tsx`, `packages/shared/src/shell/sidebar.tsx`, and
`apps/web/src/features/home/home-view.tsx`.

The homepage now describes the cleanup task instead of promising a first screen.
Live Google signup and authenticated onboarding were not exercised in this pass.

## Findings addressed

| Finding                                                                                 | Change                                                                                                                                                      | Location                                                              |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| “01 / Your inbox by sender” implies a missing sequence and real user data               | Removed the visible caption row; kept one fictional-data label inside the frame and a descriptive screen-reader caption; removed unused inspector numbering | `features/marketing/landing/hero-workspace.*`                         |
| Walkthrough title sits in the border and describes an unspecified cleanup               | “Archive walkthrough” inside the card, preserving the fieldset/radio group                                                                                  | `features/marketing/landing/sender-walkthrough.*`                     |
| Section index looks like another product destination                                    | “On this page”; “Works with Gmail” distinguishes the local anchor from the product-guide route; two-column mobile links                                     | `(marketing)/page.tsx`, `landing/homepage-sections.css`               |
| “Your workspace starts with Overview” omits permission/setup and return-intent branches | Removed the entry claim from the tour                                                                                                                       | `landing/product-journey.tsx`                                         |
| “Keep the context” is vague and overlaps the actual Keep decision                       | “See the sender. Know what will change.” with concrete subjects/counts/preview copy                                                                         | `landing/product-journey.tsx`                                         |
| Tour explains two numbered workflows; caption describes the wrong demo                  | Removed the expanded workspace flow and redundant caption; preserved the interactive Archive example and Senders demo link                                  | `landing/product-journey.tsx`                                         |
| Short tour introduction is vertically centered beside a tall example                    | Top-aligned the columns                                                                                                                                     | `landing/homepage-sections.css`                                       |
| Companion prose repeats the sender/preview/result flow                                  | Kept the Gmail relationship diagram and account boundary; one “Read the product guide” link                                                                 | `landing/sections.tsx`                                                |
| Feature footnote repeats the plan names in every card                                   | Removed the footnote; retained plan labels and pricing comparison                                                                                           | `landing/sections.tsx`                                                |
| “Right-hand inspector” only describes desktop                                           | Used device-neutral sender-details wording                                                                                                                  | `landing/sender-walkthrough.tsx`, `(marketing)/how-it-works/page.tsx` |
| “Only the email shown” implies every affected message is displayed                      | Described current mail matching the approved scope; the real modal shows counts and up to five sampled subjects                                             | Product guide, methodology, shared automation diagram                 |
| Activity allegedly updates only after completion                                        | Described running actions and confirmed outcomes                                                                                                            | Product guide and methodology                                         |
| Every enabled Autopilot preset allegedly acts automatically                             | Distinguished review-only presets from Act now / Watch first choices                                                                                        | `product-story/diagrams.tsx`                                          |
| Follow-ups allegedly covers only replies and establishes a definite pending response    | Used sent conversations that may need follow-up; illustration says “Conversations to revisit”                                                               | Homepage tools and product guide                                      |
| Onboarding says Unsubscribe always shows mail moving                                    | Distinguished mail-moving previews from request confirmation and the irreversible sent-request boundary                                                     | `features/onboarding/step-connect.tsx`                                |
| Plus users see “See Pro automation” despite already having Autopilot                    | “Compare Pro features”                                                                                                                                      | `features/triage/empty-state.tsx`                                     |
| Historical empty Briefs say “yesterday” and “back tomorrow”                             | Edition-neutral empty-state copy                                                                                                                            | `features/brief/brief-screen.tsx`                                     |

Paths in the table are under `apps/web/src/` unless otherwise stated.

Browser verification also caught a skipped heading level in the shared walkthrough
when it appears directly after a guide's H1. Guide pages now use H2 panel headings;
the homepage retains H3 headings beneath its tour H2. Fieldset semantics and visual
styling remain consistent across both contexts.

## Repetition retained deliberately

- Start free remains in the header, hero, and final invitation.
- Permission disclosures remain beside conversion actions.
- Header/footer product-guide links provide site navigation. The single homepage
  guide link answers the Gmail-companion question; feature links open relevant
  guide anchors. The previous exact “See how the whole product works” label
  occurred once, not at every link.
- Action limits remain within the walkthrough. Pricing repeats plan entitlements
  to support comparison.
- The page index remains compact; the content sections carry the large visuals.

## Checks to repeat when product behavior changes

Review each claim against current routes/components, rather than relying on old
design-plan wording. Check new versus returning users, mobile versus desktop,
pending versus completed actions, sampled versus full data, and every pricing tier.
Read visible captions and empty states as well as body copy. Treat illustration
disclosures and scoped recovery limits as part of the user-facing promise.

## Verification

- 117 tests passed across the homepage, product guide, public journeys, CTA tracking,
  onboarding consent, Triage, and Daily Brief suites.
- Web type checking and linting passed; formatting and Git whitespace checks passed.
- Local browser checks covered 320px and 390px mobile, 1440px desktop, light/dark
  themes, the Archive preview control, and the shared walkthrough on
  `/how-to/clean-gmail-by-sender`. No horizontal overflow was found.
- Automated accessibility checks reported no violations in the homepage body
  sections or the shared guide walkthrough. The decorative hero was excluded from
  this scoped accessibility claim.
- Entry and authenticated empty-state behavior were checked against repository
  code and tests, not a live Google account.
