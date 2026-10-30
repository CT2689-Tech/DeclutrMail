#!/usr/bin/env node
// Baseline/diff and known-backlink workflows adapted from claude-seo.
// See docs/execution/marketing-system/claude-seo-NOTICE.txt for provenance.
import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'DeclutrMailSEO/1.0 (public website monitoring)';
const CATEGORIES = ['technical', 'content', 'aeo', 'backlinks', 'measurement'];
const SOURCES = ['search', 'ai', 'backlinks', 'conversion'];
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(REPO, 'docs/execution/marketing-system/seo-engine.config.json');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const day = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const clean = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const decode = (value) =>
  value.replace(/&(?:amp|quot|apos|lt|gt|#39|#(\d+)|#x([a-f\d]+));/gi, (s, dec, hex) => {
    const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : null;
    if (code !== null) return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : s;
    return { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>' }[
      s.toLowerCase()
    ];
  });

export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      [0, 10, 127].includes(a) ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Only ordinary IPv6 global unicast; exclude transition/documentation ranges.
  return (
    isIP(address) === 6 &&
    /^[23]/i.test(address) &&
    !/^200[12]:/i.test(address) &&
    !/^2001:db8:/i.test(address)
  );
}

export function safeUrl(value, hosts) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    isIP(url.hostname) ||
    !hosts.includes(url.hostname)
  ) {
    throw new Error(
      'URL must be HTTPS on an allowed hostname, without credentials, port, query or fragment',
    );
  }
  return url.href;
}

// Pin each connection to a checked DNS answer. Redirects are checked afresh.
// No proxy inheritance, cookies, authentication, paid APIs, or non-GET requests.
export async function fetchPublic(
  value,
  hosts,
  redirects = 0,
  resolve = lookup,
  requestGet = https.get,
) {
  const url = new URL(safeUrl(value, hosts));
  const addresses = await resolve(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
    throw new Error('DNS contains a non-public address');
  }
  const pinned = addresses.find((a) => a.family === 4) || addresses[0];
  const response = await new Promise((resolve, reject) => {
    const request = requestGet(
      url,
      {
        agent: false,
        lookup: (_host, options, callback) => {
          if (options?.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xml,text/plain' },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) res.destroy(new Error('Response exceeds 2 MiB limit'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            url: url.href,
          }),
        );
      },
    );
    const deadline = setTimeout(() => request.destroy(new Error('Public read timed out')), 15000);
    request.on('error', reject);
    request.on('close', () => clearTimeout(deadline));
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirects >= 3 || !response.headers.location)
      throw new Error('Redirect limit or missing location');
    return fetchPublic(
      new URL(response.headers.location, url).href,
      hosts,
      redirects + 1,
      resolve,
      requestGet,
    );
  }
  return response;
}

function attrs(tag) {
  const result = {};
  for (const match of tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

function absolute(value, base) {
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

export function robotsAllows(body, agent, pathname = '/') {
  const groups = [];
  let group = { agents: [], rules: [] };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const split = line.indexOf(':');
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();
    if (key === 'user-agent') {
      if (group.rules.length) {
        groups.push(group);
        group = { agents: [], rules: [] };
      }
      group.agents.push(value.toLowerCase());
    } else if (['allow', 'disallow'].includes(key) && group.agents.length && value) {
      group.rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  groups.push(group);
  const score = (g) =>
    Math.max(
      -1,
      ...g.agents.map((a) =>
        a === '*' ? 0 : agent.toLowerCase().includes(a) && a ? a.length : -1,
      ),
    );
  const longest = Math.max(-1, ...groups.map(score));
  const matching = groups
    .filter((g) => score(g) === longest && longest >= 0)
    .flatMap((g) => g.rules)
    .filter((r) => {
      const end = r.pattern.endsWith('$');
      const raw = end ? r.pattern.slice(0, -1) : r.pattern;
      const pattern = raw
        .split('*')
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      return new RegExp('^' + pattern + (end ? '$' : '')).test(pathname);
    })
    .sort(
      (a, b) =>
        b.pattern.replace(/\*/g, '').length - a.pattern.replace(/\*/g, '').length ||
        Number(b.allow) - Number(a.allow),
    );
  return matching[0]?.allow ?? true;
}

export function parsePage(body, url, headers = {}) {
  // Static response only. Missing tags/schema/links require rendered confirmation.
  const html = body.replace(/<!--[\s\S]*?-->/g, '');
  const visible = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const text = (s) => clean(decode(s.replace(/<[^>]*>/g, ' ')));
  const meta = {};
  for (const match of visible.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    const key = (a.name || a.property || '').toLowerCase();
    if (key) meta[key] = clean(a.content);
  }
  const links = [...visible.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const schema = [];
  let schemaErrors = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (attrs(match[1]).type?.toLowerCase() !== 'application/ld+json') continue;
    try {
      schema.push(JSON.parse(match[2]));
    } catch {
      schemaErrors += 1;
    }
  }
  const types = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    for (const type of [value['@type']].flat()) if (typeof type === 'string') types.add(type);
    for (const child of Object.values(value))
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) child.forEach(walk);
        else walk(child);
      }
  }
  schema.forEach(walk);
  const anchors = [...visible.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].map((m) => {
    const a = attrs(m[1]);
    return {
      url: a.href ? absolute(a.href, url) : null,
      rel: clean(a.rel).toLowerCase(),
      text: text(m[2]),
    };
  });
  return {
    title: text(visible.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || ''),
    description: meta.description || '',
    canonical: absolute(
      links.find((a) => a.rel?.toLowerCase().split(/\s+/).includes('canonical'))?.href || url,
      url,
    ),
    canonicalPresent: links.some((a) => a.rel?.toLowerCase().split(/\s+/).includes('canonical')),
    robots: clean(
      [meta.robots, meta.googlebot, headers['x-robots-tag']].filter(Boolean).join(','),
    ).toLowerCase(),
    h1: [...visible.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)].map((m) => text(m[1])),
    schemaTypes: [...types].sort(),
    schemaHash: schema.length ? hash(schema) : null,
    schemaErrors,
    openGraph: Object.fromEntries(Object.entries(meta).filter(([k]) => k.startsWith('og:'))),
    anchors,
  };
}

const actionFor = {
  http_error: 'Confirm the public response and repair routing or availability.',
  noindex:
    'Confirm that this public page should be indexed; inspect rendered and header directives.',
  canonical_offsite: 'Verify the intended canonical destination before changing it.',
  canonical_invalid: 'Confirm and repair the malformed canonical URL.',
  robots_blocked:
    'Review the current robots.txt rule for this public page; training and search policies are separate.',
  canonical_changed: 'Review this canonical change against the intended URL and migration.',
  canonical_presence_changed:
    'Confirm canonical tag presence in rendered HTML and verify the intended URL.',
  title_changed:
    'Review intent and approved wording; publishing requires Content and founder approval.',
  description_changed: 'Review the changed description against approved wording.',
  h1_changed: 'Review the changed headings against approved wording.',
  schema_changed: 'Validate the changed schema in rendered HTML; confirm current eligibility.',
  schema_invalid: 'Confirm and repair the invalid JSON-LD block.',
  backlink_missing:
    'Confirm in the built-in browser before classifying as lost; prepare reclamation draft if useful.',
};

function finding(url, rule, severity, before, after, category = 'technical') {
  return {
    id: hash([url, rule]).slice(0, 20),
    url,
    rule,
    severity,
    category,
    before,
    after,
    nextAction: actionFor[rule],
    evidence: 'anonymous_static_http',
    approvalRequired:
      category === 'content' ? ['Content sign-off', 'founder publication approval'] : [],
  };
}

export function comparePage(url, current, baseline, ownHosts) {
  const findings = [];
  if (current.status !== 200)
    return [finding(url, 'http_error', 'high', baseline?.status, current.status)];
  const p = current.page;
  if (/(?:^|[\s,:;])(noindex|none)(?:$|[\s,;])/.test(p.robots))
    findings.push(finding(url, 'noindex', 'high', null, p.robots));
  if (p.canonicalPresent && !p.canonical) {
    findings.push(finding(url, 'canonical_invalid', 'high', null, null));
  } else if (p.canonicalPresent && !ownHosts.includes(new URL(p.canonical).hostname)) {
    findings.push(finding(url, 'canonical_offsite', 'high', null, p.canonical));
  }
  if (p.schemaErrors) findings.push(finding(url, 'schema_invalid', 'medium', 0, p.schemaErrors));
  if (!baseline?.page || baseline.status !== 200) return findings;
  for (const [field, rule, category] of [
    ['canonical', 'canonical_changed', 'technical'],
    ['canonicalPresent', 'canonical_presence_changed', 'technical'],
    ['title', 'title_changed', 'content'],
    ['description', 'description_changed', 'content'],
    ['h1', 'h1_changed', 'content'],
    ['schemaHash', 'schema_changed', 'technical'],
  ]) {
    if (JSON.stringify(p[field]) !== JSON.stringify(baseline.page[field])) {
      findings.push(
        finding(
          url,
          rule,
          field === 'canonical' ? 'high' : 'medium',
          baseline.page[field],
          p[field],
          category,
        ),
      );
    }
  }
  return findings;
}

export function validateConfig(config) {
  if (
    config.version !== 1 ||
    !Array.isArray(config.hosts) ||
    !config.hosts.length ||
    config.hosts.some((h) => typeof h !== 'string' || !/^[a-z0-9.-]+$/.test(h) || isIP(h))
  ) {
    throw new Error('Invalid config hosts or version');
  }
  for (const name of ['pages', 'discovery', 'backlinks'])
    if (!Array.isArray(config[name])) throw new Error(`Missing ${name}`);
  for (const url of [...config.pages, ...config.discovery]) safeUrl(url, config.hosts);
  if (config.pages.length > 60 || config.discovery.length > 5 || config.backlinks.length > 20)
    throw new Error('Config exceeds request caps');
  for (const link of config.backlinks) {
    safeUrl(link.target, config.hosts);
    if (!link.allowedHosts?.length) throw new Error('Backlink requires explicit allowedHosts');
    safeUrl(link.source, link.allowedHosts);
  }
  return config;
}

function checkDate(value, now) {
  if (!day(value) || value > now.slice(0, 10))
    throw new Error('Evidence requires a valid non-future date');
}

export function validateEvidence(doc, now) {
  if (doc.version !== 1 || !SOURCES.includes(doc.kind) || !Array.isArray(doc.observations))
    throw new Error('Invalid evidence envelope');
  if (!['verified_export', 'verified_browser', 'verified_api'].includes(doc.method))
    throw new Error('Evidence method must describe an actual verified read');
  checkDate(doc.observedAt, now);
  if (typeof doc.source !== 'string' || !doc.source.trim())
    throw new Error('Evidence source required');
  if (doc.periodStart || doc.periodEnd) {
    checkDate(doc.periodStart, now);
    checkDate(doc.periodEnd, now);
    if (doc.periodStart > doc.periodEnd || doc.periodEnd > doc.observedAt)
      throw new Error('Invalid measurement period');
  }
  if (!doc.observations.length || doc.observations.length > 500)
    throw new Error('Evidence requires 1–500 observations');
  for (const row of doc.observations) {
    if (doc.kind === 'search') {
      if (!doc.periodStart || !doc.periodEnd || !['web', 'google_ai'].includes(row.surface))
        throw new Error('Search requires a period and distinct surface');
      for (const key of row.surface === 'web' ? ['clicks', 'impressions'] : ['impressions']) {
        if (!Number.isInteger(row[key]) || row[key] < 0) throw new Error(`Invalid ${key}`);
      }
      if (row.surface === 'web' && row.clicks > row.impressions)
        throw new Error('Clicks exceed impressions');
      if (row.page && new URL(row.page).protocol !== 'https:')
        throw new Error('Invalid search page');
    } else if (doc.kind === 'ai') {
      if (
        !row.platform ||
        !row.prompt ||
        !row.locale ||
        !row.mode ||
        !row.evidenceRef ||
        !Number.isInteger(row.runs) ||
        row.runs < 1
      )
        throw new Error(
          'AI evidence requires platform, prompt, locale, mode, evidenceRef and sample size',
        );
      for (const key of ['mentions', 'citations', 'recommendations'])
        if (!Number.isInteger(row[key]) || row[key] < 0 || row[key] > row.runs)
          throw new Error(`Invalid AI ${key}`);
    } else if (doc.kind === 'conversion') {
      if (
        !doc.periodStart ||
        !doc.periodEnd ||
        row.population !== 'qualified_production_excluding_internal_test_bot' ||
        !row.definition ||
        !row.evidenceRef
      )
        throw new Error(
          'Conversion requires closed period, population, definition and evidenceRef',
        );
      if (
        ![
          'gmail_connections',
          'previewed_first_cleanup',
          'verified_purchases',
          'retained_paid_users',
        ].includes(row.metric) ||
        !Number.isInteger(row.count) ||
        row.count < 0
      )
        throw new Error('Invalid conversion metric');
    } else {
      if (!row.sourceUrl || !row.targetUrl || !row.evidenceRef)
        throw new Error('Backlinks require source, target and evidenceRef');
      new URL(row.sourceUrl);
      new URL(row.targetUrl);
    }
  }
  return doc;
}

export function sourceCoverage(evidence, now) {
  return Object.fromEntries(
    SOURCES.map((kind) => {
      const records = evidence.filter((e) => e.kind === kind);
      const latest = records.sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
      return [
        kind,
        latest
          ? {
              status:
                Date.parse(now) - Date.parse(latest.observedAt) > 7 * 86400000
                  ? 'stale'
                  : 'available',
              observedAt: latest.observedAt,
              source: latest.source,
              method: latest.method,
              periodStart: latest.periodStart,
              periodEnd: latest.periodEnd,
            }
          : { status: 'unavailable', reason: 'No verified evidence imported; not a measured zero' },
      ];
    }),
  );
}

export function mergeBacklog(previous, findings, observedAt) {
  const result = structuredClone(previous);
  for (const item of findings) {
    const existing = result.find((task) => task.id === item.id);
    if (existing) {
      Object.assign(existing, item, { lastSeen: observedAt });
      if (existing.status === 'resolved') existing.status = 'open';
    } else
      result.push({
        ...item,
        status: 'open',
        owner: 'growth automation',
        firstSeen: observedAt,
        lastSeen: observedAt,
        outcome: 'unmeasured',
      });
  }
  // Absence from a later crawl never resolves a task: failed/partial reads are common.
  return result;
}

export function searchOpportunities(evidence, now = new Date().toISOString()) {
  // Evidence selects pages for investigation, never automatically rewrites copy.
  const docs = evidence
    .filter((e) => e.kind === 'search')
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  if (!docs.length) return [];
  const latest = docs[0];
  if (Date.parse(now) - Date.parse(latest.observedAt) > 7 * 86400000) return [];
  return latest.observations
    .filter(
      (row) =>
        row.surface === 'web' &&
        row.page &&
        row.query &&
        row.impressions >= 100 &&
        Number.isFinite(row.position) &&
        row.position >= 8 &&
        row.position <= 20,
    )
    .map((row) => ({
      id: hash([row.page, 'search_opportunity', row.query]).slice(0, 20),
      url: row.page,
      rule: 'search_opportunity',
      category: 'content',
      severity: 'medium',
      nextAction:
        'Inspect current search intent and page usefulness; prepare a sourced draft only if a concrete gap is verified.',
      evidenceRef: latest.source,
      observedPeriod: [latest.periodStart, latest.periodEnd],
      rationale: `Query ${row.query}: ${row.impressions} impressions, ${row.clicks} clicks, average position ${row.position}. Investigation candidate, not a forecast.`,
      approvalRequired: ['Content sign-off', 'founder publication approval'],
    }));
}

function weekKey(now) {
  const d = new Date(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(now)) + 'T12:00:00Z',
  );
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function weeklyReview(state, now) {
  const week = weekKey(now);
  if (state.lastWeeklyReview === week) return null;
  const rank = { high: 0, medium: 1, low: 2 };
  const tasks = state.backlog
    .filter((t) => !['resolved', 'dismissed'].includes(t.status))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.firstSeen.localeCompare(b.firstSeen));
  return {
    week,
    observedAt: now,
    topTasks: tasks.slice(0, 3).map((t) => t.id),
    coverage: sourceCoverage(state.evidence, now),
    decision: tasks.length ? 'Review supported tasks' : 'HOLD: no supported change',
    growthEffect: 'unmeasured',
    rules: [
      'Google web and AI impressions overlap; never sum them.',
      'Compare non-overlapping closed windows; small changes do not establish causation.',
      'AI mentions, citations and recommendations are separate sample rates, not traffic or conversions.',
      'Publishing and outreach require specific approval; Content sign-off also applies to live copy.',
    ],
  };
}

export async function collect(config, state, now, read = fetchPublic, pause = true) {
  validateConfig(config);
  const pages = [...new Set(config.pages)];
  const observations = {};
  const coverage = [];
  const findings = [];
  const robots = [];
  let requests = 0;
  async function get(url, hosts) {
    if (pause && requests) await new Promise((resolve) => setTimeout(resolve, 1000));
    requests++;
    try {
      return { ...(await read(url, hosts)), observedAt: now };
    } catch {
      return {
        status: null,
        observedAt: now,
        error: 'Public read unavailable (network, policy, limit or response error)',
      };
    }
  }
  for (const url of config.discovery) {
    const response = await get(url, config.hosts);
    coverage.push({
      url,
      status: response.error || response.status !== 200 ? 'unavailable' : 'available',
      httpStatus: response.status,
      observedAt: now,
    });
    if (response.status === 200 && url.endsWith('/robots.txt')) {
      for (const page of pages.filter((p) => new URL(p).origin === new URL(url).origin)) {
        for (const agent of ['Googlebot', 'OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot']) {
          const allowed = robotsAllows(response.body, agent, new URL(page).pathname);
          robots.push({ page, agent, allowed, observedAt: now });
          if (!allowed) {
            const task = finding(page, 'robots_blocked', 'high', null, agent);
            task.id = hash([page, task.rule, agent]).slice(0, 20);
            findings.push(task);
          }
        }
      }
    }
    if (response.status === 200 && url.endsWith('/sitemap.xml')) {
      for (const m of response.body.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)) {
        try {
          const candidate = safeUrl(decode(m[1].trim()), config.hosts);
          if (!candidate.endsWith('.xml') && !pages.includes(candidate) && pages.length < 60)
            pages.push(candidate);
        } catch {
          /* Out-of-scope sitemap URLs are never fetched. */
        }
      }
    }
  }
  async function pageReads() {
    for (const url of pages) {
      const response = await get(url, config.hosts);
      if (response.error) {
        coverage.push({ url, status: 'unavailable', reason: response.error, observedAt: now });
        continue;
      }
      const page =
        response.status === 200
          ? parsePage(response.body, response.url || url, response.headers)
          : null;
      observations[url] = {
        status: response.status,
        finalUrl: response.url || url,
        observedAt: now,
        page,
      };
      findings.push(...comparePage(url, observations[url], state.baselines[url], config.hosts));
    }
  }
  await pageReads();
  const backlinks = [];
  for (const link of config.backlinks) {
    const response = await get(link.source, [...new Set([...link.allowedHosts, ...config.hosts])]);
    let status = 'unavailable';
    let matched = null;
    if (!response.error && response.status === 200) {
      const page = parsePage(response.body, response.url || link.source, response.headers);
      matched = page.anchors.find((a) => a.url?.replace(/#.*$/, '') === link.target);
      status = matched ? 'verified_static' : 'needs_rendered_confirmation';
    } else if (response.status === 404 || response.status === 410) status = 'source_unavailable';
    backlinks.push({ ...link, status, observedAt: now, anchor: matched?.text, rel: matched?.rel });
    if (status === 'needs_rendered_confirmation' || status === 'source_unavailable') {
      const task = finding(link.source, 'backlink_missing', 'medium', null, status, 'backlinks');
      task.approvalRequired = ['founder approval of exact outreach recipients and copy'];
      findings.push(task);
    }
  }
  return {
    observedAt: now,
    observations,
    coverage,
    robots,
    backlinks,
    findings,
    requests,
    limits: [
      'Static HTML only; missing schema or links are not proof of absence.',
      'HTTP accessibility does not prove indexing, crawler access, rich results or AI citations.',
      'Core Web Vitals and conversion outcomes require separately verified evidence.',
    ],
  };
}

const emptyState = () => ({
  version: 1,
  baselines: {},
  backlog: [],
  evidence: [],
  lastWeeklyReview: null,
});

async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const resolved = await realpath(directory);
  for (let parent = resolved; ; parent = path.dirname(parent)) {
    if (existsSync(path.join(parent, '.git')))
      throw new Error('State must be outside every Git checkout');
    if (path.dirname(parent) === parent) break;
  }
  return resolved;
}

async function atomicJson(filename, value) {
  const temp = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temp, filename);
}

const md = (s) => clean(s).replace(/[|`<>]/g, ' ');
function report(state, run, review, now) {
  const collection = run || state.latestCollection;
  const lines = [
    '# DeclutrMail SEO engine',
    '',
    `Observed: ${now}`,
    '',
    'Additional tool/subscription/campaign spend: $0. Public GET reads only.',
    'Publishing and outreach: approval required. No publishing or sending command exists.',
    '',
    '## Coverage',
    '',
    '| Source | Status | Last observation |',
    '| --- | --- | --- |',
  ];
  for (const [source, data] of Object.entries(sourceCoverage(state.evidence, now)))
    lines.push(`| ${source} | ${data.status} | ${data.observedAt || 'unavailable'} |`);
  if (collection)
    lines.push(
      '',
      `Latest public collection: ${collection.observedAt}.`,
      `Public pages read: ${collection.pageCount ?? Object.keys(collection.observations).length}; unavailable discovery/page reads: ${collection.unavailableCount ?? collection.coverage.filter((c) => c.status === 'unavailable').length}.`,
      `Known backlinks checked: ${collection.backlinkCount ?? collection.backlinks.length}.`,
      '',
      ...collection.limits.map((s) => `- ${s}`),
    );
  lines.push(
    '',
    '## Review queue',
    '',
    '| ID | Category | Status | Priority | Next action |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const task of state.backlog.filter((t) => !['resolved', 'dismissed'].includes(t.status))) {
    lines.push(
      `| ${task.id} | ${task.category} | ${task.status} | ${task.severity} | ${md(task.nextAction)} |`,
    );
  }
  lines.push(
    '',
    '## Weekly decision',
    '',
    review
      ? `${review.week}: ${review.decision}`
      : 'Weekly decision already recorded; daily observations retained.',
    '',
    'Growth effect: unmeasured. Ordinary and Google AI impressions overlap; never sum them.',
    'Baseline means observed snapshot, not known-good approval. Missing evidence is unavailable, not zero.',
    '',
  );
  return lines.join('\n');
}

export async function execute(command, options, dependencies = {}) {
  const now = dependencies.now || new Date().toISOString();
  if (!options.stateDir) throw new Error('--state-dir is required (private directory outside Git)');
  const directory = await privateDirectory(options.stateDir);
  const lockPath = path.join(directory, 'run.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: now }));
    const statePath = path.join(directory, 'state.json');
    const state = existsSync(statePath)
      ? JSON.parse(await readFile(statePath, 'utf8'))
      : emptyState();
    if (state.version !== 1) throw new Error('Unsupported state version');
    let run = null;
    let review = null;
    if (command === 'run') {
      const config = JSON.parse(await readFile(options.config || CONFIG, 'utf8'));
      run = await collect(config, state, now, dependencies.read, dependencies.pause ?? true);
      for (const [url, observation] of Object.entries(run.observations)) {
        if (!state.baselines[url] && observation.status === 200) state.baselines[url] = observation;
      }
      state.latestObservations = run.observations;
      state.latestCollection = {
        observedAt: now,
        pageCount: Object.keys(run.observations).length,
        unavailableCount: run.coverage.filter((c) => c.status === 'unavailable').length,
        backlinkCount: run.backlinks.length,
        limits: run.limits,
      };
      state.backlog = mergeBacklog(
        state.backlog,
        [...run.findings, ...searchOpportunities(state.evidence, now)],
        now,
      );
      review = weeklyReview(state, now);
      if (review) {
        state.lastWeeklyReview = review.week;
        state.latestWeeklyReview = review;
      }
      state.lastRun = now;
    } else if (command === 'review') {
      state.backlog = mergeBacklog(state.backlog, searchOpportunities(state.evidence, now), now);
      review = weeklyReview({ ...state, lastWeeklyReview: null }, now);
      state.lastWeeklyReview = review.week;
      state.latestWeeklyReview = review;
    } else if (command === 'accept-baseline') {
      const observation = state.latestObservations?.[options.url];
      const config = validateConfig(JSON.parse(await readFile(options.config || CONFIG, 'utf8')));
      if (
        !options.evidenceRef ||
        !observation ||
        observation.status !== 200 ||
        Date.parse(now) - Date.parse(observation.observedAt) > 86400000 ||
        comparePage(options.url, observation, null, config.hosts).length
      ) {
        throw new Error(
          'Accepting a baseline requires review evidence and a healthy observation from the last 24 hours',
        );
      }
      state.baselineHistory ||= [];
      state.baselineHistory.push({
        url: options.url,
        previous: state.baselines[options.url],
        acceptedAt: now,
        evidenceRef: options.evidenceRef,
      });
      state.baselines[options.url] = observation;
    } else if (command === 'import') {
      const doc = validateEvidence(JSON.parse(await readFile(options.input, 'utf8')), now);
      const id = hash(doc);
      if (!state.evidence.some((e) => e.id === id))
        state.evidence.push({ ...doc, id, importedAt: now });
    } else if (command === 'propose') {
      const doc = JSON.parse(await readFile(options.input, 'utf8'));
      if (
        !CATEGORIES.includes(doc.category) ||
        !['high', 'medium', 'low'].includes(doc.severity) ||
        !doc.url ||
        !doc.nextAction ||
        !doc.evidenceRef ||
        !doc.rationale
      )
        throw new Error(
          'Proposal requires category, severity, url, nextAction, rationale and evidenceRef',
        );
      safeUrl(doc.url, [new URL(doc.url).hostname]);
      const item = {
        id: hash([doc.url, doc.category, doc.nextAction]).slice(0, 20),
        category: doc.category,
        severity: doc.severity,
        url: doc.url,
        nextAction: doc.nextAction,
        rationale: doc.rationale,
        evidenceRef: doc.evidenceRef,
        rule: 'reviewed_proposal',
        approvalRequired: [
          'founder approval before publication or outreach',
          'Content sign-off for live words',
        ],
      };
      state.backlog = mergeBacklog(state.backlog, [item], now);
    } else if (command === 'task') {
      const task = state.backlog.find((t) => t.id === options.id);
      if (
        !task ||
        !['open', 'awaiting_approval', 'in_progress', 'resolved', 'dismissed'].includes(
          options.status,
        ) ||
        !options.evidenceRef
      )
        throw new Error('Task update requires existing id, valid status and --evidence-ref');
      task.status = options.status;
      task.statusEvidence = options.evidenceRef;
      task.updatedAt = now;
    } else if (command !== 'report') throw new Error('Unknown command');
    const runId = `${now.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    await atomicJson(path.join(directory, `${runId}.json`), {
      command,
      observedAt: now,
      run,
      review,
    });
    await atomicJson(statePath, state);
    await writeFile(
      path.join(directory, 'latest.md'),
      report(state, run, review || state.latestWeeklyReview, now),
      { mode: 0o600 },
    );
    return {
      directory,
      runId,
      pages: run ? Object.keys(run.observations).length : null,
      findings: run?.findings.length,
      weeklyReview: review?.week || null,
      openTasks: state.backlog.filter((t) => !['resolved', 'dismissed'].includes(t.status)).length,
    };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const keys = {
    '--state-dir': 'stateDir',
    '--config': 'config',
    '--input': 'input',
    '--id': 'id',
    '--status': 'status',
    '--url': 'url',
    '--evidence-ref': 'evidenceRef',
  };
  try {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!keys[args[i]] || !args[i + 1]) throw new Error('Unknown or incomplete option');
      options[keys[args[i]]] = args[i + 1];
    }
    console.log(JSON.stringify(await execute(command, options), null, 2));
  } catch (error) {
    console.error(
      error.code === 'EEXIST'
        ? 'Another run owns the state lock. Inspect it before retrying.'
        : error.message,
    );
    process.exitCode = 1;
  }
}
