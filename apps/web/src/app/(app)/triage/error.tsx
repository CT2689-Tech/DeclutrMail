// Per-route error boundary for `/triage` (D167 + D170 + D211).
// 2026-07-04 launch audit: this route previously fell through to the
// global boundary. Copy + capture live in the shared screen.

'use client';

import { useLocalState } from '@declutrmail/shared/hooks/use-local-state';

import { RouteErrorScreen } from '@/components/route-error-screen';

export default function TriageError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined };
  reset: () => void;
}) {
  const [mode] = useLocalState<'focus' | 'list'>('triage.mode', 'focus');
  return (
    <RouteErrorScreen
      gap={20}
      title="Triage"
      kicker="Clean up / A considered decision"
      maxWidth={mode === 'list' ? 928 : 688}
      triageMode={mode === 'list' ? 'list' : 'focus'}
      error={error}
      reset={reset}
      boundary="triage"
      headline="We couldn't load your triage queue."
      body="Your mailbox is unchanged. Try again, or review senders."
      escape={{ href: '/senders', label: 'Back to Senders' }}
    />
  );
}
