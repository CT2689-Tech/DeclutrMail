import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateCleanupPolicy, POLICY_PATH } from './artifact-cleanup-policy.mjs';
import {
  servingRevisions,
  retentionTag,
  rollbackDigests,
  releaseSlots,
  writeOrder,
  managedTags,
  jobImages,
  pinProductionImages,
  rollbackTraffic,
  IMAGE,
  PINNED,
  SOURCES,
  NAMESPACES,
  JOB_SLOTS,
  ROLLBACK_SLOTS,
  ROUTE_SLOTS,
} from './pin-production-images.mjs';

const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
const packageName =
  'projects/declutrmail-ai-prod/locations/us-central1/repositories/declutrmail/packages/api';
const sha = (n) => `sha256:${n.toString(16).padStart(64, '0')}`;
const PROBE = sha(9000);
const revision = (name, n, day) => ({
  metadata: { name, creationTimestamp: new Date(Date.UTC(2026, 8, day)).toISOString() },
  status: { imageDigest: `${IMAGE}@${sha(n)}` },
});

test('retention protects every traffic destination and tagged rollback route, primary first', () => {
  assert.deepEqual(
    servingRevisions({
      status: {
        traffic: [
          { revisionName: 'declutrmail-api-002-b', percent: 10 },
          { revisionName: 'declutrmail-api-001-a', percent: 90 },
          { revisionName: 'declutrmail-api-003-c', tag: 'rollback' },
          { revisionName: 'declutrmail-api-004-d', percent: 0, tag: 'verify-abc' },
        ],
      },
    }).map((s) => [s.revision, s.served]),
    [
      ['declutrmail-api-001-a', true],
      ['declutrmail-api-002-b', true],
      ['declutrmail-api-003-c', true],
      ['declutrmail-api-004-d', false],
    ],
  );
  for (const traffic of [
    [],
    [{ percent: 100 }],
    [{ revisionName: 'declutrmail-api-001-a', percent: 50 }],
  ])
    assert.throws(() => servingRevisions({ status: { traffic } }));
});

test('worker pools are read from their instance split', () => {
  assert.deepEqual(
    servingRevisions(
      {
        status: {
          instanceSplits: [{ revisionName: 'declutrmail-worker-pool-001-a', percent: 100 }],
        },
      },
      'workerPool',
    ).map((s) => s.revision),
    ['declutrmail-worker-pool-001-a'],
  );
  assert.throws(() => servingRevisions({ status: { traffic: [] } }, 'workerPool'));
});

test('new deployments and traffic reordering never reuse a previous release retention tag', () => {
  const old = retentionTag('declutrmail-api-001-a');
  assert.notEqual(old, retentionTag('declutrmail-api-002-b'));
  assert.equal(old, retentionTag('declutrmail-api-001-a'));
  assert.throws(() => retentionTag('../unexpected'));
});

test('rollbacks are the five newest distinct earlier images, never newer failed candidates', () => {
  const revisions = [
    ...Array.from({ length: 9 }, (_, i) => revision(`declutrmail-api-00${i}`, i, i + 1)),
    revision('declutrmail-api-redeploy', 7, 9), // same image redeployed: one slot, not two
    revision('declutrmail-api-candidate', 99, 20), // newer than serving: not a rollback
    {
      metadata: { name: 'declutrmail-api-foreign', creationTimestamp: '2026-09-05T00:00:00Z' },
      status: { imageDigest: 'gcr.io/x/y@sha256:1' },
    },
  ];
  assert.deepEqual(
    rollbackDigests(revisions, 'declutrmail-api-008', [sha(8)]),
    [7, 6, 5, 4, 3].map(sha),
  );
  assert.throws(() => rollbackDigests(revisions, 'declutrmail-api-missing', []), /history/);
});

test('rollbacks prefer images that served traffic and fill from unserved ones only if short', () => {
  const revisions = Array.from({ length: 9 }, (_, i) =>
    revision(`declutrmail-api-00${i}`, i, i + 1),
  );
  // 007 and 005 failed their smoke and never served.
  const served = new Set(
    ['000', '001', '002', '003', '004', '006'].map((n) => `declutrmail-api-${n}`),
  );
  assert.deepEqual(
    rollbackDigests(revisions, 'declutrmail-api-008', [sha(8)], served),
    [6, 4, 3, 2, 1].map(sha),
  );
  assert.deepEqual(
    rollbackDigests(revisions, 'declutrmail-api-008', [sha(8)], new Set(['declutrmail-api-002'])),
    [2, 7, 6, 5, 4].map(sha),
  );
});

test('unused slots point at the primary image so no slot can retain an old build', () => {
  const slots = releaseSlots('api', [sha(1)], [sha(2)]);
  assert.equal(slots.length, 1 + ROUTE_SLOTS + ROLLBACK_SLOTS);
  assert.deepEqual(new Set(slots.map((s) => s.digest)), new Set([sha(1), sha(2)]));
  assert.equal(slots.find((s) => s.tag === 'serving-api').digest, sha(1));
  assert.equal(slots.find((s) => s.tag === 'serving-api-rollback-1').digest, sha(2));
  assert.throws(
    () =>
      releaseSlots(
        'api',
        Array.from({ length: ROUTE_SLOTS + 2 }, (_, i) => sha(i)),
        [],
      ),
    /partial/,
  );
});

/** Apply `order` one write at a time; after every write, each `kept` image still has a holder. */
function assertGapFree(existing, order, kept) {
  const state = new Map(existing);
  for (const [i, w] of order.entries()) {
    state.set(w.tag, w.digest);
    const held = new Set([...state].filter(([t]) => t.startsWith('serving-')).map(([, d]) => d));
    for (const d of kept) assert.ok(held.has(d), `${d} has no serving- tag after write ${i}`);
  }
  return state;
}

test('write order frees a wanted image only after another serving tag holds it', () => {
  // Shift left (traffic rollback): rollback-1 becomes primary; writing rollback-2 first would
  // drop sha(3), which rollback-1 still wants.
  const existing = new Map([
    ['serving-api', sha(1)],
    ['serving-api-rollback-1', sha(2)],
    ['serving-api-rollback-2', sha(3)],
    ['serving-spare', sha(1)],
  ]);
  const left = [
    { tag: 'serving-api', digest: sha(2) },
    { tag: 'serving-api-rollback-1', digest: sha(3) },
    { tag: 'serving-api-rollback-2', digest: sha(4) },
  ];
  const order = writeOrder(left, existing, 'serving-spare', sha(2));
  assertGapFree(existing, order, [sha(2), sha(3)]);
  // Shift right (new deploy) runs the other way round.
  const right = [
    { tag: 'serving-api', digest: sha(0) },
    { tag: 'serving-api-rollback-1', digest: sha(1) },
    { tag: 'serving-api-rollback-2', digest: sha(2) },
  ];
  const rightOrder = writeOrder(right, existing, 'serving-spare', sha(0));
  assertGapFree(existing, rightOrder, [sha(1), sha(2)]);
  assert.ok(rightOrder.every((w) => w.existed));
});

test('a pure swap between slots parks one image on the spare tag, so there is never a gap', () => {
  const existing = new Map([
    ['serving-api', sha(1)],
    ['serving-api-route-1', sha(2)],
  ]);
  const swap = [
    { tag: 'serving-api', digest: sha(2) },
    { tag: 'serving-api-route-1', digest: sha(1) },
  ];
  const order = writeOrder(swap, existing, 'serving-spare', sha(2));
  assert.equal(order[0].tag, 'serving-spare');
  assert.equal(order[0].existed, false);
  const final = assertGapFree(existing, order, [sha(1), sha(2)]);
  assert.equal(final.get('serving-api'), sha(2));
  assert.equal(final.get('serving-api-route-1'), sha(1));
  assert.equal(final.get('serving-spare'), sha(2));
  // A three-way rotation with a spare that already holds an unwanted image.
  const rotate = new Map([
    ['serving-a', sha(1)],
    ['serving-b', sha(2)],
    ['serving-c', sha(3)],
    ['serving-spare', sha(9)],
  ]);
  const wanted = [
    { tag: 'serving-a', digest: sha(2) },
    { tag: 'serving-b', digest: sha(3) },
    { tag: 'serving-c', digest: sha(1) },
  ];
  assertGapFree(rotate, writeOrder(wanted, rotate, 'serving-spare', sha(2)), [1, 2, 3].map(sha));
});

/** A Cloud Run + Artifact Registry fake: services, revision history, jobs and the tag table. */
function registryFixture({ api, worker, pool, tags = new Map(), jobs = [], options = {} } = {}) {
  const writes = [];
  const calls = [];
  const history = {
    'declutrmail-api': api,
    'declutrmail-worker': worker,
    'declutrmail-worker-pool': pool,
  };
  const fixed = [['latest', sha(1)], ...(options.noProbe ? [] : [[PINNED[0].source, PROBE]])];
  const run = (...args) => {
    calls.push(args);
    if (args[0] === 'run') {
      if (args[1] === 'jobs') {
        if (options.jobsError) throw new Error('Permission denied');
        return JSON.stringify(jobs);
      }
      if (args[2] === 'update-traffic' || args[2] === 'update-instance-split') {
        const h = history[args[3]];
        h.serving = args[4].split('=')[1];
        h.routes = [];
        options.onShift?.(tags);
        return '';
      }
      const list = args.includes('list');
      const flag = args.find((a) => a.startsWith('--service=') || a.startsWith('--worker-pool='));
      const name = list ? flag.split('=')[1] : args[args.indexOf('describe') + 1];
      const h = history[name];
      if (!h) {
        if (options.poolError && name === 'declutrmail-worker-pool')
          throw Object.assign(new Error('Command failed'), { stderr: 'PERMISSION_DENIED' });
        const what = args[1] === 'services' ? 'service' : 'worker pool';
        throw Object.assign(new Error('Command failed'), {
          stderr: `ERROR: (gcloud.run.${args[1]}.describe) Cannot find ${what} [${name}]`,
        });
      }
      if (list) return JSON.stringify(h.revisions);
      const splits = [{ revisionName: h.serving, percent: 100 }, ...(h.routes ?? [])];
      return JSON.stringify({
        status: args[1] === 'services' ? { traffic: splits } : { instanceSplits: splits },
      });
    }
    if (args[2] === 'tags' && args[3] === 'list') {
      if (options.lookupError) throw new Error('Permission denied');
      if (options.malformed) return '{"unexpected":true}';
      return JSON.stringify(
        [...fixed, ...tags].map(([tag, digest]) => ({
          tag: `${packageName}/tags/${tag}`,
          version: `${packageName}/versions/${digest}`,
        })),
      );
    }
    assert.deepEqual(args.slice(0, 2), ['artifacts', 'tags']);
    assert.ok(['create', 'update'].includes(args[2]), `unexpected tag mutation ${args[2]}`);
    options.beforeWrite?.(writes.length);
    if (options.failAt === writes.length) throw new Error('Quota exceeded');
    writes.push(args);
    if (options.writeError) throw new Error('Permission denied');
    const tag = args[3];
    // Mirrors the API: create fails on an existing tag, update fails on a missing one.
    assert.equal(tags.has(tag), args[2] === 'update');
    if (args[2] === 'update')
      assert.ok(!tag.startsWith('retain-'), 'a retention tag must never move');
    if (!options.missingReadback)
      tags.set(tag, args.find((a) => a.startsWith('--version=')).slice(10));
    options.afterWrite?.(tags);
    return '';
  };
  return { run, tags, writes, calls, options, history };
}

const deployHistory = (prefix, count, base = 1000) =>
  Array.from({ length: count }, (_, i) =>
    revision(`${prefix}-${String(i).padStart(5, '0')}`, base + i, 1 + i),
  );

// API images are 1000+, worker images 2000+, so a slot can never be satisfied by the other role.
function twoServices(count = 8) {
  const apiRevisions = deployHistory('declutrmail-api', count, 1000);
  const workerRevisions = deployHistory('declutrmail-worker', count, 2000);
  return {
    api: { revisions: apiRevisions, serving: apiRevisions.at(-1).metadata.name },
    worker: { revisions: workerRevisions, serving: workerRevisions.at(-1).metadata.name },
  };
}

const servingHolders = (tags) =>
  new Set([...tags].filter(([t]) => t.startsWith('serving-')).map(([, d]) => d));
const pin = (fixture, namespace = 'deploy', extra = {}) =>
  pinProductionImages({ run: fixture.run, log: () => {}, namespace, ...extra });
/** Months later: every image is older than 14 days and outside the newest 20. */
function cleanupVerdicts(fixture, digests) {
  const now = Date.UTC(2026, 11, 1);
  const versions = [
    ...digests.map((digest, i) => ({
      package: 'api',
      version: digest,
      createTime: Date.UTC(2026, 8, 1) + i * 3_600_000,
      tags: [
        ...(digest === PROBE ? [PINNED[0].source] : []),
        ...[...fixture.tags].filter(([, d]) => d === digest).map(([t]) => t),
      ],
    })),
    ...Array.from({ length: 25 }, (_, i) => ({
      package: 'api',
      version: sha(5000 + i),
      createTime: now - (i + 1) * 3_600_000,
      tags: [],
    })),
  ];
  const verdicts = evaluateCleanupPolicy(policy, versions, now);
  return new Set(verdicts.filter((v) => v.deleted).map((v) => v.version));
}

test('every pin needs an explicit writer namespace', () => {
  const fixture = registryFixture(twoServices());
  assert.throws(() => pinProductionImages({ run: fixture.run, log() {} }), /--namespace/);
  assert.equal(fixture.calls.length, 0);
});

test('first run creates every serving slot and protects current plus five rollback images', () => {
  const fixture = registryFixture(twoServices());
  const result = pin(fixture);
  assert.equal(fixture.tags.get('serving-api'), sha(1007));
  assert.equal(fixture.tags.get('serving-worker'), sha(2007));
  for (let i = 1; i <= ROLLBACK_SLOTS; i++) {
    assert.equal(fixture.tags.get(`serving-api-rollback-${i}`), sha(1007 - i));
    assert.equal(fixture.tags.get(`serving-worker-rollback-${i}`), sha(2007 - i));
  }
  assert.equal(fixture.tags.get('serving-pinned-billing-probe'), PROBE);
  assert.equal(fixture.tags.get('serving-spare'), sha(1007));
  assert.deepEqual(
    new Set(result.protectedDigests),
    new Set([
      ...[1007, 1006, 1005, 1004, 1003, 1002, 2007, 2006, 2005, 2004, 2003, 2002].map(sha),
      PROBE,
    ]),
  );
  assert.ok(fixture.writes.every((w) => w[2] === 'create'));
  assert.equal(fixture.tags.get('retain-declutrmail-api-00007'), sha(1007));
});

test('a new deploy moves slots with tags update and never deletes', () => {
  const services = twoServices();
  const fixture = registryFixture(services);
  pin(fixture);
  fixture.writes.length = 0;
  services.api.revisions.push(revision('declutrmail-api-00008', 1008, 9));
  services.api.serving = 'declutrmail-api-00008';
  pin(fixture);
  assert.ok(fixture.writes.some((w) => w[2] === 'update' && w[3] === 'serving-api'));
  assert.equal(fixture.tags.get('serving-api'), sha(1008));
  assert.equal(fixture.tags.get('serving-api-rollback-1'), sha(1007));
  assert.equal(fixture.tags.get('serving-api-rollback-5'), sha(1003));
  // The image that fell out of rollback history keeps no serving tag.
  assert.ok(!servingHolders(fixture.tags).has(sha(1002)));
});

// A release step that dies part-way must never strip a wanted image of its last serving tag.
for (const [label, move] of [
  [
    'new deploy',
    (s) => {
      s.api.revisions.push(revision('declutrmail-api-00008', 1008, 9));
      s.api.serving = 'declutrmail-api-00008';
    },
  ],
  ['traffic rollback', (s) => (s.api.serving = 'declutrmail-api-00006')],
  ['rollback by two', (s) => (s.api.serving = 'declutrmail-api-00005')],
  [
    'route swap',
    (s) => {
      s.api.serving = 'declutrmail-api-00006';
      s.api.routes = [{ revisionName: 'declutrmail-api-00007', tag: 'canary' }];
    },
  ],
])
  test(`${label}: an interrupted pin leaves every still-wanted image tagged`, () => {
    let completed = false;
    for (let failAt = 0; !completed; failAt++) {
      const services = twoServices();
      services.api.routes = [{ revisionName: 'declutrmail-api-00006', tag: 'canary' }];
      const fixture = registryFixture(services);
      const before = new Set(pin(fixture).protectedDigests);
      fixture.writes.length = 0;
      move(services);
      const after = new Set(pin(registryFixture(structuredClone(services))).protectedDigests);
      const kept = [...before].filter((d) => after.has(d));
      assert.ok(kept.length > 0);
      fixture.options.failAt = failAt;
      fixture.options.afterWrite = (tags) => {
        const held = servingHolders(tags);
        for (const d of kept) assert.ok(held.has(d), `${d} lost its last serving tag`);
      };
      try {
        pin(fixture);
        completed = true;
      } catch (error) {
        assert.match(String(error), /Quota exceeded/);
      }
      const held = servingHolders(fixture.tags);
      for (const d of kept) assert.ok(held.has(d), `${d} unprotected after failing at ${failAt}`);
    }
  });

test('a failed candidate that never served does not take a rollback slot', () => {
  const services = twoServices();
  const fixture = registryFixture({
    ...services,
    // Earlier releases were pinned while serving.
    tags: new Map(
      services.api.revisions.map((r, i) => [`retain-${r.metadata.name}`, sha(1000 + i)]),
    ),
  });
  services.api.revisions.push(
    revision('declutrmail-api-00008', 1008, 9), // failed smoke, never took traffic
    revision('declutrmail-api-00009', 1009, 10),
  );
  services.api.serving = 'declutrmail-api-00009';
  pin(fixture);
  assert.equal(fixture.tags.get('serving-api-rollback-1'), sha(1007));
  assert.ok(!servingHolders(fixture.tags).has(sha(1008)));
});

test('a re-pin during a smoke protects the candidate but never records it as served', () => {
  const services = twoServices();
  const fixture = registryFixture({
    ...services,
    tags: new Map(
      services.api.revisions.map((r, i) => [`retain-${r.metadata.name}`, sha(1000 + i)]),
    ),
  });
  pin(fixture);
  // deploy-api-safely stages the candidate at 0% behind a verify- tag; the hourly re-pin runs.
  services.api.revisions.push(revision('declutrmail-api-00008', 1008, 9));
  services.api.routes = [{ revisionName: 'declutrmail-api-00008', percent: 0, tag: 'verify-1a2b' }];
  pin(fixture, 'observed');
  assert.equal(fixture.tags.get('serving-observed-api-route-1'), sha(1008));
  assert.ok(!fixture.tags.has('retain-declutrmail-api-00008'));
  // The smoke fails and the tag is removed; the next release succeeds.
  services.api.routes = [];
  services.api.revisions.push(revision('declutrmail-api-00009', 1009, 10));
  services.api.serving = 'declutrmail-api-00009';
  pin(fixture);
  assert.deepEqual(
    Array.from({ length: ROLLBACK_SLOTS }, (_, i) =>
      fixture.tags.get(`serving-api-rollback-${i + 1}`),
    ),
    [1007, 1006, 1005, 1004, 1003].map(sha),
  );
});

test('the cleanup policy never deletes the serving image or the last five rollback images', () => {
  const fixture = registryFixture(twoServices());
  const { protectedDigests } = pin(fixture);
  const gone = cleanupVerdicts(fixture, [
    ...Array.from({ length: 8 }, (_, i) => sha(1000 + i)),
    ...Array.from({ length: 8 }, (_, i) => sha(2000 + i)),
    PROBE,
  ]);
  for (const digest of protectedDigests) assert.ok(!gone.has(digest), `${digest} would be deleted`);
  assert.equal(protectedDigests.length, 2 * (1 + ROLLBACK_SLOTS) + 1);
  // Negative control: images older than the five rollbacks lose protection, so growth stops.
  assert.deepEqual([...gone], [sha(1000), sha(1001), sha(2000), sha(2001)]);
});

test('existing matching pins need no mutation', () => {
  const fixture = registryFixture(twoServices());
  pin(fixture);
  fixture.writes.length = 0;
  pin(fixture);
  assert.equal(fixture.writes.length, 0);
});

test('production sources protect the API, the legacy worker service and the worker pool', () => {
  assert.deepEqual(
    SOURCES.map((s) => [s.name, s.kind]),
    [
      ['declutrmail-api', 'service'],
      ['declutrmail-worker', 'service'],
      ['declutrmail-worker-pool', 'workerPool'],
    ],
  );
  const services = twoServices();
  const pool = {
    revisions: deployHistory('declutrmail-worker-pool', 3, 3000),
    serving: 'declutrmail-worker-pool-00002',
  };
  const fixture = registryFixture({ ...services, pool });
  pin(fixture);
  assert.equal(fixture.tags.get('serving-worker'), sha(2007));
  assert.equal(fixture.tags.get('serving-worker-pool'), sha(3002));
  assert.equal(fixture.tags.get('serving-worker-pool-rollback-2'), sha(3000));
  assert.equal(fixture.tags.get('retain-declutrmail-worker-pool-00002'), sha(3002));
});

test('only a definite not-found skips the optional pool; a required source must exist', () => {
  const absent = registryFixture(twoServices());
  const lines = [];
  pinProductionImages({ run: absent.run, log: (l) => lines.push(l), namespace: 'deploy' });
  assert.ok(lines.some((l) => l.includes('declutrmail-worker-pool does not exist')));
  const denied = registryFixture({ ...twoServices(), options: { poolError: true } });
  assert.throws(() => pin(denied), /Command failed/);
  assert.equal(denied.writes.length, 0);
  const noWorker = registryFixture({ api: twoServices().api });
  assert.throws(() => pin(noWorker), /Command failed/);
  assert.equal(noWorker.writes.length, 0);
});

test('every Cloud Run resource the deploy workflow deploys is a required source', () => {
  const workflow = readFileSync('.github/workflows/deploy-cloud-run.yml', 'utf8');
  const targets = [
    ...workflow.matchAll(/gcloud run (?:worker-pools )?deploy (declutrmail-[a-z-]+)/g),
  ].map((m) => m[1]);
  assert.ok(targets.includes('declutrmail-api') && targets.includes('declutrmail-worker'));
  for (const name of targets)
    assert.ok(
      SOURCES.some((s) => s.name === name && s.required),
      `${name} is deployed but is not a required pin source`,
    );
  assert.match(workflow, /node scripts\/pin-production-images\.mjs --namespace=deploy/);
});

test('every pinned image is the one its workflow runs', () => {
  for (const { source, workflow } of PINNED)
    assert.ok(
      readFileSync(workflow, 'utf8').includes(`IMAGE: ${IMAGE}:${source}`),
      `${workflow} no longer runs ${source}; update PINNED`,
    );
});

test('a missing pinned source fails loudly after protecting every release image', () => {
  const fixture = registryFixture({ ...twoServices(), options: { noProbe: true } });
  assert.throws(() => pin(fixture), /serving-pinned-billing-probe.*not found/);
  assert.equal(fixture.tags.get('serving-api'), sha(1007));
  assert.equal(fixture.tags.get('serving-worker-rollback-5'), sha(2002));
  // Once pinned, the fixed tag keeps the image even if the source tag later disappears.
  const pinned = registryFixture({
    ...twoServices(),
    tags: new Map([['serving-pinned-billing-probe', PROBE]]),
    options: { noProbe: true },
  });
  assert.ok(pin(pinned).protectedDigests.includes(PROBE));
});

const job = (image) => ({
  metadata: { name: `billing-queue-probe-${image.slice(-4)}` },
  spec: { template: { spec: { template: { spec: { containers: [{ image }] } } } } },
});

test('an orphaned Cloud Run job keeps the image it references, by digest or by tag', () => {
  const services = twoServices();
  const fixture = registryFixture({
    ...services,
    tags: new Map([['commit-old', sha(1001)]]),
    jobs: [job(`${IMAGE}@${sha(1000)}`), job(`${IMAGE}:commit-old`), job('gcr.io/other/image:1')],
  });
  const { protectedDigests } = pin(fixture);
  assert.equal(fixture.tags.get('serving-job-1'), sha(1000));
  assert.equal(fixture.tags.get('serving-job-2'), sha(1001));
  assert.equal(fixture.tags.get(`serving-job-${JOB_SLOTS}`), sha(1007));
  const gone = cleanupVerdicts(
    fixture,
    Array.from({ length: 8 }, (_, i) => sha(1000 + i)),
  );
  for (const d of [sha(1000), sha(1001)]) {
    assert.ok(protectedDigests.includes(d));
    assert.ok(!gone.has(d), `${d} referenced by a job would be deleted`);
  }
});

test('job images that cannot be pinned fail loudly; an unreadable job list fails first', () => {
  const tooMany = registryFixture({
    ...twoServices(),
    jobs: Array.from({ length: JOB_SLOTS + 1 }, (_, i) => job(`${IMAGE}@${sha(1000 + i)}`)),
  });
  assert.throws(() => pin(tooMany), /exceed/);
  assert.equal(tooMany.tags.get('serving-api'), sha(1007));
  const dangling = registryFixture({ ...twoServices(), jobs: [job(`${IMAGE}:gone`)] });
  assert.throws(() => pin(dangling), /not in the registry/);
  assert.deepEqual(jobImages([job(`${IMAGE}:gone`)], new Map()).unresolved, [`${IMAGE}:gone`]);
  const unreadable = registryFixture({ ...twoServices(), options: { jobsError: true } });
  assert.throws(() => pin(unreadable), /Permission denied/);
  assert.equal(unreadable.writes.length, 0);
});

test('the managed tag set is exact, and anything else under serving- is reported', () => {
  const managed = managedTags();
  const perNamespace =
    SOURCES.length * (1 + ROUTE_SLOTS + ROLLBACK_SLOTS) + JOB_SLOTS + PINNED.length + 1;
  assert.equal(managed.size, Object.keys(NAMESPACES).length * perNamespace);
  for (const prefix of Object.values(NAMESPACES))
    for (const tag of managed) if (tag.startsWith(prefix)) assert.ok(tag.length > prefix.length);
  const fixture = registryFixture({
    ...twoServices(),
    tags: new Map([['serving-obsolete-role', sha(1000)]]),
  });
  const lines = [];
  const { unknown } = pinProductionImages({
    run: fixture.run,
    log: (l) => lines.push(l),
    namespace: 'deploy',
  });
  assert.deepEqual(unknown, ['serving-obsolete-role']);
  assert.ok(lines.some((l) => l.startsWith('::warning::') && l.includes('serving-obsolete-role')));
});

test('a stale reconciler run cannot undo a newer deploy pin', () => {
  const services = twoServices();
  const fixture = registryFixture(services);
  pin(fixture);
  pin(fixture, 'observed');
  services.api.revisions.push(revision('declutrmail-api-00008', 1008, 9));
  services.api.serving = 'declutrmail-api-00008';
  pin(fixture);
  // The reconciler reads release state A (00008). Before it writes, traffic is rolled back to
  // an old image and the deploy pins state B; the reconciler then resumes with stale targets.
  let interleaved = false;
  fixture.options.beforeWrite = () => {
    if (interleaved) return;
    interleaved = true;
    services.api.serving = 'declutrmail-api-00001';
    pin(fixture);
  };
  assert.throws(() => pin(fixture, 'observed'), /serving state changed/);
  assert.ok(interleaved);
  assert.equal(fixture.tags.get('serving-api'), sha(1001));
  assert.ok(servingHolders(fixture.tags).has(sha(1001)));
  assert.ok(
    !cleanupVerdicts(
      fixture,
      Array.from({ length: 9 }, (_, i) => sha(1000 + i)),
    ).has(sha(1001)),
  );
});

test('the sanctioned rollback tags the target image before it moves traffic', () => {
  const services = twoServices(30);
  const fixture = registryFixture(services);
  pin(fixture);
  pin(fixture, 'observed');
  const target = sha(1002); // outside the five rollbacks, so only the rollback path protects it
  assert.ok(!servingHolders(fixture.tags).has(target));
  let heldAtShift = false;
  fixture.options.onShift = (tags) => (heldAtShift = servingHolders(tags).has(target));
  rollbackTraffic({ role: 'api', revision: 'declutrmail-api-00002', run: fixture.run, log() {} });
  assert.ok(heldAtShift, 'traffic moved before the target image had a serving- tag');
  assert.equal(services.api.serving, 'declutrmail-api-00002');
  assert.equal(fixture.tags.get('serving-observed-api'), target);
  const shift = fixture.calls.find((c) => c[2] === 'update-traffic');
  assert.deepEqual(shift.slice(0, 5), [
    'run',
    'services',
    'update-traffic',
    'declutrmail-api',
    '--to-revisions=declutrmail-api-00002=100',
  ]);
  const gone = cleanupVerdicts(
    fixture,
    Array.from({ length: 30 }, (_, i) => sha(1000 + i)),
  );
  assert.ok(!gone.has(target));
});

test('a rollback whose target cannot be protected never moves traffic', () => {
  const services = twoServices(30);
  const fixture = registryFixture({ ...services, options: { writeError: true } });
  assert.throws(
    () =>
      rollbackTraffic({
        role: 'api',
        revision: 'declutrmail-api-00002',
        run: fixture.run,
        log() {},
      }),
    /traffic not moved/,
  );
  assert.ok(!fixture.calls.some((c) => c[2] === 'update-traffic'));
  assert.equal(services.api.serving, 'declutrmail-api-00029');
  for (const revision of ['declutrmail-api-x', 'declutrmail-worker-00001', '../x'])
    assert.throws(() => rollbackTraffic({ role: 'api', revision, run: fixture.run, log() {} }));
});

test('a conflicting retention tag prevents every mutation', () => {
  const fixture = registryFixture({
    ...twoServices(),
    tags: new Map([['retain-declutrmail-api-00007', sha(42)]]),
  });
  assert.throws(() => pin(fixture), /conflicts/);
  assert.equal(fixture.writes.length, 0);
});

test('unreadable serving state prevents every mutation', () => {
  const services = twoServices();
  services.api.revisions = services.api.revisions.slice(0, -1); // serving revision absent from history
  const fixture = registryFixture(services);
  assert.throws(() => pin(fixture));
  assert.equal(fixture.writes.length, 0);
});

for (const options of [{ lookupError: true }, { malformed: true }])
  test(`unavailable or malformed discovery fails closed ${JSON.stringify(options)}`, () => {
    const fixture = registryFixture({ ...twoServices(), options });
    assert.throws(() => pin(fixture));
    assert.equal(fixture.writes.length, 0);
  });

for (const options of [{ writeError: true }, { missingReadback: true }])
  test(`failed write or readback cannot report success ${JSON.stringify(options)}`, () => {
    const fixture = registryFixture({ ...twoServices(), options });
    const lines = [];
    assert.throws(() =>
      pinProductionImages({ run: fixture.run, namespace: 'deploy', log: (l) => lines.push(l) }),
    );
    assert.ok(!lines.some((l) => l.startsWith('Protected')), lines.join('\n'));
  });
