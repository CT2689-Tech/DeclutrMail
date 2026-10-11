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
  pinProductionImages,
  IMAGE,
  PINNED,
  ROLLBACK_SLOTS,
  ROUTE_SLOTS,
} from './pin-production-images.mjs';

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
        ],
      },
    }),
    ['declutrmail-api-001-a', 'declutrmail-api-002-b', 'declutrmail-api-003-c'],
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
    ),
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

test('write order frees a wanted image only after another serving tag holds it', () => {
  // Shift left (traffic rollback): rollback-1 becomes primary; writing rollback-3 first would
  // drop sha(3), which rollback-2 still wants.
  const existing = new Map([
    ['serving-api', sha(1)],
    ['serving-api-rollback-1', sha(2)],
    ['serving-api-rollback-2', sha(3)],
  ]);
  const slots = [
    { tag: 'serving-api', digest: sha(2) },
    { tag: 'serving-api-rollback-1', digest: sha(3) },
    { tag: 'serving-api-rollback-2', digest: sha(4) },
  ];
  assert.deepEqual(
    writeOrder(slots, existing).map((s) => s.tag),
    ['serving-api', 'serving-api-rollback-1', 'serving-api-rollback-2'],
  );
  // Shift right (new deploy) runs the other way round.
  const right = [
    { tag: 'serving-api', digest: sha(0) },
    { tag: 'serving-api-rollback-1', digest: sha(1) },
    { tag: 'serving-api-rollback-2', digest: sha(2) },
  ];
  assert.deepEqual(
    writeOrder(right, existing).map((s) => s.tag),
    ['serving-api-rollback-2', 'serving-api-rollback-1', 'serving-api'],
  );
  assert.deepEqual(
    writeOrder(right, existing).map((s) => s.existed),
    [true, true, true],
  );
});

/** A Cloud Run + Artifact Registry fake: services, their revision history, and the tag table. */
function registryFixture({
  api,
  worker,
  workerKind = 'service',
  tags = new Map(),
  options = {},
} = {}) {
  const writes = [];
  let reads = 0;
  const history = {
    'declutrmail-api': api,
    [workerKind === 'service' ? 'declutrmail-worker' : 'declutrmail-worker-pool']: worker,
  };
  const fixed = [['latest', sha(1)], ...(options.noProbe ? [] : [[PINNED[0].source, PROBE]])];
  const run = (...args) => {
    if (args[0] === 'run') {
      const list = args.includes('list');
      const flag = args.find((a) => a.startsWith('--service=') || a.startsWith('--worker-pool='));
      const name = list ? flag.split('=')[1] : args[args.indexOf('describe') + 1];
      const h = history[name];
      if (!h) throw new Error(`not found ${name}`);
      if (list) return JSON.stringify(h.revisions);
      const splits = [{ revisionName: h.serving, percent: 100 }, ...(h.routes ?? [])];
      return JSON.stringify({
        status: args[1] === 'services' ? { traffic: splits } : { instanceSplits: splits },
      });
    }
    if (args[2] === 'tags' && args[3] === 'list') {
      reads++;
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
  return {
    run,
    tags,
    writes,
    options,
    get reads() {
      return reads;
    },
  };
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
const pin = (fixture) => pinProductionImages({ run: fixture.run, log: () => {} });

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
  for (const s of [services.api, services.worker]) {
    const prefix = s.serving.replace(/-\d+$/, '');
    const base = prefix.endsWith('api') ? 1008 : 2008;
    s.revisions.push(revision(`${prefix}-00008`, base, 9));
    s.serving = `${prefix}-00008`;
  }
  pin(fixture);
  assert.ok(fixture.writes.some((w) => w[2] === 'update' && w[3] === 'serving-api'));
  assert.equal(fixture.tags.get('serving-api'), sha(1008));
  assert.equal(fixture.tags.get('serving-api-rollback-1'), sha(1007));
  assert.equal(fixture.tags.get('serving-api-rollback-5'), sha(1003));
  assert.equal(fixture.tags.get('serving-worker-rollback-5'), sha(2003));
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
])
  test(`${label}: an interrupted pin leaves every still-wanted image tagged`, () => {
    let completed = false;
    for (let failAt = 0; !completed; failAt++) {
      const services = twoServices();
      const fixture = registryFixture(services);
      const before = new Set(pin(fixture).protectedDigests);
      fixture.writes.length = 0;
      move(services);
      const after = new Set(
        pinProductionImages({ run: registryFixture(structuredClone(services)).run, log() {} })
          .protectedDigests,
      );
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

test('the cleanup policy never deletes the serving image or the last five rollback images', () => {
  const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
  const fixture = registryFixture(twoServices());
  const { protectedDigests } = pin(fixture);
  const now = Date.UTC(2026, 11, 1);
  const tagsOf = (digest) => [
    ...(digest === PROBE ? [PINNED[0].source] : []),
    ...[...fixture.tags].filter(([, d]) => d === digest).map(([t]) => t),
  ];
  const old = (digest, i) => ({
    package: 'api',
    version: digest,
    createTime: Date.UTC(2026, 8, 1 + i),
    tags: tagsOf(digest),
  });
  const versions = [
    // Every deployed image is now months old and outside the newest 20.
    ...Array.from({ length: 8 }, (_, i) => old(sha(1000 + i), i)),
    ...Array.from({ length: 8 }, (_, i) => old(sha(2000 + i), i)),
    old(PROBE, 0),
    ...Array.from({ length: 25 }, (_, i) => ({
      package: 'api',
      version: sha(5000 + i),
      createTime: now - (i + 1) * 3_600_000,
      tags: [],
    })),
  ];
  const verdicts = evaluateCleanupPolicy(policy, versions, now);
  const gone = verdicts.filter((v) => v.deleted).map((v) => v.version);
  for (const digest of protectedDigests)
    assert.ok(!gone.includes(digest), `${digest} would be deleted`);
  assert.equal(protectedDigests.length, 2 * (1 + ROLLBACK_SLOTS) + 1);
  // Negative control: images older than the five rollbacks lose protection, so growth stops.
  assert.deepEqual(gone, [sha(1000), sha(1001), sha(2000), sha(2001)]);
});

test('existing matching pins need no mutation', () => {
  const fixture = registryFixture(twoServices());
  pin(fixture);
  fixture.writes.length = 0;
  pin(fixture);
  assert.equal(fixture.writes.length, 0);
});

test('the worker can be pointed at a worker pool by changing its source entry', () => {
  const services = twoServices();
  services.worker = {
    revisions: deployHistory('declutrmail-worker-pool', 3, 3000),
    serving: 'declutrmail-worker-pool-00002',
  };
  const fixture = registryFixture({ ...services, workerKind: 'workerPool' });
  pinProductionImages({
    run: fixture.run,
    log: () => {},
    sources: [
      { role: 'api', kind: 'service', name: 'declutrmail-api', region: 'us-central1' },
      { role: 'worker', kind: 'workerPool', name: 'declutrmail-worker-pool', region: 'us-west1' },
    ],
  });
  assert.equal(fixture.tags.get('serving-worker'), sha(3002));
  assert.equal(fixture.tags.get('serving-worker-rollback-2'), sha(3000));
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
    let logged = false;
    assert.throws(() =>
      pinProductionImages({
        run: fixture.run,
        log: () => {
          logged = true;
        },
      }),
    );
    assert.equal(logged, false);
  });
