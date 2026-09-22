'use client';

import { useLocalState } from '@declutrmail/shared/hooks/use-local-state';
import { tokens } from '@declutrmail/shared';

import { RouteLoading } from '../route-loading';

/** First render matches SSR; the saved device mode is read after hydration. */
export default function Loading() {
  const [mode] = useLocalState<'focus' | 'list'>('triage.mode', 'focus');
  return (
    <RouteLoading
      variant="triage"
      triageMode={mode === 'list' ? 'list' : 'focus'}
      gap={20}
      kicker="Clean up / A considered decision"
      title="Triage"
      label="Loading triage queue"
      rows={1}
      rowHeight={440}
      rowRadius={tokens.radius['2xl']}
      maxWidth={mode === 'list' ? 928 : 688}
      headerHeight={44}
    />
  );
}
