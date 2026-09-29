import { tokens } from '@declutrmail/shared';

const { color, motion, radius } = tokens;

/**
 * The long-list row grammar (Brief, Follow-ups, Later, Screener, Protected
 * senders): rows stay flat on the page, divided by hairlines inset past the
 * leading column, and a hovered row takes the neutral fill with rounded
 * corners. The row is pulled 12px into the gutter on both sides so its fill
 * has room without moving the content off the page's one left edge.
 *
 * `hairlineLeft` is where the divider starts, measured from the row's own
 * left edge (12px padding + the leading avatar/logo + its gap), so the line
 * sits under the text, not under the logo.
 */
export function flatRowCss(className: string, hairlineLeft = 12): string {
  return `.${className} { position: relative; margin: 0 -12px; padding-left: 12px; padding-right: 12px; border-radius: ${radius.lg}; transition: background ${motion.fast} ${motion.ease}; }
.${className} + .${className}::before { content: ''; position: absolute; top: 0; left: ${hairlineLeft}px; right: 12px; height: 1px; background: ${color.lineSoft}; }
.${className}:hover { background: ${color.fill}; }
.${className}:hover::before, .${className}:hover + .${className}::before { opacity: 0; }`;
}
