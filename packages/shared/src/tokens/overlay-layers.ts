/**
 * Fixed stacking order for chrome that can sit on the bottom of a phone.
 *
 * Open action dialogs and sheets stay above the first-visit cookie banner
 * so their footer buttons remain visible and tappable. The banner is not
 * removed while a dialog is open, so it is reachable again after close.
 * Toasts stay above both.
 */
export const OVERLAY_Z = {
  cookieBanner: 150,
  /** Scrim, or a dialog whose panel is a child of that scrim. */
  modal: 170,
  /** Sibling sheet panel, one step above its own scrim. */
  sheet: 171,
  toast: 200,
} as const;
