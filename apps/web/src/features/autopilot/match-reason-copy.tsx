import { TechnicalDetails } from '@declutrmail/shared';
import { describeMatchReason } from './match-reason';

/** Shared between pending suggestions and the read-only rule preview. */
export function MatchReasonCopy({ reason, prefix = '' }: { reason: string; prefix?: string }) {
  const copy = describeMatchReason(reason);
  return (
    <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <span>
        {prefix}
        {copy.label}
      </span>
      {copy.technical !== null && (
        <TechnicalDetails
          summary="Show recorded match details"
          style={{ border: 0, background: 'transparent', marginTop: 2 }}
        >
          {copy.technical}
          {copy.technical.startsWith('Read rate ') && (
            <p style={{ marginBottom: 0 }}>
              Read-rate diagnostics may exclude mail marked read by other tools. They do not prove
              whether you read an email.
            </p>
          )}
        </TechnicalDetails>
      )}
    </div>
  );
}
