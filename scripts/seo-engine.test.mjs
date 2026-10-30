import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  collect,
  comparePage,
  execute,
  fetchPublic,
  mergeBacklog,
  parsePage,
  publicAddress,
  robotsAllows,
  safeUrl,
  searchOpportunities,
  sourceCoverage,
  validateConfig,
  validateEvidence,
  weeklyReview,
} from './seo-engine.mjs';

const NOW = '2026-10-30T20:00:00.000Z';
const URL = 'https://declutrmail.com/';
const CONFIG = {
  version: 1,
  hosts: ['declutrmail.com'],
  pages: [URL],
  discovery: [],
  backlinks: [],
};
const html = (title = 'Gmail cleanup') =>
  `<html><head><title>${title}</title><link rel="canonical" href="${URL}"><meta name="description" content="Preview &amp; undo"></head><body><h1>Gmail cleanup</h1></body></html>`;
const response = (body = html()) => ({ status: 200, body, headers: {}, url: URL });
const state = () => ({
  version: 1,
  baselines: {},
  backlog: [],
  evidence: [],
  lastWeeklyReview: null,
});
const observation = (body) => ({ status: 200, page: parsePage(body, URL) });

test('public-only connection policy rejects private, mapped, reserved and ambiguous URLs', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '100.64.1.1',
    '192.168.1.1',
    '172.16.2.1',
    '192.0.2.1',
    '198.18.0.1',
    '203.0.113.1',
    '::1',
    '::ffff:8.8.8.8',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
  ])
    assert.equal(publicAddress(ip), false, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
    assert.equal(publicAddress(ip), true, ip);
  for (const url of [
    'http://declutrmail.com/',
    'https://declutrmail.com.evil.test/',
    'https://a:b@declutrmail.com/',
    'https://declutrmail.com:444/',
    'https://127.0.0.1/',
    'https://declutrmail.com/?token=secret',
    'https://declutrmail.com/#secret',
  ]) {
    assert.throws(() => safeUrl(url, CONFIG.hosts));
  }
});

test('static extraction handles graph schema, entities, case and scripted false positives', () => {
  const p = parsePage(
    `${html()}<!-- <meta name="robots" content="noindex"> --><SCRIPT>const s='<meta name="robots" content="noindex">'</SCRIPT><script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":["WebSite","Thing"]}]}</script><a href="/pricing" REL="nofollow">Pricing &amp; plans</a>`,
    URL,
  );
  assert.deepEqual(p.schemaTypes, ['Organization', 'Thing', 'WebSite']);
  assert.equal(p.description, 'Preview & undo');
  assert.equal(p.robots, '');
  assert.equal(p.anchors[0].url, 'https://declutrmail.com/pricing');
  assert.equal(p.anchors[0].rel, 'nofollow');
});

test('HTTP reads pin DNS and reject unapproved redirects before another request', async () => {
  let requests = 0;
  const resolver = async () => [{ address: '1.1.1.1', family: 4 }];
  const requestGet = (url, options, callback) => {
    requests++;
    assert.equal(options.agent, false);
    assert.equal(options.headers.Authorization, undefined);
    options.lookup(url.hostname, {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, '1.1.1.1');
      assert.equal(family, 4);
    });
    const request = new EventEmitter();
    request.destroy = (error) => {
      request.emit('error', error);
      request.emit('close');
    };
    setImmediate(() => {
      const res = new EventEmitter();
      res.statusCode = 302;
      res.headers = { location: 'https://unapproved.example/' };
      callback(res);
      res.emit('end');
      request.emit('close');
    });
    return request;
  };
  await assert.rejects(fetchPublic(URL, CONFIG.hosts, 0, resolver, requestGet), /allowed hostname/);
  assert.equal(requests, 1);
  await assert.rejects(
    fetchPublic(
      URL,
      CONFIG.hosts,
      0,
      async () => [{ address: '169.254.169.254', family: 4 }],
      requestGet,
    ),
    /non-public/,
  );
  assert.equal(requests, 1);
});

test('robots rules respect agent groups, most specific path and allow ties', () => {
  const robots =
    'User-agent: *\nDisallow: /\nAllow: /public\nUser-agent: OAI-SearchBot\nDisallow: /private\nAllow: /private/open$';
  assert.equal(robotsAllows(robots, 'Googlebot', '/'), false);
  assert.equal(robotsAllows(robots, 'Googlebot', '/public/guide'), true);
  assert.equal(robotsAllows(robots, 'OAI-SearchBot', '/'), true);
  assert.equal(robotsAllows(robots, 'OAI-SearchBot', '/private'), false);
  assert.equal(robotsAllows(robots, 'OAI-SearchBot', '/private/open'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nAllow: /', 'Googlebot'), true);
});

test('baseline changes flag concrete regressions without treating static absence as schema proof', () => {
  const baseline = observation(html());
  assert.deepEqual(comparePage(URL, observation(html()), baseline, CONFIG.hosts), []);
  const changed = observation(
    html('Changed') +
      '<meta name="robots" content="noindex"><script type="application/ld+json">{bad}</script>',
  );
  const findings = comparePage(URL, changed, baseline, CONFIG.hosts);
  assert.deepEqual(findings.map((f) => f.rule).sort(), [
    'noindex',
    'schema_invalid',
    'title_changed',
  ]);
  assert.equal(findings.find((f) => f.rule === 'title_changed').approvalRequired.length, 2);
  assert.equal(comparePage(URL, { status: 503 }, baseline, CONFIG.hosts)[0].rule, 'http_error');
  assert.equal(
    comparePage(URL, observation(html().replace(/<link[^>]+>/, '')), baseline, CONFIG.hosts)[0]
      .rule,
    'canonical_presence_changed',
  );
});

test('repeat findings update the same task and retain approval status; failed reads do not close tasks', () => {
  const item = comparePage(URL, observation(html('Changed')), observation(html()), CONFIG.hosts)[0];
  const first = mergeBacklog([], [item], NOW);
  first[0].status = 'awaiting_approval';
  const second = mergeBacklog(first, [item], '2026-10-31T20:00:00Z');
  assert.equal(second.length, 1);
  assert.equal(second[0].status, 'awaiting_approval');
  assert.equal(second[0].firstSeen, NOW);
  assert.deepEqual(mergeBacklog(second, [], NOW), second);
});

test('discovery is capped and cannot add offsite, credential or query URLs', async () => {
  const cfg = { ...CONFIG, discovery: ['https://declutrmail.com/sitemap.xml'] };
  const calls = [];
  const locs = [
    'https://evil.test/',
    'https://declutrmail.com/?token=x',
    ...Array.from({ length: 80 }, (_, i) => `https://declutrmail.com/p${i}`),
  ];
  const run = await collect(
    cfg,
    state(),
    NOW,
    async (url) => {
      calls.push(url);
      return url.endsWith('sitemap.xml')
        ? response(locs.map((u) => `<loc>${u}</loc>`).join(''))
        : response();
    },
    false,
  );
  assert.equal(Object.keys(run.observations).length, 60);
  assert.equal(calls.length, 61);
  assert.equal(
    calls.some((u) => u.includes('evil') || u.includes('?')),
    false,
  );
});

test('unavailable reads remain explicit and do not create a baseline or an invented zero', async () => {
  const run = await collect(
    CONFIG,
    state(),
    NOW,
    async () => {
      throw new Error('sensitive provider response');
    },
    false,
  );
  assert.equal(Object.keys(run.observations).length, 0);
  assert.equal(run.coverage[0].status, 'unavailable');
  assert.equal(JSON.stringify(run).includes('sensitive'), false);
  assert.equal(sourceCoverage([], NOW).search.status, 'unavailable');
});

test('known backlink requires explicit source scope and missing static link needs browser confirmation', async () => {
  const link = {
    source: 'https://editor.example/resource',
    target: URL,
    allowedHosts: ['editor.example'],
  };
  assert.throws(() => validateConfig({ ...CONFIG, backlinks: [{ ...link, allowedHosts: [] }] }));
  const run = await collect(
    { ...CONFIG, backlinks: [link] },
    state(),
    NOW,
    async () => response(),
    false,
  );
  assert.equal(run.backlinks[0].status, 'needs_rendered_confirmation');
  assert.match(run.findings[0].approvalRequired[0], /outreach/);
  const verified = await collect(
    { ...CONFIG, backlinks: [link] },
    state(),
    NOW,
    async () => response(`<a rel="sponsored" href="${URL}">DeclutrMail</a>`),
    false,
  );
  assert.equal(verified.backlinks[0].status, 'verified_static');
  assert.equal(verified.backlinks[0].rel, 'sponsored');
});

test('search and AI import preserve separate surfaces and validate dates, counts and sample denominators', () => {
  const base = {
    version: 1,
    kind: 'search',
    observedAt: '2026-10-30',
    source: 'native-export.json',
    method: 'verified_export',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-28',
    observations: [
      { surface: 'web', clicks: 14, impressions: 1103 },
      { surface: 'google_ai', impressions: 64 },
    ],
  };
  assert.deepEqual(validateEvidence(base, NOW), base);
  assert.throws(() => validateEvidence({ ...base, periodEnd: '2026-11-01' }, NOW));
  assert.throws(() => validateEvidence({ ...base, observedAt: '2026-02-31' }, NOW));
  assert.throws(() =>
    validateEvidence(
      { ...base, observations: [{ surface: 'web', clicks: 20, impressions: 10 }] },
      NOW,
    ),
  );
  const ai = {
    version: 1,
    kind: 'ai',
    observedAt: '2026-10-30',
    source: 'browser-sample.json',
    method: 'verified_browser',
    observations: [
      {
        platform: 'example',
        prompt: 'Gmail cleanup?',
        locale: 'en-US',
        mode: 'web-search',
        evidenceRef: 'sample.txt',
        runs: 5,
        mentions: 2,
        citations: 1,
        recommendations: 0,
      },
    ],
  };
  assert.equal(validateEvidence(ai, NOW).observations[0].runs, 5);
  assert.throws(() =>
    validateEvidence({ ...ai, observations: [{ ...ai.observations[0], citations: 6 }] }, NOW),
  );
  assert.equal(sourceCoverage([{ ...base, observedAt: '2026-10-01' }], NOW).search.status, 'stale');
});

test('conversion imports require aggregate qualified production definitions and evidence', () => {
  const doc = {
    version: 1,
    kind: 'conversion',
    observedAt: '2026-10-30',
    source: 'aggregate.json',
    method: 'verified_api',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-28',
    observations: [
      {
        metric: 'gmail_connections',
        count: 0,
        population: 'qualified_production_excluding_internal_test_bot',
        definition: 'Distinct qualified connections',
        evidenceRef: 'aggregate.sql',
      },
    ],
  };
  assert.equal(validateEvidence(doc, NOW).observations[0].count, 0);
  assert.throws(() =>
    validateEvidence(
      { ...doc, observations: [{ ...doc.observations[0], population: 'all_users' }] },
      NOW,
    ),
  );
});

test('only evidenced page/query candidates become research tasks', () => {
  const doc = {
    kind: 'search',
    observedAt: '2026-10-30',
    source: 'export',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-28',
    observations: [
      {
        surface: 'web',
        page: URL,
        query: 'Gmail cleanup',
        clicks: 1,
        impressions: 120,
        position: 12,
      },
      { surface: 'google_ai', page: URL, impressions: 500 },
      { surface: 'web', page: URL, query: 'tiny', impressions: 3, position: 10 },
    ],
  };
  const tasks = searchOpportunities([doc], NOW);
  assert.equal(tasks.length, 1);
  assert.match(tasks[0].nextAction, /Inspect/);
  assert.equal(tasks[0].approvalRequired.length, 2);
  assert.equal(searchOpportunities([{ ...doc, observedAt: '2026-10-01' }], NOW).length, 0);
});

test('weekly reviews run once per Pacific calendar week and do not claim growth', () => {
  const s = state();
  const first = weeklyReview(s, NOW);
  assert.equal(first.week, '2026-10-26');
  assert.equal(first.growthEffect, 'unmeasured');
  s.lastWeeklyReview = first.week;
  assert.equal(weeklyReview(s, NOW), null);
  assert.equal(weeklyReview(s, '2026-11-02T18:00:00Z').week, '2026-11-02');
});

test('persistent runs preserve baselines, deduplicate evidence and reject concurrent writers and publish commands', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'declutrmail-seo-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = path.join(dir, 'config.json');
  await writeFile(config, JSON.stringify(CONFIG));
  const options = { stateDir: path.join(dir, 'private'), config };
  const deps = { now: NOW, pause: false, read: async () => response() };
  await execute('run', options, deps);
  const changed = { ...deps, read: async () => response(html('New title')) };
  await execute('run', options, changed);
  await execute('run', options, changed);
  let s = JSON.parse(await readFile(path.join(options.stateDir, 'state.json'), 'utf8'));
  assert.equal(s.baselines[URL].page.title, 'Gmail cleanup');
  assert.equal(s.backlog.length, 1);
  const evidence = path.join(dir, 'evidence.json');
  await writeFile(
    evidence,
    JSON.stringify({
      version: 1,
      kind: 'search',
      observedAt: '2026-10-30',
      source: 'export',
      method: 'verified_export',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-28',
      observations: [{ surface: 'web', clicks: 0, impressions: 0 }],
    }),
  );
  await execute('import', { ...options, input: evidence }, deps);
  await execute('import', { ...options, input: evidence }, deps);
  s = JSON.parse(await readFile(path.join(options.stateDir, 'state.json'), 'utf8'));
  assert.equal(s.evidence.length, 1);
  await assert.rejects(
    execute('accept-baseline', { ...options, url: URL }, deps),
    /review evidence/,
  );
  await execute('accept-baseline', { ...options, url: URL, evidenceRef: 'review.md' }, deps);
  s = JSON.parse(await readFile(path.join(options.stateDir, 'state.json'), 'utf8'));
  assert.equal(s.baselines[URL].page.title, 'New title');
  assert.equal(s.baselineHistory.length, 1);
  await execute('review', options, deps);
  await assert.rejects(execute('publish', options, deps), /Unknown command/);
  await writeFile(path.join(options.stateDir, 'run.lock'), 'another owner');
  await assert.rejects(execute('run', options, deps), { code: 'EEXIST' });
  assert.equal(await readFile(path.join(options.stateDir, 'run.lock'), 'utf8'), 'another owner');
});
