import test from 'node:test';
import assert from 'node:assert/strict';
import {
  servingRevisions,
  servingInstanceSplits,
  retentionTag,
  pinProductionImages,
} from './pin-production-images.mjs';

test('retention protects every traffic destination and tagged rollback route', () => {
  assert.deepEqual(
    servingRevisions({
      status: {
        traffic: [
          { revisionName: 'declutrmail-api-001-a', percent: 90 },
          { revisionName: 'declutrmail-api-002-b', percent: 10 },
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

test('worker-pool retention protects every assigned revision and fails closed on a partial split', () => {
  assert.deepEqual(
    servingInstanceSplits({
      status: {
        instanceSplits: [
          { revisionName: 'declutrmail-worker-pool-00002-b', percent: 100 },
          { revisionName: 'declutrmail-worker-pool-00001-a', percent: 0 },
        ],
      },
    }),
    ['declutrmail-worker-pool-00002-b'],
  );
  for (const instanceSplits of [
    undefined,
    [],
    [{ percent: 100 }],
    [{ revisionName: 'declutrmail-worker-pool-00001-a', percent: 50 }],
    [{ revisionName: 'declutrmail-api-001-a', percent: 100 }],
  ])
    assert.throws(() => servingInstanceSplits({ status: { instanceSplits } }));
});

test('new deployments and traffic reordering never reuse a previous release retention tag', () => {
  const old = retentionTag('declutrmail-api-001-a');
  assert.notEqual(old, retentionTag('declutrmail-api-002-b'));
  assert.equal(old, retentionTag('declutrmail-api-001-a'));
  assert.throws(() => retentionTag('../unexpected'));
});

const image = 'us-central1-docker.pkg.dev/declutrmail-ai-prod/declutrmail/api';
const packageName =
  'projects/declutrmail-ai-prod/locations/us-central1/repositories/declutrmail/packages/api';
const revisions = [
  'declutrmail-api-001-a',
  'declutrmail-worker-002-b',
  'declutrmail-worker-pool-00001-c',
];
const digest = `${image}@sha256:${'a'.repeat(64)}`;
function registryFixture(initial = revisions, options = {}) {
  const tags = new Map(initial.map((revision) => [`retain-${revision}`, digest]));
  const writes = [];
  const described = [];
  let reads = 0;
  const run = (...args) => {
    if (args[0] === 'run') {
      if (args[1] === 'worker-pools' && args[2] === 'describe')
        return JSON.stringify({
          status: { instanceSplits: [{ revisionName: revisions[2], percent: 100 }] },
        });
      if (args[1] === 'services' && args[2] === 'describe')
        return JSON.stringify({
          status: {
            traffic: [
              {
                revisionName: args[3].endsWith('worker') ? revisions[1] : revisions[0],
                percent: 100,
              },
            ],
          },
        });
      described.push(args.slice(0, args.indexOf('describe') + 2));
      return JSON.stringify({ status: { imageDigest: digest } });
    }
    if (args[2] === 'tags' && args[3] === 'list') {
      reads++;
      if (options.lookupError) throw new Error('Permission denied');
      if (options.malformed) return '{"unexpected":true}';
      return JSON.stringify(
        [...tags].map(([tag, value]) => ({
          tag: `${packageName}/tags/${tag}`,
          version: `${packageName}/versions/${value.split('@')[1]}`,
        })),
      );
    }
    assert.deepEqual(args.slice(0, 3), ['artifacts', 'tags', 'create']);
    writes.push(args);
    if (options.createError) throw new Error('Already exists');
    assert.equal(tags.has(args[3]), false);
    if (!options.missingReadback) tags.set(args[3], digest);
    return '';
  };
  return {
    run,
    tags,
    writes,
    described,
    get reads() {
      return reads;
    },
  };
}

test('existing matching pins need no mutation or tag deletion permission', () => {
  const fixture = registryFixture();
  assert.equal(pinProductionImages({ run: fixture.run, log: () => {} }).length, 3);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.reads, 2);
  assert.deepEqual(fixture.described, [
    ['run', 'revisions', 'describe', revisions[0]],
    ['run', 'revisions', 'describe', revisions[1]],
    ['run', 'worker-pools', 'revisions', 'describe', revisions[2]],
  ]);
});

test('missing pins use create-only API and are read back before success', () => {
  const fixture = registryFixture([revisions[0]]);
  pinProductionImages({ run: fixture.run, log: () => {} });
  assert.deepEqual(
    fixture.writes.map((write) => write[3]),
    [`retain-${revisions[1]}`, `retain-${revisions[2]}`],
  );
  assert.ok(fixture.writes[0].includes(`--version=sha256:${'a'.repeat(64)}`));
  assert.equal(fixture.tags.get(`retain-${revisions[0]}`), digest);
});

test('a conflicting pin prevents every mutation even when another pin is missing', () => {
  const fixture = registryFixture([revisions[1]]);
  fixture.tags.set(`retain-${revisions[1]}`, `${image}@sha256:${'b'.repeat(64)}`);
  assert.throws(() => pinProductionImages({ run: fixture.run, log: () => {} }), /conflicts/);
  assert.equal(fixture.writes.length, 0);
});

for (const options of [{ lookupError: true }, { malformed: true }])
  test(`unavailable or malformed discovery fails closed ${JSON.stringify(options)}`, () => {
    const fixture = registryFixture([], options);
    assert.throws(() => pinProductionImages({ run: fixture.run, log: () => {} }));
    assert.equal(fixture.writes.length, 0);
  });

for (const options of [{ createError: true }, { missingReadback: true }])
  test(`failed creation or readback cannot report success ${JSON.stringify(options)}`, () => {
    const fixture = registryFixture([revisions[0]], options);
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
