/**
 * Brand atom barrel.
 *
 * Editorial typography + brand vocabulary used by marketing surfaces (Landing,
 * Pricing, Compare, FAQ, Legal, Contact, Blog, Guides). Per CLAUDE.md design
 * gotcha "Editorial typography is marketing-only" — these MUST NOT be used
 * on product surfaces (Dashboard, Settings, Review, Auto-Clean, etc.).
 *
 * Each component cites its provenance in the canonical design bundle at
 * `/tmp/declutr-design-bd3l/declutrmail-design-system/project/`.
 */
export { BrandAtom } from "./BrandAtom";
export type { BrandAtomProps } from "./BrandAtom";

export { Display } from "./Display";
export type { DisplayProps } from "./Display";

export { Eyebrow } from "./Eyebrow";
export type { EyebrowProps, EyebrowTone } from "./Eyebrow";

export { PageMast } from "./PageMast";
export type { PageMastProps, PageMastNavLink } from "./PageMast";

export { Pill } from "./Pill";
export type { PillProps, PillTone } from "./Pill";
