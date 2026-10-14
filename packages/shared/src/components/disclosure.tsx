'use client';

// Promoted per D199: existing disclosures share the native Details treatment.
// Consumers: PreviewSheet, TechnicalDetails, Mailbox data inventories,
// Triage InlinePreview and Screener DecidePreview. Stories follow D210.

import { useState, type CSSProperties, type DetailsHTMLAttributes, type ReactNode } from 'react';

import { color, font, motion, radius, space, text } from '../tokens/tokens';

/** The native Details grammar shared by previews, inventories and diagnostics. */
export function Disclosure({
  summary = 'Details',
  children,
  defaultOpen = false,
  className,
  style,
  onToggle,
  ...detailsProps
}: Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'open'> & {
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  style?: CSSProperties | undefined;
}) {
  // `open={true}` is controlled. A constant true pins the disclosure open,
  // so the initial value has to follow later toggles.
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      {...detailsProps}
      className={['dm-sheet-details', className].filter(Boolean).join(' ')}
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        onToggle?.(event);
      }}
      style={{ width: '100%', minWidth: 0, borderRadius: radius.lg, textAlign: 'left', ...style }}
    >
      <summary
        style={{
          cursor: 'pointer',
          listStyle: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxSizing: 'border-box',
          width: '100%',
          gap: space[3],
          minHeight: 44,
          padding: `${space[2]}px ${space[4]}px`,
          borderRadius: radius.lg,
          fontFamily: font.sans,
          fontSize: text.sm,
          fontWeight: 500,
          lineHeight: 1.5,
          color: color.fgSoft,
          overflowWrap: 'anywhere',
        }}
      >
        <span style={{ minWidth: 0 }}>{summary}</span>
        <svg
          className="dm-sheet-details-chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0, transition: `transform ${motion.fast} ${motion.ease}` }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div
        className="dm-sheet-details-content"
        style={{
          padding: `0 ${space[4]}px ${space[4]}px`,
          textAlign: 'left',
          fontFamily: font.sans,
          fontSize: text.sm,
          lineHeight: 1.5,
          color: color.fg,
          overflowWrap: 'anywhere',
          display: 'flex',
          flexDirection: 'column',
          gap: space[3],
        }}
      >
        {children}
      </div>
    </details>
  );
}
