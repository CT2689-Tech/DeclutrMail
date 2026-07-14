'use client';

import { useEffect, type ReactNode } from 'react';
import { Button, Eyebrow, Kbd, tokens, useFocusTrap } from '@declutrmail/shared';
import { MailboxActionContext } from '@/features/auth/mailbox-action-context';

const { color, font } = tokens;

/**
 * Shared chrome for the Autopilot D226 preview modals (approve +
 * activate). Mirrors `PauseConfirmModal`'s dialog shell: overlay,
 * focus trap, Escape-to-cancel, ⌘/Ctrl+Enter-to-confirm, and the
 * "Preview · before anything changes" eyebrow that marks the mandatory
 * preview step of the action lifecycle (sheet → preview → mutation →
 * undo).
 *
 * The frame owns ONLY chrome + keyboard wiring; what the mutation will
 * do (verb copy, affected senders, counts) is the caller's `children`.
 */
export function ConfirmModalFrame({
  open,
  titleId,
  title,
  lead,
  children,
  footnote,
  confirmLabel,
  confirmBusyLabel,
  canConfirm,
  isBusy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** Unique DOM id for the dialog's labelled-by heading. */
  titleId: string;
  title: ReactNode;
  lead: ReactNode;
  children?: ReactNode;
  /** Small print next to the action row (e.g. undo posture). */
  footnote: ReactNode;
  confirmLabel: string;
  confirmBusyLabel: string;
  /** Mirrors the visible confirm button's enablement on the keyboard path. */
  canConfirm: boolean;
  isBusy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Keyboard path mirrors the visible buttons' guard rails (same
  // contract as PauseConfirmModal): no confirm while busy or invalid.
  const confirmEnabled = canConfirm && !isBusy;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) onCancel();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && confirmEnabled) onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isBusy, onCancel, onConfirm, confirmEnabled]);

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  if (!open) return null;

  return (
    <>
      <div
        onClick={() => {
          if (!isBusy) onCancel();
        }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 150,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          position: 'fixed',
          top: '14vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(520px, calc(100vw - 32px))',
          maxHeight: '76vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: 14,
          border: `1px solid ${color.border}`,
          boxShadow: '0 24px 60px rgba(14,20,19,0.30)',
          zIndex: 151,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${color.line}` }}>
          <Eyebrow>Preview · before anything changes</Eyebrow>
          <h2
            id={titleId}
            style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.014em', margin: '6px 0 0' }}
          >
            {title}
          </h2>
          <p style={{ fontSize: 13, color: color.fgSoft, margin: '6px 0 0', lineHeight: 1.5 }}>
            {lead}
          </p>
        </div>

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <MailboxActionContext />
          {children}
          {error != null && (
            <div
              role="alert"
              style={{
                fontSize: 12,
                color: color.red,
                background: 'rgba(239,68,68,0.08)',
                border: `1px solid ${color.red}`,
                borderRadius: 8,
                padding: '8px 10px',
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 24px 18px',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <span style={{ fontSize: 11.5, color: color.fgMuted }}>{footnote}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button tone="default" onClick={onCancel} disabled={isBusy}>
              Cancel
            </Button>
            <Button
              tone="primary"
              onClick={onConfirm}
              disabled={!confirmEnabled}
              iconRight={
                <Kbd
                  style={{
                    background: 'rgba(255,255,255,0.16)',
                    border: 'none',
                    color: '#FFFFFF',
                  }}
                >
                  ⌘⏎
                </Kbd>
              }
            >
              {isBusy ? confirmBusyLabel : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
