import { Button, Eyebrow, tokens, useIsAtMost } from '@declutrmail/shared';
import type { AutopilotPatternSuggestionDto } from '@/lib/api/autopilot';

const { color, font } = tokens;

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
  const isPhone = useIsAtMost('xs');
  return (
    <section
      aria-labelledby="pattern-suggestion-heading"
      style={{
        padding: 18,
        border: `1px solid ${color.primaryBorder}`,
        borderRadius: 12,
        background: color.primaryWash,
        fontFamily: font.sans,
      }}
    >
      <Eyebrow>Suggested rule</Eyebrow>
      <h2
        id="pattern-suggestion-heading"
        style={{ fontSize: 16, fontWeight: 600, margin: '6px 0 4px' }}
      >
        You {pastAction} {suggestion.evidenceCount} matching senders in the last{' '}
        {suggestion.evidenceWindowDays} days.
      </h2>
      <p style={{ color: color.fgSoft, fontSize: 13, lineHeight: 1.55, margin: '0 0 14px' }}>
        Watch for the same pattern? It starts in Observe: you approve or skip each suggestion.
      </p>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: isPhone ? '1fr' : 'max-content 1fr',
          gap: isPhone ? '2px 12px' : '6px 12px',
          margin: 0,
          fontSize: 12.5,
        }}
      >
        <Fact label="Based on">{suggestion.evidenceCount} distinct sender decisions.</Fact>
        <Fact label="Safety">Protected senders are always skipped.</Fact>
        <Fact label="Daily cap">{suggestion.dailyActionCap} actions; extra matches wait.</Fact>
        <Fact label="Recovery">
          {suggestion.actionKind === 'archive'
            ? 'Approved Archive suggestions can be undone from Activity within your undo window.'
            : 'Unsubscribe requests cannot be undone.'}
        </Fact>
      </dl>
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <Button tone="primary" size="sm" onClick={onObserve} disabled={pendingDecision != null}>
          {pendingDecision === 'observe' ? 'Starting Observe…' : 'Use in Observe'}
        </Button>
        <Button tone="default" size="sm" onClick={onDismiss} disabled={pendingDecision != null}>
          {pendingDecision === 'dismissed' ? 'Dismissing…' : 'Not now'}
        </Button>
      </div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt style={{ color: color.fgMuted, fontFamily: font.mono }}>{label}</dt>
      <dd style={{ color: color.fg, margin: 0 }}>{children}</dd>
    </>
  );
}
