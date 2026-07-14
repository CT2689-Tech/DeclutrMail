/**
 * Bottom-of-viewport surface contract shared by the global undo tray and
 * the Senders bulk SelectionBar. The tray is always lifted above the
 * selection bar's fixed footprint, so both recovery and bulk-action
 * controls remain visible when they coexist.
 */
export const floatingSurfaceLayout = {
  selectionBarBottom: 14,
  selectionBarHeight: 52,
  gap: 12,
  undoTrayBottom: 14 + 52 + 12,
  undoTrayZIndex: 50,
  selectionBarZIndex: 60,
} as const;
