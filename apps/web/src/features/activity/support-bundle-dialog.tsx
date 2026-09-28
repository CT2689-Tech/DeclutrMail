'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import { Button, TechnicalDetails, tokens } from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';

import { technicalErrorDetails } from '@/lib/action-error-copy';
import type {
  ActivityFilters,
  ActivityReviewOutcomeWire,
  ActivitySourceFilterWire,
  ActivityVerbFilterWire,
  ActivityWindowWire,
} from '@/lib/api/activity';

import { FilterFields } from './activity-filter-fields';
import { useActivitySupportBundle } from './api/use-activity-support-bundle';

/**
 * The Activity support-bundle review dialog. Its own module so the screen
 * can load it on first open (`next/dynamic`) instead of shipping it in the
 * /activity first-load bundle.
 */

const { color, font, radius, shadow, text } = tokens;

interface EditableActivityFilters {
  window: ActivityWindowWire;
  source: ActivitySourceFilterWire;
  verbs: ActivityVerbFilterWire[];
  senderQuery: string;
  dateFrom: string | null;
  dateTo: string | null;
  outcomes: ActivityReviewOutcomeWire[];
}

export function ActivitySupportBundleDialog({
  initialFilters,
  mailboxEmail,
  mailboxId,
  onClose,
}: {
  initialFilters: ActivityFilters;
  mailboxEmail: string | null;
  mailboxId: string | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<EditableActivityFilters>(() => ({
    window: initialFilters.window ?? '30d',
    source: initialFilters.source ?? 'all',
    verbs: [...(initialFilters.verbs ?? [])],
    senderQuery: initialFilters.senderQuery ?? '',
    dateFrom: initialFilters.dateFrom ?? null,
    dateTo: initialFilters.dateTo ?? null,
    outcomes: [...(initialFilters.outcomes ?? [])],
  }));
  const [includeFullSenderAddresses, setIncludeFullSenderAddresses] = useState(false);
  const [includeTechnicalDetails, setIncludeTechnicalDetails] = useState(false);
  const exportBundle = useActivitySupportBundle();
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const invalidRange =
    draft.dateFrom !== null &&
    draft.dateTo !== null &&
    Date.parse(draft.dateFrom) >= Date.parse(draft.dateTo);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exportBundle.isPending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exportBundle.isPending, onClose]);

  const submit = async () => {
    if (invalidRange || exportBundle.isPending) return;
    try {
      await exportBundle.mutateAsync({
        filters: draft,
        mailboxId,
        includeFullSenderAddresses,
        includeTechnicalDetails,
      });
      onClose();
    } catch {
      // Mutation state renders the recoverable error without closing the review dialog.
    }
  };

  return (
    <>
      <div
        data-testid="activity-support-bundle-backdrop"
        onClick={exportBundle.isPending ? undefined : onClose}
        className="dm-scrim"
        style={{ position: 'fixed', inset: 0, zIndex: 180 }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-support-bundle-title"
        aria-describedby="activity-support-bundle-lead"
        className="dm-sheet"
        style={{
          position: 'fixed',
          top: '6vh',
          left: 0,
          right: 0,
          margin: '0 auto',
          width: 'min(720px, calc(100vw - 28px))',
          maxHeight: '88vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: radius['2xl'],
          boxShadow: shadow.modal,
          zIndex: 181,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '28px 28px 16px' }}>
          <h2
            id="activity-support-bundle-title"
            style={{
              margin: 0,
              color: color.fg,
              fontSize: text.xl,
              fontWeight: 650,
              letterSpacing: '-0.02em',
            }}
          >
            Export Activity support bundle
          </h2>
          <p
            id="activity-support-bundle-lead"
            style={{ margin: '7px 0 0', color: color.fgSoft, fontSize: text.base, lineHeight: 1.5 }}
          >
            Review which Activity records to include. The ZIP contains a readable summary and CSV
            for all matching records, not only rows currently loaded on screen.
          </p>
          <p style={{ margin: '7px 0 0', color: color.fgMuted, fontSize: text.sm }}>
            mailbox: <strong style={{ color: color.fg }}>{mailboxEmail ?? 'Active mailbox'}</strong>
          </p>
        </div>

        <div style={{ padding: '12px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section aria-labelledby="activity-support-bundle-filters">
            <h3
              id="activity-support-bundle-filters"
              style={{ margin: '0 0 9px', color: color.fg, fontSize: text.md, fontWeight: 600 }}
            >
              Records to include
            </h3>
            <div>
              <FilterFields
                source={draft.source}
                onSource={(source) => setDraft((current) => ({ ...current, source }))}
                verbs={draft.verbs}
                onVerbs={(verbs) => setDraft((current) => ({ ...current, verbs: [...verbs] }))}
                window={draft.window}
                dateFrom={draft.dateFrom}
                dateTo={draft.dateTo}
                onWindow={(window) =>
                  setDraft((current) => ({
                    ...current,
                    window,
                    dateFrom: null,
                    dateTo: null,
                  }))
                }
                onRange={(dateFrom, dateTo) =>
                  setDraft((current) => ({ ...current, dateFrom, dateTo }))
                }
                senderQuery={draft.senderQuery}
                onSenderQuery={(senderQuery) =>
                  setDraft((current) => ({ ...current, senderQuery }))
                }
                senderSearchDebounceMs={0}
              />
              {draft.outcomes.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginTop: 10,
                    color: color.fgSoft,
                    fontSize: text.sm,
                  }}
                >
                  <span>Review outcome: {draft.outcomes.join(', ')}</span>
                  <button
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, outcomes: [] }))}
                    style={{
                      color: color.primary,
                      background: 'none',
                      border: 0,
                      cursor: 'pointer',
                    }}
                  >
                    Include all outcomes
                  </button>
                </div>
              )}
            </div>
            {invalidRange && (
              <div role="alert" style={{ marginTop: 8, color: color.danger, fontSize: text.sm }}>
                The From date must be earlier than the To date.
              </div>
            )}
          </section>

          <section aria-labelledby="activity-support-bundle-privacy">
            <h3
              id="activity-support-bundle-privacy"
              style={{ margin: '0 0 9px', color: color.fg, fontSize: text.md, fontWeight: 600 }}
            >
              Privacy options
            </h3>
            <label style={supportBundleOptionStyle}>
              <input
                type="checkbox"
                checked={includeFullSenderAddresses}
                onChange={(event) => setIncludeFullSenderAddresses(event.target.checked)}
              />
              <span>
                <strong style={{ color: color.fg }}>Include full sender addresses</strong>
                <span style={supportBundleOptionHelpStyle}>
                  Off by default. Otherwise addresses are masked, such as j***@example.com.
                </span>
              </span>
            </label>
            <label style={{ ...supportBundleOptionStyle, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={includeTechnicalDetails}
                onChange={(event) => setIncludeTechnicalDetails(event.target.checked)}
              />
              <span>
                <strong style={{ color: color.fg }}>Include technical details</strong>
                <span style={supportBundleOptionHelpStyle}>
                  Adds a separate JSON appendix for support correlation.
                </span>
              </span>
            </label>
            <TechnicalDetails
              summary="What technical details can be included?"
              style={{ marginTop: 10 }}
            >
              The optional appendix contains the bundle version, internal mailbox and Activity
              identifiers, action-attempt identifiers, machine action/source values, execution
              status, classified error codes, and filter dates. No tokens, idempotency keys, message
              bodies, or raw provider responses.
            </TechnicalDetails>
          </section>

          {exportBundle.error && (
            <div
              role="alert"
              style={{
                padding: '12px 14px',
                borderRadius: radius.lg,
                color: color.danger,
                background: color.dangerBg,
                fontSize: text.base,
              }}
            >
              We couldn&apos;t create the support bundle. Your Activity is unchanged. Review the
              options and try again.
              <TechnicalDetails summary="Show error details" style={{ marginTop: 8 }}>
                {technicalErrorDetails(exportBundle.error)}
              </TechnicalDetails>
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '16px 28px 28px',
          }}
        >
          <Button tone="default" onClick={onClose} disabled={exportBundle.isPending}>
            Cancel
          </Button>
          <Button
            tone="primary"
            onClick={() => void submit()}
            disabled={invalidRange || exportBundle.isPending}
          >
            {exportBundle.isPending ? 'Creating bundle…' : 'Download bundle'}
          </Button>
        </div>
      </div>
    </>
  );
}

const supportBundleOptionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 9,
  padding: '6px 0',
  color: color.fgSoft,
  fontSize: text.base,
  lineHeight: 1.45,
};

const supportBundleOptionHelpStyle: CSSProperties = {
  display: 'block',
  marginTop: 2,
  color: color.fgMuted,
  fontSize: text.sm,
};
