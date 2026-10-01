'use client';

import type { CSSProperties } from 'react';
import { Button, tokens } from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';
import { FilterFields, type FilterFieldsProps } from './activity-filter-fields';

const { color, font, motion, radius, shadow, text } = tokens;

/** Loaded only when Filter opens; the normal Activity view needs neither dialog. */
export function ActivityFilterDialog({
  isMobile,
  onClose,
  ...fields
}: FilterFieldsProps & { isMobile: boolean; onClose: () => void }) {
  if (isMobile) return <FilterSheet onClose={onClose} {...fields} />;
  return (
    <div
      role="dialog"
      aria-label="Activity filters"
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        zIndex: 20,
        width: 380,
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
    <>
      <div
        className="dm-scrim"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 150 }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Activity filters"
        className="dm-sheet"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: '82vh',
          overflow: 'auto',
          background: color.card,
          borderTopLeftRadius: radius['2xl'],
          borderTopRightRadius: radius['2xl'],
          boxShadow: shadow.modal,
          zIndex: 151,
          fontFamily: font.sans,
          padding: '10px 20px calc(20px + env(safe-area-inset-bottom))',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* Grab handle */}
        <div
          aria-hidden="true"
          style={{
            width: 36,
            height: 4,
            borderRadius: radius.pill,
            background: color.fillHover,
            margin: '2px auto 4px',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: text.xl,
              fontWeight: 650,
              letterSpacing: '-0.02em',
              color: color.fg,
            }}
          >
            Filter
          </span>
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
        <Button tone="primary" size="lg" onClick={onClose}>
          View results
        </Button>
      </div>
    </>
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
