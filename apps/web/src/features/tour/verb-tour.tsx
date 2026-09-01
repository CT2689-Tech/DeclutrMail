'use client';

import { useEffect } from 'react';
import { tokens, useIsAtMost } from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';
import { useMarkVerbTourSeen, useVerbTourState } from './use-verb-tour';
import { VerbTourPanel } from './verb-tour-panel';

const { color } = tokens;

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
  const isPhone = useIsAtMost('xs');

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
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 200,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-verb-tour-replay-title"
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
                boxShadow: '0 -12px 40px rgba(14,20,19,0.30)',
                zIndex: 201,
                paddingBottom: 'env(safe-area-inset-bottom)',
              }
            : {
                position: 'fixed',
                top: '12vh',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'min(620px, calc(100vw - 32px))',
                maxHeight: '76vh',
                overflow: 'auto',
                background: color.card,
                borderRadius: 14,
                boxShadow: '0 24px 60px rgba(14,20,19,0.30)',
                zIndex: 201,
              }
        }
      >
        <VerbTourPanel
          headingId="dm-verb-tour-replay-title"
          onDone={finish}
          onDismiss={onClose}
          saving={markSeen.isPending}
          saveFailed={markSeen.isError}
        />
      </div>
    </>
  );
}
