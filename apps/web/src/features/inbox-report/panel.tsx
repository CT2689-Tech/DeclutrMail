'use client';

import { useEffect, useRef, useState } from 'react';

import { fillCopy, isPluralCopy, pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';
import { launchPriceDisplay, METER, TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import {
  formatReportSize,
  reportFallback,
  reportGlyph,
  reportHeadline,
  reportSupport,
  type InboxReportDto,
} from '@declutrmail/shared/inbox-report';
import {
  BACKLOG_PASS_NAME,
  CONNECTION_TERM,
  SCREENER_NAME,
} from '@declutrmail/shared/copy/screen-decisions';

import { useVisitorPriceLocale } from '@/features/billing/billing-currency';
import {
  UnsubscribeBacklogDialog,
  type UnsubscribeBacklogOptions,
  type UnsubscribeSnapshotCounts,
} from '@/features/senders/unsubscribe-backlog/unsubscribe-backlog-dialog';
import type { ActionRequest } from '@/features/senders/data';
import { useBulkActionPreview, useCompositePreview } from '@/lib/api/use-action';
import { apiErrorCode } from '@/lib/api/client';

import type { ReportCelebration } from './seen';

import './report.css';

const BURST = Array.from({ length: 12 }, (_, index) => ({
  a: `${index * 30}deg`,
  d: `${12 + (index % 5) * 2}px`,
}));

function ReportCount({ figure, mailboxId }: { figure: string; mailboxId?: string | undefined }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    const root = el?.closest('.dm-report');
    const target = Number.parseInt(figure, 10);
    if (!el || !root || !mailboxId || !Number.isFinite(target)) return;
    const suffix = figure.slice(String(target).length);
    const key = `reportRevealSeen:${mailboxId}`;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || localStorage.getItem(key) || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        io.disconnect();
        localStorage.setItem(key, '1');
        const started = performance.now();
        let last = started;
        const tick = (now: number) => {
          if (now <= last && now > started) {
            el.textContent = figure;
            return;
          }
          last = now;
          const p = Math.min(1, (now - started) / 700);
          const eased = 1 - (1 - p) ** 3;
          el.textContent = `${Math.round(target * eased)}${suffix}`;
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.5 },
    );
    io.observe(root);
    return () => io.disconnect();
  }, [figure, mailboxId]);
  return (
    <span ref={ref} className="dm-display-xl" data-report-figure aria-label={figure}>
      {figure}
    </span>
  );
}

function CelebrationMark({ mailboxId }: { mailboxId?: string | undefined }) {
  const key = mailboxId ? `reportBurstSeen:${mailboxId}` : null;
  const [play, setPlay] = useState(false);
  useEffect(() => {
    if (!key || localStorage.getItem(key) === '1') return;
    setPlay(true);
    localStorage.setItem(key, '1');
  }, [key]);
  return (
    <div className="dm-check" aria-hidden="true" data-report-check>
      <svg viewBox="0 0 56 56">
        <circle
          cx="28"
          cy="28"
          r="26"
          fill="var(--dm-primary-soft)"
          stroke="var(--dm-primary)"
          strokeWidth="2"
        />
        <path
          d="M17 29.5l7 7 15-16"
          fill="none"
          stroke="var(--dm-primary)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {play ? (
        <span className="dm-burst">
          {BURST.map((dot) => (
            <i key={dot.a} style={{ ['--a' as string]: dot.a, ['--d' as string]: dot.d }} />
          ))}
        </span>
      ) : null}
    </div>
  );
}

function sentenceBesideFigure(sentence: string, figure: string | null): string {
  if (!figure) return sentence;
  const prefix = `${figure} `;
  return sentence.startsWith(prefix) ? sentence.slice(prefix.length) : sentence;
}

function ReportGlyphs({ n }: { n: number }) {
  const filled = Math.max(0, Math.min(10, n));
  return (
    <p className="dm-report-glyphs" aria-hidden="true" data-report-glyphs>
      {Array.from({ length: 10 }, (_, index) => (
        <svg key={index} viewBox="0 0 18 14" aria-hidden="true" data-filled={index < filled}>
          <rect
            x="1"
            y="1"
            width="16"
            height="12"
            rx="2.5"
            fill={index < filled ? 'var(--dm-primary)' : 'transparent'}
            stroke="var(--dm-primary)"
            strokeWidth="1.4"
            opacity={index < filled ? 1 : 0.28}
          />
          <path
            d="M2.6 2.8 9 7.8l6.4-5"
            fill="none"
            stroke={index < filled ? 'var(--dm-card)' : 'var(--dm-primary)'}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </p>
  );
}

function envPassEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_BILLING_PASS_ENABLED ?? process.env.BILLING_PASS_ENABLED;
  return raw === 'true' || raw === '1';
}

/** Same public endpoint as `loadPricingFlags`. This panel is a client island. */
function useCatalogFlags(): { pricingV2: boolean; passEnabled: boolean } {
  const [flags, setFlags] = useState({
    pricingV2: process.env.PRICING_V2 === 'true',
    passEnabled: envPassEnabled(),
  });
  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL;
    if (!apiBase) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    void fetch(`${apiBase}/api/pricing/public`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body: unknown = await response.json();
        const data =
          typeof body === 'object' && body !== null && 'data' in body
            ? (body as { data?: unknown }).data
            : body;
        if (typeof data !== 'object' || data === null) return;
        const record = data as { pricingV2?: unknown; passEnabled?: unknown };
        setFlags({
          pricingV2: record.pricingV2 === true,
          passEnabled: record.passEnabled === true,
        });
      })
      .catch(() => undefined);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  return flags;
}

function money(cents: number | null | undefined): string {
  if (cents == null) return '';
  return `$${Math.round(cents / 100)}`;
}

export function InboxReportPanel({
  report,
  mailboxEmail,
  dismissed = false,
  resetDate = '',
  onDismiss,
  onReopen,
  onFixConfirmed,
  celebration = null,
  undoToken,
  onUndo,
  mailboxId,
  senderNames,
  fixPreviewCounts,
  /** In-demo review. The signed-in app keeps the senders link. */
  onReview,
  /** Public demo uses `/privacy`. The signed-in app keeps settings. */
  trustHref = '/settings/privacy',
}: {
  report: InboxReportDto;
  mailboxEmail?: string | undefined;
  dismissed?: boolean;
  resetDate?: string;
  onDismiss: () => void;
  onReopen: () => void;
  onFixConfirmed?: (
    mode: 'archive' | 'delete' | 'unsub_only',
    reach?: 'all_mail',
    olderThanDays?: number,
  ) => void;
  /** Synthetic demo buckets; live mailboxes always read a fresh preview. */
  fixPreviewCounts?: UnsubscribeSnapshotCounts;
  onReview?: () => void;
  trustHref?: string;
  celebration?: ReportCelebration | null;
  /** Activity undo token for the latest archive. The button uses the deck sentence. */
  undoToken?: string;
  onUndo?: () => void;
  /**
   * Signed-in mailbox. When set, Archive and Delete wait for a live
   * preview count instead of the cached report figure.
   */
  mailboxId?: string;
  /** Sample or loaded names. The report DTO only carries sender ids. */
  senderNames?: Readonly<
    Record<string, { name: string; unsubscribeMethod?: 'one_click' | 'mailto' | 'none' | null }>
  >;
}) {
  const catalog = useCatalogFlags();
  const visitorLocale = useVisitorPriceLocale();
  const [fixOpen, setFixOpen] = useState(false);
  const calm = report.variant === 'fallback';
  const headline = calm ? null : report.insights[0] ? reportHeadline(report.insights[0]) : null;
  const glyph =
    headline && report.insights[0]?.id === 'mostly_unread_share'
      ? reportGlyph(report.insights[0].pct)
      : null;
  const support = report.insights[0] ? reportSupport(report.insights[0]) : null;
  const facts = calm ? [] : report.insights.slice(1, 3);
  const fallback = reportFallback(report);
  const fixCopy = WS5_COPY['report.fix.primary'];
  const fixLabel =
    !calm && isPluralCopy(fixCopy)
      ? pluralCopy(fixCopy, report.fix.sendersCount, { n: report.fix.sendersCount })
      : '';
  const allowance = catalog.pricingV2
    ? METER.free.limit.toLocaleString('en-US')
    : (TIER_MANIFEST.free.cleanupActionsPerMonth ?? 0);
  const doneLine = celebration ? celebrationSentence(celebration) : null;
  const requestLine = celebration ? celebrationRequestLine(celebration) : null;
  const plusPrice = catalog.pricingV2
    ? launchPriceDisplay(visitorLocale).plus.amount
    : money(TIER_MANIFEST.plus.prices.annual?.usdCents);

  return (
    <section
      className="dm-report is-revealed"
      aria-label={WS5_COPY['report.eyebrow']}
      data-variant={report.variant}
    >
      {dismissed ? (
        <div className="dm-report-strip">
          <span>{WS5_COPY['report.reopen.strip']}</span>
          <button type="button" onClick={onReopen}>
            {WS5_COPY['report.reopen.button']}
          </button>
        </div>
      ) : (
        <>
          <header>
            <span>{WS5_COPY['report.eyebrow']}</span>
            <button
              type="button"
              className="dm-tap-44"
              aria-label={WS5_COPY['report.close.aria']}
              onClick={onDismiss}
            >
              ×
            </button>
          </header>
          {calm ? (
            <div>
              <p>{fallback.body}</p>
              {fallback.cta ? <button type="button">{fallback.cta}</button> : null}
            </div>
          ) : (
            <div>
              <div className="dm-report-grid">
                <div className="dm-report-lead">
                  {headline?.figure ? (
                    <ReportCount figure={headline.figure} mailboxId={mailboxId} />
                  ) : null}
                  {headline ? (
                    <p
                      className="dm-report-sentence"
                      data-report-sentence
                      data-reveal
                      style={{ ['--i' as string]: 1 }}
                    >
                      {sentenceBesideFigure(headline.sentence, headline.figure)}
                    </p>
                  ) : null}
                  <p className="dm-report-meta" data-report-window>
                    {WS5_COPY['report.window.90d']}
                  </p>
                  {glyph ? (
                    <div
                      className="dm-report-glyphs-row"
                      data-reveal
                      style={{ ['--i' as string]: 1 }}
                    >
                      <ReportGlyphs n={glyph.n} />
                    </div>
                  ) : null}
                  {support ? (
                    <p data-reveal style={{ ['--i' as string]: 2 }}>
                      {support}
                    </p>
                  ) : null}
                </div>
                <div className="dm-report-side">
                  {facts.map((insight) => (
                    <p key={insight.id} data-reveal>
                      {reportHeadline(insight).sentence}
                    </p>
                  ))}
                  <p>
                    {mailboxEmail ? (
                      <span data-report-basis>
                        {fillCopy(WS5_COPY['report.basis'], {
                          total: report.receivedCount.toLocaleString('en-US'),
                          mailboxEmail,
                        })}
                      </span>
                    ) : null}
                    {mailboxEmail ? ' · ' : null}
                    <span data-report-sizes>{WS5_COPY['report.sizesNote']}</span>
                  </p>
                </div>
              </div>
              <hr className="dm-report-rule" />
              {report.fix.sendersCount > 0 && !celebration ? (
                <div className="dm-report-actions" data-reveal style={{ ['--i' as string]: 3 }}>
                  <p>
                    {isPluralCopy(WS5_COPY['report.fix.heading'])
                      ? pluralCopy(WS5_COPY['report.fix.heading'], report.fix.sendersCount, {
                          n: report.fix.sendersCount,
                        })
                      : ''}
                  </p>
                  <button type="button" data-report-fix onClick={() => setFixOpen(true)}>
                    {fixLabel}
                  </button>
                  {onReview ? (
                    <button type="button" onClick={onReview}>
                      {WS5_COPY['report.fix.review']}
                    </button>
                  ) : (
                    <a href={`/senders?fix=${report.fix.senderKeys.join(',')}`}>
                      {WS5_COPY['report.fix.review']}
                    </a>
                  )}
                  <button type="button" onClick={onDismiss}>
                    {WS5_COPY['report.fix.notNow']}
                  </button>
                </div>
              ) : null}
              <p>
                {WS5_COPY['report.trust']}{' '}
                <a className="dm-tap-target" href={trustHref}>
                  {WS5_COPY['report.trust.link']}
                </a>
              </p>
              {celebration ? (
                <div className="dm-report-celebrate" data-celebration>
                  <CelebrationMark mailboxId={mailboxId} />
                  <div>
                    {doneLine ? <p>{doneLine}</p> : null}
                    {celebration.verb === 'delete' && doneLine ? (
                      <p>{WS5_COPY['report.celebrate.delete.note']}</p>
                    ) : null}
                    {requestLine ? <p>{requestLine}</p> : null}
                    {celebration.verb === 'delete' || celebration.verb === 'unsub_only' ? null : (
                      <>
                        {undoToken ? (
                          <button type="button" onClick={onUndo}>
                            {WS5_COPY['report.celebrate.undo.button']}
                          </button>
                        ) : null}
                        <p>{WS5_COPY['report.celebrate.undo']}</p>
                      </>
                    )}
                    {celebration.verb === 'delete' || celebration.verb === 'unsub_only' ? null : (
                      <p>{WS5_COPY['report.storageNote']}</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}
          {!calm && resetDate ? (
            <div>
              {catalog.passEnabled ? (
                <p>{fillCopy(WS5_COPY['report.upgrade.pass'], { passName: BACKLOG_PASS_NAME })}</p>
              ) : (
                <p>
                  {fillCopy(WS5_COPY['report.upgrade.plus.passOff'], {
                    plusName: TIER_MANIFEST.plus.name,
                  })}
                  <span>
                    {fillCopy(WS5_COPY['report.upgrade.plus.passOff.sub'], {
                      plusPrice,
                      plusInboxes: TIER_MANIFEST.plus.inboxLimit,
                      CONNECTION_TERM_PLURAL: `${CONNECTION_TERM}s`,
                    })}
                  </span>
                </p>
              )}
              <p>
                {fillCopy(WS5_COPY['report.upgrade.free'], {
                  freeName: TIER_MANIFEST.free.name,
                  allowance,
                  resetDate,
                })}
              </p>
              <p>
                {fillCopy(WS5_COPY['report.upgrade.plusLink'], {
                  plusName: TIER_MANIFEST.plus.name,
                  plusPrice,
                  plusInboxes: TIER_MANIFEST.plus.inboxLimit,
                  CONNECTION_TERM_PLURAL: `${CONNECTION_TERM}s`,
                  SCREENER_NAME,
                })}
              </p>
            </div>
          ) : null}
        </>
      )}
      {fixOpen ? (
        <ReportFixDialog
          report={report}
          senderNames={senderNames}
          mailboxId={mailboxId}
          mailboxEmail={mailboxEmail}
          fixPreviewCounts={fixPreviewCounts}
          onCancel={() => setFixOpen(false)}
          onConfirm={(opts) => {
            setFixOpen(false);
            const mode = opts.secondary?.type ?? 'unsub_only';
            if (opts.secondary?.olderThanDays != null) {
              onFixConfirmed?.(mode, opts.reach, opts.secondary.olderThanDays);
            } else if (mode === 'delete' && opts.reach) onFixConfirmed?.(mode, opts.reach);
            else onFixConfirmed?.(mode);
          }}
        />
      ) : null}
    </section>
  );
}

function reportFixRequest(
  report: InboxReportDto,
  senderNames: InboxReportPanelProps['senderNames'],
): ActionRequest {
  return {
    verb: 'Unsubscribe',
    senders: report.fix.senderKeys.map((id) => {
      const known = senderNames?.[id];
      return {
        id,
        name: known?.name ?? '',
        ...(known?.unsubscribeMethod ? { unsubscribeMethod: known.unsubscribeMethod } : {}),
      };
    }),
  } as ActionRequest;
}

type FixConfirm = (opts: UnsubscribeBacklogOptions) => void;

function ReportFixDialog({
  report,
  senderNames,
  mailboxId,
  mailboxEmail,
  fixPreviewCounts,
  onCancel,
  onConfirm,
}: {
  report: InboxReportDto;
  senderNames: InboxReportPanelProps['senderNames'];
  mailboxId: string | undefined;
  mailboxEmail?: string | undefined;
  fixPreviewCounts?: UnsubscribeSnapshotCounts | undefined;
  onCancel: () => void;
  onConfirm: FixConfirm;
}) {
  const request = reportFixRequest(report, senderNames);
  if (!mailboxId) {
    return (
      <UnsubscribeBacklogDialog
        request={request}
        mailboxEmail={mailboxEmail}
        preferredInboxCount={report.fix.inboxEmailCount}
        preferredCounts={fixPreviewCounts}
        preferArchive
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
  }
  return (
    <LiveReportFixDialog
      mailboxId={mailboxId}
      request={request}
      mailboxEmail={mailboxEmail}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function LiveReportFixDialog({
  mailboxId,
  mailboxEmail,
  request,
  onCancel,
  onConfirm,
}: {
  mailboxId: string;
  mailboxEmail?: string | undefined;
  request: ActionRequest;
  onCancel: () => void;
  onConfirm: FixConfirm;
}) {
  const ids = request.senders.map((sender) => sender.id);
  const composite = useCompositePreview(ids.length === 1 ? ids[0]! : null, mailboxId);
  const bulk = useBulkActionPreview(ids.length > 1 ? ids : null, mailboxId);
  if (ids.length > 1) {
    return (
      <UnsubscribeBacklogDialog
        request={request}
        mailboxEmail={mailboxEmail}
        bulkPreview={{ data: bulk.data, loading: bulk.isFetching, error: bulk.isError }}
        onRetryPreview={() => {
          void bulk.refetch();
        }}
        preferArchive
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
  }
  return (
    <UnsubscribeBacklogDialog
      request={request}
      mailboxEmail={mailboxEmail}
      compositePreview={composite.data}
      compositePreviewLoading={composite.isFetching}
      compositePreviewError={composite.isError}
      previewSenderGone={apiErrorCode(composite.error) === 'SENDER_NOT_FOUND'}
      onRetryPreview={() => {
        void composite.refetch();
      }}
      preferArchive
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function celebrationSentence(celebration: ReportCelebration): string | null {
  if (celebration.verb === 'unsub_only') return null;
  if (celebration.verb === 'delete') {
    if (typeof celebration.bytes !== 'number') return null;
    const size = formatReportSize(celebration.bytes);
    if (celebration.archived === 1) {
      return fillCopy(WS5_COPY['report.celebrate.delete.one'], { size });
    }
    return fillCopy(WS5_COPY['report.celebrate.delete'], {
      count: celebration.archived.toLocaleString('en-US'),
      size,
    });
  }
  if (celebration.archived <= 0) return null;
  if (celebration.archived === 1) {
    return WS5_COPY['report.celebrate.archive.oneEmail'];
  }
  if (celebration.senders === 1) {
    return fillCopy(WS5_COPY['report.celebrate.archive.one'], {
      X: celebration.archived.toLocaleString('en-US'),
    });
  }
  return fillCopy(WS5_COPY['report.celebrate.archive'], {
    X: celebration.archived.toLocaleString('en-US'),
    n: celebration.senders.toLocaleString('en-US'),
  });
}

function celebrationRequestLine(celebration: ReportCelebration): string | null {
  const requested = celebration.requested ?? 0;
  const manual = celebration.manual ?? 0;
  const parts: string[] = [];
  const unsub = WS5_COPY['report.celebrate.unsub'];
  const handoff = WS5_COPY['report.celebrate.unsubManual'];
  if (requested > 0 && isPluralCopy(unsub)) {
    parts.push(pluralCopy(unsub, requested, { m: requested.toLocaleString('en-US') }));
  }
  if (manual > 0 && isPluralCopy(handoff)) {
    parts.push(pluralCopy(handoff, manual, { k: manual.toLocaleString('en-US') }));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

type InboxReportPanelProps = Parameters<typeof InboxReportPanel>[0];
