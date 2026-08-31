'use client';

import { useEffect, type ReactNode } from 'react';
import { Button, Eyebrow, Kbd, tokens, useFocusTrap, useIsAtMost } from '@declutrmail/shared';
import { MailboxActionContextView } from '@/features/auth/mailbox-action-context-view';

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
  secondaryAction,
  pendingAction,
  mailboxEmail,
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
  /**
   * Optional second commit path, shown left of the primary button.
   *
   * Gated by the same `canConfirm` — both buttons commit, so both wait
   * for the preview (D226: never act before the preview resolves).
   */
  secondaryAction?: { label: string; busyLabel: string; onClick: () => void } | undefined;
  /**
   * WHICH commit is in flight, when one is.
   *
   * `isBusy` alone drove both labels, so clicking the secondary made the
   * PRIMARY button relabel to its own busy text — a user who chose
   * "Watch first" watched "Turning on…" appear on the button that makes
   * the rule act. Two adjacent buttons, identical text, and the wrong
   * one claiming to run.
   */
  pendingAction?: 'primary' | 'secondary' | undefined;
  /** The active mailbox to show in the note; omitted renders nothing. */
  mailboxEmail?: string | undefined;
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
      // Commits the PRIMARY action — but not while focus sits on a
      // different commit button. Without the focus check a user who had
      // tabbed to "Watch first" and pressed the chord fired
      // `mode='active'` instead: the shortcut ran a mutation the user
      // was not looking at.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && confirmEnabled) {
        const focused = document.activeElement;
        // `closest`, not `dataset` on the button itself: the shared
        // `Button` takes an explicit prop allowlist and forwards no
        // arbitrary attributes, so a `data-` prop passed to it is
        // silently dropped. The marker lives on a wrapper span.
        const marked = focused instanceof HTMLElement ? focused.closest('[data-dm-commit]') : null;
        const onAnotherCommit =
          marked != null && marked.getAttribute('data-dm-commit') !== 'primary';
        if (!onAnotherCommit) onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isBusy, onCancel, onConfirm, confirmEnabled]);

  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const isPhone = useIsAtMost('xs');

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
        style={
          isPhone
            ? {
                position: 'fixed',
                left: 0,
                right: 0,
                bottom: 0,
                width: '100%',
                maxHeight: '88vh',
                overflow: 'auto',
                background: color.card,
                borderRadius: '16px 16px 0 0',
                border: `1px solid ${color.border}`,
                borderBottom: 'none',
                boxShadow: '0 -12px 40px rgba(14,20,19,0.30)',
                zIndex: 151,
                fontFamily: font.sans,
                paddingBottom: 'env(safe-area-inset-bottom)',
              }
            : {
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
              }
        }
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
          <MailboxActionContextView mailboxEmail={mailboxEmail} />
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
            flexDirection: isPhone ? 'column' : 'row',
            alignItems: isPhone ? 'stretch' : 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 24px 18px',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <span style={{ fontSize: 11.5, color: color.fgMuted }}>{footnote}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Button tone="default" onClick={onCancel} disabled={isBusy}>
              Cancel
            </Button>
            {secondaryAction != null && (
              <span data-dm-commit="secondary" style={{ display: 'contents' }}>
                <Button tone="default" onClick={secondaryAction.onClick} disabled={!confirmEnabled}>
                  {isBusy && pendingAction === 'secondary'
                    ? secondaryAction.busyLabel
                    : secondaryAction.label}
                </Button>
              </span>
            )}
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
              {isBusy && pendingAction !== 'secondary' ? confirmBusyLabel : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
