'use client';

import { useEffect } from 'react';
import { tokens } from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';
import { useMarkVerbTourSeen, useVerbTourState } from './use-verb-tour';
import { VerbTourPanel } from './verb-tour-panel';

const { color, shadow } = tokens;

/**
 * The onboarding host for the D38 tour (step 5).
 *
 * Renders nothing once the flag is set — that is the whole of "Day 2+:
 * no re-education". Finishing and skipping write the same flag, so a
 * user who skips is not asked again either.
 */
export function OnboardingVerbTour() {
  const tour = useVerbTourState();
  const markSeen = useMarkVerbTourSeen();

  if (tour.completed) return null;

  return (
    <div style={{ margin: '0 0 16px' }}>
      <VerbTourPanel
        onDone={() => markSeen.mutate()}
        onDismiss={() => markSeen.mutate()}
        saving={markSeen.isPending}
        saveFailed={markSeen.isError}
      />
    </div>
  );
}

/**
 * The Settings replay host — the same panel in a modal, because a user
 * who has finished onboarding has no step 5 to send them back to.
 *
 * Escape closes, focus is trapped while open and restored on close
 * (`useFocusTrap`), matching the triage shortcut overlay's behaviour.
 */
export function VerbTourDialog({ onClose }: { onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const markSeen = useMarkVerbTourSeen();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Re-stamps the flag on the way out so a replay that follows a failed
  // first write still leaves the tour marked seen. Closing waits for
  // success: a failed write keeps the panel open with its error line
  // rather than silently dropping the user's "Got it".
  const finish = () => {
    markSeen.mutate(undefined, { onSuccess: () => onClose() });
  };

  return (
    // The shared sheet shell: a centred dialog on desktop, a bottom sheet
    // on phones — pure CSS (tokens.css), so no post-hydration jump.
    <div
      className="dm-scrim dm-sheet-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        justifyContent: 'center',
        padding: 16,
        overflowY: 'auto',
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-verb-tour-replay-title"
        className="dm-sheet dm-sheet-panel"
        style={{
          width: '100%',
          maxWidth: 620,
          maxHeight: '88vh',
          overflow: 'auto',
          background: color.card,
          boxShadow: shadow.modal,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <VerbTourPanel
          headingId="dm-verb-tour-replay-title"
          onDone={finish}
          onDismiss={onClose}
          saving={markSeen.isPending}
          saveFailed={markSeen.isError}
        />
      </div>
    </div>
  );
}
