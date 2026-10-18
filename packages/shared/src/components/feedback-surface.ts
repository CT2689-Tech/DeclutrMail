import type { CSSProperties } from 'react';
import { color, font, radius, shadow, text } from '../tokens/tokens';

/** Shared visual treatment for transient feedback and persistent action progress/Undo. */
export const FEEDBACK_SURFACE: CSSProperties = {
  background: color.card,
  color: color.fg,
  border: 'none',
  borderRadius: radius.pill,
  boxShadow: shadow.pop,
  fontFamily: font.sans,
  fontSize: text.base,
};
