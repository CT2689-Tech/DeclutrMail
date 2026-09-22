import { Button, tokens } from '@declutrmail/shared';
import type { AutopilotPatternSuggestionDto } from '@/lib/api/autopilot';
import { bannerSurface } from './autopilot-banner-stack';

const { color, text } = tokens;

export function PatternSuggestionCard({
  suggestion,
  pendingDecision,
  onObserve,
  onDismiss,
}: {
  suggestion: AutopilotPatternSuggestionDto;
  pendingDecision: 'observe' | 'dismissed' | null;
  onObserve: () => void;
  onDismiss: () => void;
}) {
  const pastAction =
    suggestion.actionKind === 'archive' ? 'archived' : 'requested unsubscribe from';
  return (
    <section aria-labelledby="pattern-suggestion-heading" style={bannerSurface}>
      <h2
        id="pattern-suggestion-heading"
        style={{ fontSize: text.md, fontWeight: 600, margin: 0, color: color.fg }}
      >
        You {pastAction} {suggestion.evidenceCount} matching senders in the last{' '}
        {suggestion.evidenceWindowDays} days.
      </h2>
      <p style={{ color: color.fgSoft, fontSize: text.sm, lineHeight: 1.5, margin: '2px 0 0' }}>
        Watch for the same pattern? You approve or skip each suggestion.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Button tone="primary" size="sm" onClick={onObserve} disabled={pendingDecision != null}>
          {pendingDecision === 'observe' ? 'Starting Watch first…' : 'Watch first'}
        </Button>
        <Button tone="default" size="sm" onClick={onDismiss} disabled={pendingDecision != null}>
          {pendingDecision === 'dismissed' ? 'Dismissing…' : 'Not now'}
        </Button>
      </div>
    </section>
  );
}
