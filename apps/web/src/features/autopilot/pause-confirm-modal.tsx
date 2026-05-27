'use client';

import { useEffect } from 'react';
import { Button, Eyebrow, Kbd, tokens, useFocusTrap } from '@declutrmail/shared';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { presetDisplayName } from './preset-labels';

const { color, font } = tokens;

/**
 * D105 master-pause confirmation modal.
 *
 * Per D226 every Autopilot mutation must render a "what happens next"
 * preview before the mutation runs. Pause-all is non-destructive (it
 * doesn't delete or move any mail; it just stops new matches from
 * landing in the buffer) but it touches every active rule across every
 * inbox — exactly the surface D226's "preview is mandatory" rule was
 * written for. The modal enumerates the affected rules so the founder
 * sees what they're flipping before they flip it.
 *
 * Keyboard: Escape cancels; ⌘/Ctrl + Enter confirms.
 */
export function PauseConfirmModal({
  open,
  rules,
  onCancel,
  onConfirm,
  isPausing,
  pauseError,
}: {
  open: boolean;
  rules: AutopilotRuleDto[];
  onCancel: () => void;
  onConfirm: () => void;
  isPausing: boolean;
  pauseError: string | null;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm]);

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  if (!open) return null;

  // Only currently non-paused rules will flip — show the founder the
  // exact set the mutation touches, not the full rule library.
  const affected = rules.filter((r) => r.mode !== 'paused');
  const n = affected.length;
  const plural = n === 1 ? '' : 's';

  return (
    <>
      <div
        onClick={onCancel}
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
        aria-labelledby="dm-pause-title"
        aria-describedby="dm-pause-lead"
        style={{
          position: 'fixed',
          top: '14vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(500px, calc(100vw - 32px))',
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
            id="dm-pause-title"
            style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.014em', margin: '6px 0 0' }}
          >
            Pause {n} Autopilot rule{plural}
          </h2>
          <p
            id="dm-pause-lead"
            style={{ fontSize: 13, color: color.fgSoft, margin: '6px 0 0', lineHeight: 1.5 }}
          >
            Every running rule flips to <strong>paused</strong>. New mail will not generate
            suggestions or apply automated actions until you re-enable each rule. Existing pending
            suggestions stay in the buffer — you can keep dismissing them.
          </p>
        </div>

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {affected.length === 0 ? (
            <div
              style={{
                fontSize: 12.5,
                color: color.fgMuted,
                fontStyle: 'italic',
              }}
            >
              No rules are currently running. Pause-all is a no-op.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              {affected.map((r) => (
                <span
                  key={r.id}
                  style={{
                    fontFamily: font.mono,
                    fontSize: 11,
                    color: color.fgSoft,
                    background: color.paper,
                    border: `1px solid ${color.line}`,
                    borderRadius: 6,
                    padding: '3px 8px',
                  }}
                >
                  {presetDisplayName(r.presetKey, r.name)}
                </span>
              ))}
            </div>
          )}

          {pauseError != null && (
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
              {pauseError}
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
          <span style={{ fontSize: 11.5, color: color.fgMuted }}>
            Re-enable each rule from the rules list.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button tone="default" onClick={onCancel} disabled={isPausing}>
              Cancel
            </Button>
            <Button
              tone="primary"
              onClick={onConfirm}
              disabled={isPausing || affected.length === 0}
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
              {isPausing ? 'Pausing…' : 'Pause all'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
