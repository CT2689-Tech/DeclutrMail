/**
 * Brand atom barrel.
 *
 * Two React components that wrap canonical CSS patterns where the React
 * shape adds genuine value:
 *
 *   <BrandAtom/> — the logo with sized variants and `role="img"` a11y.
 *   <PageMast/>  — wires React Router <Link> into the .masthead pattern.
 *
 * Other editorial atoms (eyebrow, display heading, pill) are written
 * directly as `className=""` in the marketing page JSX, matching the
 * canonical design source 1:1. Use:
 *
 *   <div className="eyebrow primary">Pricing</div>
 *   <h1 className="display"><em>Calm</em> pricing.</h1>
 *   <span className="pill emerald">Free</span>
 *
 * The CSS patterns live in src/index.css (ported from the canonical
 * v2-marketing.css). Hover IntelliSense over the class for the rule.
 *
 * Per CLAUDE.md design gotcha "Editorial typography is marketing-only" —
 * these MUST NOT be used on product surfaces (Dashboard, Settings, etc.).
 */
export { BrandAtom } from "./BrandAtom";
export type { BrandAtomProps } from "./BrandAtom";

export { PageMast } from "./PageMast";
export type { PageMastProps, PageMastNavLink } from "./PageMast";
