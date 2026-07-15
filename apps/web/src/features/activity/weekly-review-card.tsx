import { tokens } from '@declutrmail/shared';
import type { ActivityReviewOutcomeWire, ActivityWeeklyReviewWire } from '@/lib/api/activity';

const { color, font } = tokens;
const OUTCOMES: Array<{ key: ActivityReviewOutcomeWire; label: string }> = [
  { key: 'completed', label: 'Completed' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'failed', label: 'Failed' },
  { key: 'recovered', label: 'Recovered' },
  { key: 'protected', label: 'Protected' },
];

export function WeeklyReviewCard({
  review,
  loading,
  error,
  onRetry,
  activeOutcome,
}: {
  review: ActivityWeeklyReviewWire | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  activeOutcome: ActivityReviewOutcomeWire | null;
}) {
  return (
    <section
      aria-labelledby="weekly-review-heading"
      style={{
        padding: 16,
        border: `1px solid ${color.line}`,
        borderRadius: 12,
        background: color.card,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 id="weekly-review-heading" style={{ fontSize: 15, margin: 0 }}>
            Your last 7 days
          </h2>
          <p style={{ margin: '4px 0 0', color: color.fgSoft, fontSize: 12.5 }}>
            Exact outcomes from Activity. Select a count to see its records.
          </p>
        </div>
        {activeOutcome && (
          <a href="/activity?window=7d" style={{ color: color.fgSoft, fontSize: 12 }}>
            Clear {activeOutcome} filter
          </a>
        )}
      </div>
      {loading && <p role="status">Loading weekly outcomes…</p>}
      {error && (
        <div role="alert" style={{ marginTop: 12, color: color.danger }}>
          Weekly outcomes could not load.{' '}
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {review && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
              gap: 8,
              marginTop: 14,
            }}
          >
            {OUTCOMES.map(({ key, label }) => (
              <a
                key={key}
                href={`/activity?window=7d&outcome=${key}&date_from=${encodeURIComponent(review.from)}&date_to=${encodeURIComponent(review.to)}`}
                aria-current={activeOutcome === key ? 'page' : undefined}
                style={{
                  padding: '10px 12px',
                  border: `1px solid ${activeOutcome === key ? color.primary : color.lineSoft}`,
                  borderRadius: 8,
                  color: color.fg,
                  textDecoration: 'none',
                }}
              >
                <strong style={{ display: 'block', fontFamily: font.display, fontSize: 20 }}>
                  {review[key]}
                </strong>
                <span style={{ color: color.fgSoft, fontSize: 12 }}>{label}</span>
              </a>
            ))}
          </div>
          {OUTCOMES.every(({ key }) => review[key] === 0) && (
            <p style={{ margin: '12px 0 0', color: color.fgSoft, fontSize: 12.5 }}>
              No outcomes in the last 7 days. Nothing needs your attention.
            </p>
          )}
        </>
      )}
    </section>
  );
}
