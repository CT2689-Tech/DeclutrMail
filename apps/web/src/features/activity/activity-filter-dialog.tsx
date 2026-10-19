'use client';

import type { CSSProperties, RefObject } from 'react';
import { Button, DialogFrame, OVERLAY_Z, tokens } from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';
import { FilterFields, type FilterFieldsProps } from './activity-filter-fields';

const { color, motion, radius, shadow } = tokens;

/** Loaded only when Filter opens; the normal Activity view needs neither dialog. */
export function ActivityFilterDialog({
  isMobile,
  onClose,
  returnFocusRef,
  ...fields
}: FilterFieldsProps & {
  isMobile: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
}) {
  if (isMobile) return <FilterSheet onClose={onClose} {...fields} />;
  return <FilterPopover onClose={onClose} returnFocusRef={returnFocusRef} {...fields} />;
}

/** Desktop popover. A real modal so Tab cannot leave it for the page behind. */
function FilterPopover({
  onClose,
  returnFocusRef,
  ...fields
}: FilterFieldsProps & {
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(
    true,
    returnFocusRef ? { returnFocusRef } : undefined,
  );
  return (
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-label="Activity filters"
      tabIndex={-1}
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        zIndex: OVERLAY_Z.modal,
        width: 380,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100dvh - 112px)',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        boxSizing: 'border-box',
        padding: 20,
        background: color.card,
        borderRadius: radius.xl,
        boxShadow: shadow.pop,
        transformOrigin: 'top right',
        animation: `dm-activity-pop-in ${motion.fast} ${motion.ease} both`,
      }}
    >
      <style>{`@keyframes dm-activity-pop-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: none; } }`}</style>
      <FilterFields {...fields} showVerbs={false} />
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button tone="primary" size="lg" onClick={onClose}>
          View results
        </Button>
      </div>
    </div>
  );
}

/**
 * D60 bottom-sheet filters (mobile only). Slides up from the bottom edge
 * and dismisses on backdrop tap, Escape, or the button. Focus is trapped
 * while open — mirrors the triage action-sheet modal contract.
 */
function FilterSheet({ onClose, ...fields }: FilterFieldsProps & { onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  return (
    <DialogFrame
      panelRef={trapRef}
      label="Activity filters"
      onDismiss={onClose}
      footer={
        <Button tone="primary" size="lg" onClick={onClose}>
          View results
        </Button>
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <h2
          style={{
            margin: 0,
            ...tokens.typography.dialogTitle,
            letterSpacing: '-0.02em',
            color: color.fg,
          }}
        >
          Filter
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          style={{ ...iconButtonStyle, width: 44, height: 44 }}
        >
          <CloseGlyph />
        </button>
      </div>
      <FilterFields {...fields} touch showVerbs={false} />
    </DialogFrame>
  );
}

const iconButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  padding: 0,
  border: 'none',
  borderRadius: radius.pill,
  background: 'transparent',
  color: color.fgMuted,
  cursor: 'pointer',
  transition: `background ${motion.fast} ${motion.ease}`,
};

function CloseGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
