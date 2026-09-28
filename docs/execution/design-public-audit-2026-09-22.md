# Public website design audit — 2026-09-22

## Implemented

The existing public website now uses the approved Warm Editorial presentation through its shared page-family styles. The homepage uses a centered, larger editorial headline and a wide paper-framed product demonstration; masthead, footer, reading pages, pricing cards, auth entry, product illustrations, comparisons, and simulator share restrained rectangular controls, lighter display typography, forest accents, and distinct paper/card surfaces.

The marketing-specific palette now aliases the application tokens. This removes the separate hardcoded near-black/teal palette so the public website follows the same light and dark design as the app. The privacy section retains a forest surface with explicit high-contrast foreground colors.

No product claims, prices, tier limits, legal text, source citations, route metadata, links, OAuth behavior, payment logic, simulator actions, disclosures, or static/dynamic rendering boundaries were changed. All implemented behavior remains the existing production implementation. This is a presentation revamp, not a replacement public-site implementation.

## Route coverage

| Route family                                                                                                               | Shared presentation changed                                                                                            | Verification                                                     |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/`                                                                                                                        | `landing/landing.css`; centered hero, wider demo stage, lighter typography, card hierarchy, forest/paper palette       | Homepage content/action contracts and animation tests pass       |
| Every `(marketing)` route                                                                                                  | `public-shell/public-shell.css`; masthead, mobile navigation, footer, focus indicators                                 | Header, navigation, mobile-menu tests pass                       |
| `/pricing`                                                                                                                 | `pricing/pricing.css`; larger display title, lighter pricing typography, differentiated plan cards and consistent CTAs | Pricing model, CTA, region, plan and waitlist-related tests pass |
| `/sign-in`                                                                                                                 | `auth-entry/auth-entry.css`; framed editorial entry, larger heading, consistent Google button                          | Auth-entry and sign-in route tests pass                          |
| `/privacy`, `/terms`, `/refunds`, `/cookies`, `/help`, `/contact`, `/security`                                             | `learn/reading.css` via LegalPageLayout; reading rhythm, title, section hierarchy, document separator                  | Legal/support content tests pass                                 |
| `/how-to`, six `/how-to/*` articles; `/answers`, five `/answers/*` articles; `/blog`, `/blog/[slug]`; `/faq`, `/changelog` | `learn/reading.css`; editorial title/body, CTA and tabular reading treatment                                           | Learn registry/content and article tests pass                    |
| `/how-it-works`, `/methodology`                                                                                            | `product-story/product-story.css`, reading template where used; display title and product diagrams                     | Product story/methodology tests pass                             |
| `/compare`, `/vs/[competitor]`, `/alternatives/[tool]`                                                                     | `comparison/comparison.css`; title hierarchy, breadcrumbs, table spacing, source-method callout                        | Comparison content/data tests pass                               |
| `/inbox-simulator`                                                                                                         | `inbox-simulator/inbox-simulator.css`; editorial opening and working panels                                            | Simulator interaction and production parity tests pass           |
| `/demo`                                                                                                                    | Existing redirect to `/inbox-simulator` preserved                                                                      | Existing route unchanged                                         |
| `/beta`                                                                                                                    | Shared tokens and public shell; existing inline layout retained                                                        | Beta page tests pass                                             |

## Evidence

- `pnpm --filter @declutrmail/web test src/features/marketing 'src/app/(marketing)'`: **40 test files, 471 tests passed**.
- `pnpm --filter @declutrmail/web typecheck`: passed.
- All eight changed CSS files formatted successfully with repository Prettier.
- Styles preserve existing responsive layouts and reduced-motion behavior. Homepage animation timing/settled reduced-motion state remain unchanged and pass their contracts.

## Browser verification gap

This agent could not inspect rendered pages: the computer-use browser inventory had no browsers, both `iab` and `chrome` tab creation returned unavailable, and native Chrome exposed only its profile picker. No profile was selected and no existing user tab was changed. Parent integration should record desktop/mobile and dark-theme screenshots for `/`, `/pricing`, `/sign-in`, `/privacy`, `/how-it-works`, `/compare`, and `/inbox-simulator` before claiming visual verification. Tests confirm content and behavior, not pixel-level layout.

## Scope limits

No deployment or real Gmail/billing mutation was performed. Shared tokens are owned by the parent integration, not this change. Public preview/modal behavior continues to use the existing shared product components; any shared changes require integrated verification.
