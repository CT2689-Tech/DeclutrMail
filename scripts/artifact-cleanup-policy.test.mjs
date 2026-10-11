import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateCleanupPolicy,
  evaluateCleanupPolicy,
  parseImages,
  verifyInstalled,
  runCleanup,
  providerVerdict,
  durationMs,
  POLICY_PATH,
  LIVE_CONFIRMATION,
} from './artifact-cleanup-policy.mjs';
import { IMAGE } from './pin-production-images.mjs';

const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 11);
const sha = (n) => `sha256:${n.toString(16).padStart(64, '0')}`;
const version = (n, ageDays, tags = []) => ({
  package: 'api',
  version: sha(n),
  createTime: NOW - ageDays * DAY,
  tags,
  sizeBytes: 130 * 1024 ** 2,
});
const deleted = (policies, versions) =>
  evaluateCleanupPolicy(policies, versions, NOW)
    .filter((v) => v.deleted)
    .map((v) => v.version);

test('the repository policy validates and encodes the approved retention contract', () => {
  validateCleanupPolicy(policy);
  const rule = (name) => policy.find((p) => p.name === name);
  assert.deepEqual(rule('old-builds'), {
    name: 'old-builds',
    action: { type: 'Delete' },
    condition: { tagState: 'any', packageNamePrefixes: ['api'], olderThan: '14d' },
  });
  assert.equal(rule('recent-rollbacks').mostRecentVersions.keepCount, 20);
  assert.deepEqual(rule('latest-image').condition.tagPrefixes, ['latest']);
  assert.deepEqual(rule('serving-images').condition.tagPrefixes, ['serving-']);
  assert.deepEqual(rule('recent-retention-tags').condition.tagPrefixes, ['retain-']);
  assert.equal(rule('recent-retention-tags').condition.newerThan, '14d');
  // Reusing the installed names means a merge-style update still overwrites the old keep-forever rule.
  for (const name of ['old-builds', 'recent-rollbacks', 'serving-images']) assert.ok(rule(name));
});

test('only the latest and serving- tags may keep an image without an age bound', () => {
  for (const p of policy.filter(
    (p) => p.action.type === 'Keep' && p.condition && !p.condition.newerThan,
  ))
    assert.ok(
      p.condition.tagPrefixes?.every((prefix) => prefix === 'latest' || prefix === 'serving-'),
      `${p.name} would retain matching images forever`,
    );
});

for (const [label, broken] of [
  ['duplicate names', [...policy, policy[0]]],
  ['unknown action', [{ ...policy[0], action: { type: 'Archive' } }]],
  [
    'condition and mostRecentVersions together',
    [{ ...policy[1], condition: { tagState: 'any' } }, policy[0]],
  ],
  [
    'tag prefixes without tagged state',
    [policy[0], { ...policy[3], condition: { tagState: 'any', tagPrefixes: ['x'] } }],
  ],
  ['bad duration', [{ ...policy[0], condition: { ...policy[0].condition, olderThan: '2 weeks' } }]],
  ['unscoped delete', [{ ...policy[0], condition: { tagState: 'any' } }]],
  [
    'unknown condition key',
    [{ ...policy[0], condition: { ...policy[0].condition, olderThen: '14d' } }],
  ],
  ['no delete rule', policy.filter((p) => p.action.type === 'Keep')],
  ['empty list', []],
])
  test(`validation rejects ${label}`, () => assert.throws(() => validateCleanupPolicy(broken)));

test('keep rules win over delete; age, tag prefix and newest-N are evaluated per documented semantics', () => {
  const versions = [
    version(1, 30, ['latest']),
    version(2, 30, ['serving-api-rollback-3']),
    version(3, 30, ['retain-declutrmail-api-00001', 'abc']),
    version(4, 10, ['retain-declutrmail-api-00002']),
    version(5, 13.9),
    version(6, 14.1),
  ];
  // With fewer than 20 versions everything is kept by recent-rollbacks.
  assert.deepEqual(deleted(policy, versions), []);
  const noRecent = policy.filter((p) => p.name !== 'recent-rollbacks');
  assert.deepEqual(deleted(noRecent, versions), [sha(3), sha(6)]);
});

test('newest-N keeps exactly keepCount versions by creation time', () => {
  const versions = Array.from({ length: 25 }, (_, i) => version(i, 15 + i));
  const gone = deleted(policy, versions);
  assert.equal(gone.length, 5);
  assert.deepEqual(gone, [20, 21, 22, 23, 24].map(sha));
});

test('the old policy never deleted a deployed image; the new one stops growth', () => {
  const oldPolicy = [
    {
      name: 'old-builds',
      action: { type: 'Delete' },
      condition: { tagState: 'any', packageNamePrefixes: ['api'], olderThan: '30d' },
    },
    {
      name: 'recent-rollbacks',
      action: { type: 'Keep' },
      mostRecentVersions: { packageNamePrefixes: ['api'], keepCount: 20 },
    },
    {
      name: 'serving-images',
      action: { type: 'Keep' },
      condition: { tagState: 'tagged', tagPrefixes: ['retain-'] },
    },
  ];
  // ~7 deploys a day for 60 days; every deployed image got a retain- tag.
  const history = Array.from({ length: 420 }, (_, i) =>
    version(i, i / 7, [`sha-${i}`, `retain-declutrmail-api-${i}`]),
  );
  assert.equal(deleted(oldPolicy, history).length, 0);
  const remaining = history.length - deleted(policy, history).length;
  assert.ok(remaining <= 14 * 7 + 1, `kept ${remaining}`);
});

test('registry listings are parsed strictly', () => {
  const entry = {
    package: IMAGE,
    version: sha(1),
    createTime: '2026-10-01T00:00:00Z',
    tags: ['latest'],
    metadata: { imageSizeBytes: '1024' },
  };
  assert.deepEqual(parseImages([entry])[0].tags, ['latest']);
  assert.deepEqual(parseImages([{ ...entry, tags: 'a,b' }])[0].tags, ['a', 'b']);
  for (const bad of [
    [],
    [{ ...entry, package: 'elsewhere' }],
    [{ ...entry, version: 'v1' }],
    [{ ...entry, createTime: 'x' }],
  ])
    assert.throws(() => parseImages(bad));
  assert.equal(durationMs('14d'), 14 * DAY);
});

/** gcloud's installed representation: uppercase enums and durations in seconds. */
const installedForm = (policies, { leftover } = {}) =>
  Object.fromEntries(
    [...policies, ...(leftover ? [leftover] : [])].map((p) => [
      p.name,
      {
        id: p.name,
        action: p.action.type.toUpperCase(),
        ...(p.condition && {
          condition: {
            ...p.condition,
            tagState: p.condition.tagState.toUpperCase(),
            ...(p.condition.olderThan && {
              olderThan: `${durationMs(p.condition.olderThan) / 1000}.0s`,
            }),
            ...(p.condition.newerThan && {
              newerThan: `${durationMs(p.condition.newerThan) / 1000}s`,
            }),
          },
        }),
        ...(p.mostRecentVersions && { mostRecentVersions: p.mostRecentVersions }),
      },
    ]),
  );

test('readback requires exactly the file rules and the requested dry-run flag', () => {
  verifyInstalled(
    { cleanupPolicies: installedForm(policy), cleanupPolicyDryRun: true },
    policy,
    'dry-run',
  );
  verifyInstalled({ cleanupPolicies: installedForm(policy) }, policy, 'live');
  assert.throws(
    () => verifyInstalled({ cleanupPolicies: installedForm(policy) }, policy, 'dry-run'),
    /dry-run flag/,
  );
  const leftover = {
    name: 'keep-forever',
    action: { type: 'Keep' },
    condition: { tagState: 'tagged', tagPrefixes: ['retain-'] },
  };
  assert.throws(
    () =>
      verifyInstalled(
        { cleanupPolicies: installedForm(policy, { leftover }), cleanupPolicyDryRun: true },
        policy,
        'dry-run',
      ),
    /differ/,
  );
  const changed = installedForm(policy);
  changed['old-builds'].condition.olderThan = '2592000s';
  assert.throws(
    () =>
      verifyInstalled({ cleanupPolicies: changed, cleanupPolicyDryRun: true }, policy, 'dry-run'),
    /old-builds differs/,
  );
});

function cleanupFixture({ protectedDigests = [sha(1)], listing, installedAfter } = {}) {
  const calls = [];
  let installed = { cleanupPolicies: {}, cleanupPolicyDryRun: false };
  const images = listing ?? [
    {
      package: IMAGE,
      version: sha(1),
      createTime: new Date(NOW - 40 * DAY).toISOString(),
      tags: ['serving-api'],
    },
    ...Array.from({ length: 30 }, (_, i) => ({
      package: IMAGE,
      version: sha(100 + i),
      createTime: new Date(NOW - (i + 1) * DAY).toISOString(),
      tags: [`sha-${i}`],
      metadata: { imageSizeBytes: String(100 * 1024 ** 2) },
    })),
  ];
  const run = (...args) => {
    calls.push(args);
    if (args[1] === 'repositories' && args[2] === 'describe')
      return JSON.stringify({ sizeBytes: String(17 * 1024 ** 3), ...installed });
    if (args[1] === 'docker' && args[2] === 'images') return JSON.stringify(images);
    if (args[2] === 'set-cleanup-policies') {
      installed = installedAfter ?? {
        cleanupPolicies: installedForm(policy),
        ...(args.includes('--dry-run') && { cleanupPolicyDryRun: true }),
      };
      return '';
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const lines = [];
  return {
    calls,
    lines,
    options: { run, log: (l) => lines.push(l), now: NOW, pin: () => ({ protectedDigests }) },
  };
}

test('dry-run prints repo size and the would-delete list, then installs with --dry-run and reads back', () => {
  const f = cleanupFixture();
  const { verdicts } = runCleanup({ mode: 'dry-run', ...f.options });
  const out = f.lines.join('\n');
  assert.match(out, /Repository size: 17\.00 GiB/);
  assert.match(out, /Would delete now under .*: 10 version\(s\)/);
  assert.ok(out.includes(sha(129)));
  assert.equal(verdicts.find((v) => v.version === sha(1)).deleted, false);
  const set = f.calls.find((c) => c[2] === 'set-cleanup-policies');
  assert.ok(set.includes('--dry-run') && !set.includes('--no-dry-run'));
});

test('report mode never changes the repository', () => {
  const f = cleanupFixture();
  runCleanup({ mode: 'report', ...f.options });
  assert.ok(!f.calls.some((c) => c[2] === 'set-cleanup-policies'));
});

test('live deletion requires the confirmation phrase before any cloud call', () => {
  for (const confirm of [undefined, '', 'yes', LIVE_CONFIRMATION.toUpperCase()]) {
    const f = cleanupFixture();
    assert.throws(() => runCleanup({ mode: 'live', confirm, ...f.options }), /confirmation/);
    assert.equal(f.calls.length, 0);
  }
  const f = cleanupFixture();
  runCleanup({ mode: 'live', confirm: LIVE_CONFIRMATION, ...f.options });
  assert.ok(f.calls.find((c) => c[2] === 'set-cleanup-policies').includes('--no-dry-run'));
});

test('a policy that would delete a protected image is never installed', () => {
  // sha(129) is 30 days old, untagged and outside the newest 20.
  const f = cleanupFixture({ protectedDigests: [sha(1), sha(129)] });
  assert.throws(
    () => runCleanup({ mode: 'live', confirm: LIVE_CONFIRMATION, ...f.options }),
    /protected images/,
  );
  assert.ok(!f.calls.some((c) => c[2] === 'set-cleanup-policies'));
});

test('a protected image missing from the listing fails closed instead of reading as safe', () => {
  const f = cleanupFixture({ protectedDigests: [sha(1), sha(999)] });
  assert.throws(
    () => runCleanup({ mode: 'dry-run', ...f.options }),
    /missing from the version listing/,
  );
  assert.ok(!f.calls.some((c) => c[2] === 'set-cleanup-policies'));
});

test('an install whose readback differs is reported as a failure', () => {
  const f = cleanupFixture({ installedAfter: { cleanupPolicies: {}, cleanupPolicyDryRun: true } });
  assert.throws(() => runCleanup({ mode: 'dry-run', ...f.options }), /differ/);
});

test('unknown modes are rejected', () => {
  assert.throws(() => runCleanup({ mode: 'apply' }), /--mode/);
});

const versionsPrefix =
  'projects/declutrmail-ai-prod/locations/us-central1/repositories/declutrmail/packages/api/versions/';
function verdictFixture({ entries, logError, tags = [] }) {
  const lines = [];
  const run = (...args) => {
    if (args[0] === 'logging') {
      if (logError) throw Object.assign(new Error('x'), { stderr: 'PERMISSION_DENIED' });
      return JSON.stringify(entries);
    }
    assert.deepEqual(args.slice(0, 4), ['artifacts', 'docker', 'tags', 'list']);
    return JSON.stringify(
      tags.map(([tag, digest]) => ({
        tag: `${versionsPrefix.replace('/versions/', '/tags/')}${tag}`,
        version: `${versionsPrefix}${digest}`,
      })),
    );
  };
  return { run, lines, log: (l) => lines.push(l) };
}
const verdictEntry = (...digests) => ({
  protoPayload: {
    request: { validateOnly: true, names: digests.map((d) => `${versionsPrefix}${d}`) },
  },
});

test('the provider verdict lists doomed versions and refuses one holding a serving- tag', () => {
  const ok = verdictFixture({
    entries: [verdictEntry(sha(2), sha(3)), verdictEntry(sha(3))],
    tags: [['serving-api', sha(1)]],
  });
  assert.deepEqual(providerVerdict(ok), { verified: true, versions: [sha(2), sha(3)] });
  assert.ok(ok.lines.some((l) => l.includes('would delete 2 api version(s)')));
  const bad = verdictFixture({
    entries: [verdictEntry(sha(1))],
    tags: [['serving-api-rollback-3', sha(1)]],
  });
  assert.throws(() => providerVerdict(bad), /serving- tag; do not go live/);
  assert.ok(bad.lines.some((l) => l.includes('PROTECTED (serving-api-rollback-3)')));
});

test('a missing or unreadable provider verdict is UNVERIFIED, never a clean result', () => {
  for (const f of [verdictFixture({ entries: [] }), verdictFixture({ logError: true })]) {
    assert.equal(providerVerdict(f).verified, false);
    assert.ok(f.lines.some((l) => l.startsWith('::warning::UNVERIFIED')));
    assert.ok(!f.lines.some((l) => l.includes('would delete')));
  }
});
