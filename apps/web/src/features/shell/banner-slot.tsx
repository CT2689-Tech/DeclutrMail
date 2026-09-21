'use client';

import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { tokens } from '@declutrmail/shared';

const { color, font, radius, text } = tokens;

interface Measured {
  /** Banners that rendered something. */
  active: number;
  /** Index of the first of them; -1 when none. */
  first: number;
  /** Text of the active banners behind the first, in priority order. */
  behind: string;
}

/** A banner's words without its controls — "Reconnect Dismiss" is noise when read aloud. */
function spokenText(item: Element): string {
  const copy = item.cloneNode(true) as Element;
  copy.querySelectorAll('button, a, input, select, textarea').forEach((el) => el.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The single app-level banner slot. Children are the app's banners in
 * PRIORITY ORDER; each decides for itself whether it renders. Only the
 * first one that does is shown — the rest sit behind a "+N more" button
 * — so a bad day stacks one strip above the shell, not five.
 *
 * "Did it render?" is read from the DOM (an empty wrapper = inactive)
 * rather than from each banner's hooks. Every banner already owns a
 * non-trivial visibility rule (sync-error alone has five exits), and a
 * second copy of those rules here is exactly the drift CLAUDE.md §8
 * warns about. A MutationObserver keeps the count current because the
 * banners re-render on their own query state, not this component's.
 *
 * tokens.css (`.dm-banner-slot`) applies the same one-visible rule in
 * CSS, so server-rendered banners do not stack for a frame before this
 * effect has measured anything.
 *
 * A collapsed banner is `hidden`, so its own `role="alert"` never reaches
 * assistive tech. The words of every collapsed banner are therefore
 * mirrored into ONE visually-hidden polite live region. The visible
 * banner is never mirrored (its own role announces it), and the region
 * empties on "+N more" because the banners themselves are then exposed.
 */
export function BannerSlot({ children }: { children: ReactNode }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Measured>({ active: 0, first: -1, behind: '' });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const measure = () => {
      const items = Array.from(slot.children).filter((el) =>
        el.classList.contains('dm-banner-item'),
      );
      const rendered = items.map((el) => el.childNodes.length > 0);
      const first = rendered.indexOf(true);
      const next = {
        active: rendered.filter(Boolean).length,
        first,
        behind: items
          .filter((_, index) => rendered[index] && index > first)
          .map(spokenText)
          .filter((words) => words !== '')
          .join('. '),
      };
      setMeasured((prev) =>
        prev.active === next.active && prev.first === next.first && prev.behind === next.behind
          ? prev
          : next,
      );
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(slot, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const hiddenCount = measured.active - 1;
  const showAll = expanded && hiddenCount > 0;

  return (
    <div
      ref={slotRef}
      className="dm-banner-slot"
      data-expanded={showAll ? 'true' : 'false'}
      style={{ flexShrink: 0 }}
    >
      {Children.toArray(children).map((child, index) => (
        <div
          // `toArray` keys by ORIGINAL position, so a conditional banner
          // dropping out does not remount the ones after it.
          key={isValidElement(child) ? child.key : index}
          className="dm-banner-item"
          hidden={!showAll && measured.first !== -1 && index > measured.first}
        >
          {child}
        </div>
      ))}
      {/* Always mounted: a live region only announces changes made AFTER
          it exists. */}
      <div
        aria-live="polite"
        data-testid="banner-slot-live"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          margin: -1,
          padding: 0,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {showAll ? '' : measured.behind}
      </div>
      {hiddenCount > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '0 20px',
            borderBottom: `1px solid ${color.line}`,
          }}
        >
          <button
            type="button"
            // `dm-nav-row`: themed hover, and a 44px target on touch widths.
            className="dm-nav-row"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={showAll}
            style={{
              // No inline min-height — it would outrank the class's 44px.
              padding: '6px 8px',
              border: 'none',
              borderRadius: radius.sm,
              color: color.fgMuted,
              fontFamily: font.sans,
              fontSize: text.sm,
              cursor: 'pointer',
            }}
          >
            {showAll ? 'Show less' : `+${hiddenCount} more`}
          </button>
        </div>
      )}
    </div>
  );
}
