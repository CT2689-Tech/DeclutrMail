import type {
  ActivityBucket,
  SenderListDirection,
  SenderListSort,
  TriStateFilter,
} from '@/lib/api/senders';

/**
 * Scope the Senders screen turns into `useSenders(...)`. Kept here so
 * the server prefetch and the client hook hash the same key — a mismatch
 * hydrates a cache entry the screen never reads, and first row waits
 * on a second fetch.
 */
export interface SendersScreenScope {
  sort: SenderListSort;
  direction: SenderListDirection;
  q: string;
  compose: {
    activity: ActivityBucket | null;
    activityNegate: boolean;
    unsubReady: TriStateFilter;
    replied: TriStateFilter;
    protectedFlag: TriStateFilter;
    windowDays: number | null;
    domain: string | null;
    unsubIgnored: boolean;
  };
}

function parseActivity(raw: string | null): {
  activity: ActivityBucket | null;
  activityNegate: boolean;
} {
  // Absent param = the launch-audit B2 default: active senders only.
  // `?activity=all` is the explicit no-filter state (what the chip
  // toggling off / "Clear filters" writes), so the two are distinct
  // and both round-trip through the URL.
  if (!raw) return { activity: 'active', activityNegate: false };
  if (raw === 'all') return { activity: null, activityNegate: false };
  const negate = raw.startsWith('not-');
  const value = negate ? raw.slice(4) : raw;
  if (value === 'active' || value === 'quiet' || value === 'dormant') {
    return { activity: value, activityNegate: negate };
  }
  return { activity: 'active', activityNegate: false };
}

function parseTri(raw: string | null): TriStateFilter {
  if (raw === 'true') return true;
  if (raw === 'not' || raw === 'false') return false;
  return null;
}

function parseWindow(raw: string | null): number | null {
  if (!raw) return null;
  const aliases: Record<string, number> = {
    '30': 30,
    '90': 90,
    '180': 180,
    '365': 365,
    '30d': 30,
    '90d': 90,
    '180d': 180,
    '365d': 365,
  };
  if (aliases[raw] !== undefined) return aliases[raw]!;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 3650 ? parsed : null;
}

function parseSort(raw: string | null): SenderListSort {
  return raw === 'last_seen' ||
    raw === 'first_seen' ||
    raw === 'name' ||
    raw === 'read' ||
    raw === 'recommended'
    ? raw
    : 'total';
}

function parseDirection(raw: string | null): SenderListDirection {
  return raw === 'asc' ? 'asc' : 'desc';
}

/**
 * Turn Next searchParams / a URL query into the same scope the Senders
 * screen reads. Unknown keys (`utm_*`) are ignored so a marketing URL
 * still hashes as the default list.
 */
export function parseSendersScope(params: Pick<URLSearchParams, 'get'>): SendersScreenScope {
  const { activity, activityNegate } = parseActivity(params.get('activity'));
  return {
    compose: {
      activity,
      activityNegate,
      unsubReady: parseTri(params.get('unsub_ready')),
      replied: parseTri(params.get('replied')),
      protectedFlag: parseTri(params.get('protected')),
      windowDays: parseWindow(params.get('window')),
      domain: params.get('domain')?.trim() || null,
      unsubIgnored: params.get('unsub_ignored') === 'true',
    },
    q: params.get('q') ?? '',
    sort: parseSort(params.get('sort')),
    direction: parseDirection(params.get('direction')),
  };
}

export function searchParamsFromRecord(
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      search.set(key, value);
    } else if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    }
  }
  return search;
}
