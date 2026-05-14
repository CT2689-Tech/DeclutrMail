/**
 * Brand atom barrel.
 *
 * Editorial typography + brand vocabulary used by marketing surfaces (Landing,
 * Pricing, Compare, FAQ, Legal, Contact, Blog, Guides). Per CLAUDE.md design
 * gotcha "Editorial typography is marketing-only" — these MUST NOT be used
 * on product surfaces (Dashboard, Settings, Review, Auto-Clean, etc.).
 *
 * Components ship as part of PR #2 of the v2 design system plan, consumed
 * by PR #4-5 (marketing brand refresh).
 */
export { BrandAtom } from "./BrandAtom";
export type { BrandAtomProps } from "./BrandAtom";

export { Display } from "./Display";
export type { DisplayProps } from "./Display";

export { Eyebrow } from "./Eyebrow";
export type { EyebrowProps } from "./Eyebrow";

export { PageMast } from "./PageMast";
export type { PageMastProps, PageMastNavLink } from "./PageMast";

export { Decision } from "./Decision";
export type { DecisionProps } from "./Decision";

export { Pill } from "./Pill";
export type { PillProps, PillTone, PillVariant } from "./Pill";
