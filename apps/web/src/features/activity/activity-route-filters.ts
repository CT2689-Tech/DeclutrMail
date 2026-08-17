import type {
  ActivityFilters,
  ActivityReviewOutcomeWire,
  ActivitySourceFilterWire,
  ActivityVerbFilterWire,
  ActivityWindowWire,
} from '@/lib/api/activity';

export interface ActivityDateFilters {
  dateFrom: string | null;
  dateTo: string | null;
  isInvalid: boolean;
}

export interface ActivityOutcomeFilters {
  outcomes: readonly ActivityReviewOutcomeWire[];
  isInvalid: boolean;
}

const ALLOWED_VERBS: ReadonlySet<ActivityVerbFilterWire> = new Set([
  'keep',
  'archive',
  'unsubscribe',
  'later',
  'delete',
  'followup-dismiss',
]);

export function readActivityDateFilters(params: Pick<URLSearchParams, 'get'>): ActivityDateFilters {
  const rawDateFrom = params.get('date_from');
  const rawDateTo = params.get('date_to');
  const dateFrom = readIsoDate(rawDateFrom);
  const dateTo = readIsoDate(rawDateTo);
  const hasMalformedDate =
    (rawDateFrom !== null && rawDateFrom !== '' && dateFrom === null) ||
    (rawDateTo !== null && rawDateTo !== '' && dateTo === null);
  const hasReversedRange =
    dateFrom !== null && dateTo !== null && Date.parse(dateFrom) >= Date.parse(dateTo);
  return { dateFrom, dateTo, isInvalid: hasMalformedDate || hasReversedRange };
}

export function readActivityOutcomeFilters(
  params: Pick<URLSearchParams, 'get'>,
): ActivityOutcomeFilters {
  const raw = params.get('outcome');
  if (!raw) return { outcomes: [], isInvalid: false };
  const allowed = new Set<ActivityReviewOutcomeWire>([
    'completed',
    'skipped',
    'failed',
    'recovered',
    'protected',
  ]);
  const seen = new Set<ActivityReviewOutcomeWire>();
  let isInvalid = false;
  for (const token of raw.split(',')) {
    const value = token.trim() as ActivityReviewOutcomeWire;
    if (!value || !allowed.has(value)) isInvalid = true;
    else seen.add(value);
  }
  return { outcomes: [...seen], isInvalid };
}

export function readActivityFilters(
  params: Pick<URLSearchParams, 'get'>,
  dates: ActivityDateFilters = readActivityDateFilters(params),
  outcomeFilter: ActivityOutcomeFilters = readActivityOutcomeFilters(params),
): ActivityFilters {
  return {
    window: readWindow(params.get('window')),
    source: readSource(params.get('source')),
    verbs: readVerbs(params.get('verb')),
    senderQuery: (params.get('sender_q') ?? '').trim(),
    dateFrom: dates.dateFrom,
    dateTo: dates.dateTo,
    outcomes: outcomeFilter.outcomes,
  };
}

function readWindow(raw: string | null): ActivityWindowWire {
  if (raw === '7d' || raw === '30d' || raw === '90d' || raw === 'all') return raw;
  return '30d';
}

function readSource(raw: string | null): ActivitySourceFilterWire {
  if (raw === 'triage' || raw === 'manual' || raw === 'autopilot' || raw === 'screener') {
    return raw;
  }
  return 'all';
}

function readVerbs(raw: string | null): readonly ActivityVerbFilterWire[] {
  if (!raw) return [];
  const seen = new Set<ActivityVerbFilterWire>();
  for (const token of raw.split(',')) {
    const value = token.trim() as ActivityVerbFilterWire;
    if (ALLOWED_VERBS.has(value)) seen.add(value);
  }
  return [...seen];
}

function readIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
