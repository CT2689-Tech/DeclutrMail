/**
 * Fixed stacking order for chrome that can sit on the bottom of a phone.
 *
 * Open action dialogs and sheets stay above the first-visit cookie banner
 * so their footer buttons remain visible and tappable. The banner is not
 * removed while a dialog is open, so it is reachable again after close.
 * Toasts stay above both.
 *
 * The undo tray stays below the Senders selection bar, so it cannot also
 * paint over the banner. While the banner is mounted it publishes
 * `--dm-cookie-banner-lift` (its height plus a gap). The tray adds that
 * lift. A toast uses the tray inset when that sits higher, and the same
 * lift otherwise, so Undo stays clear and the banner stays tappable.
 */
export const OVERLAY_Z = {
  cookieBanner: 150,
  /** Scrim, or a dialog whose panel is a child of that scrim. */
  modal: 170,
  /** Sibling sheet panel, one step above its own scrim. */
  sheet: 171,
  toast: 200,
} as const;

/**
 * Extra `bottom` offset while the cookie banner is showing: the banner's
 * height plus a gap. `0px` when it is absent. Added to anchors that already
 * sit at least as high as the banner's own bottom (16px + the tab bar).
 */
export const COOKIE_BANNER_LIFT_VAR = '--dm-cookie-banner-lift';

/** Fired after the banner publishes or clears `COOKIE_BANNER_LIFT_VAR`. */
export const COOKIE_BANNER_INSET_EVENT = 'dm-cookie-banner-inset';

/** Breathing room between the banner's top edge and the next floating surface. */
export const COOKIE_BANNER_CLEARANCE_PX = 12;

/** Extra pixels a bottom-anchored surface must add to clear the banner. */
export function cookieBannerLiftPx(bannerHeight: number): number {
  return Math.ceil(bannerHeight) + COOKIE_BANNER_CLEARANCE_PX;
}

/**
 * `bottom` for a surface whose anchor is `base` (a length, not a calc()).
 * An absent banner adds nothing.
 */
export function bottomClearOfCookieBanner(base: string): string {
  return `calc(${base} + var(${COOKIE_BANNER_LIFT_VAR}, 0px))`;
}
