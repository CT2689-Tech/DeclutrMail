/**
 * Validate, preview and install the Artifact Registry cleanup policy for the `api` image.
 * The preview re-implements the documented rule semantics; Artifact Registry's own dry-run
 * verdict arrives about a day later in Data Access audit logs.
 * https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { IMAGE, pinProductionImages, readTags } from './pin-production-images.mjs';

const PROJECT = 'declutrmail-ai-prod';
const REPO_SCOPE = ['declutrmail', '--location=us-central1', `--project=${PROJECT}`];
export const POLICY_PATH = 'infra/artifact-cleanup-policy.json';
export const MODES = ['validate', 'report', 'dry-run', 'live', 'verdict'];
export const LIVE_CONFIRMATION = 'delete-unprotected-api-images';
const DURATION = /^(\d+)([smhd])$/;
const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const CONDITION_KEYS = [
  'tagState',
  'tagPrefixes',
  'versionNamePrefixes',
  'packageNamePrefixes',
  'olderThan',
  'newerThan',
];
const gcloud = (...args) =>
  execFileSync('gcloud', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });

export function durationMs(value) {
  const match = DURATION.exec(value ?? '');
  if (!match) throw new Error(`Invalid duration ${value}`);
  return Number(match[1]) * UNIT_MS[match[2]];
}

const stringList = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((v) => typeof v === 'string' && v.length > 0);

/** Structural checks mirroring gcloud's parser plus guards a deleting policy must satisfy. */
export function validateCleanupPolicy(policies) {
  const problems = [];
  if (!Array.isArray(policies) || policies.length === 0)
    throw new Error('Policy file must be a non-empty list');
  if (policies.length > 10)
    problems.push('Artifact Registry allows at most 10 policies per repository');
  const names = new Set();
  for (const p of policies) {
    const name = p?.name;
    if (typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name))
      problems.push(`invalid name ${name}`);
    if (names.has(name)) problems.push(`duplicate name ${name}`);
    names.add(name);
    const extra = Object.keys(p ?? {}).filter(
      (k) => !['name', 'action', 'condition', 'mostRecentVersions'].includes(k),
    );
    if (extra.length) problems.push(`${name}: unknown keys ${extra.join(', ')}`);
    const type = p?.action?.type;
    if (type !== 'Delete' && type !== 'Keep')
      problems.push(`${name}: action.type must be Delete or Keep`);
    if ('condition' in p === 'mostRecentVersions' in p)
      problems.push(`${name}: exactly one of condition or mostRecentVersions`);
    if (p.mostRecentVersions) {
      const { keepCount, packageNamePrefixes, ...rest } = p.mostRecentVersions;
      if (type !== 'Keep') problems.push(`${name}: mostRecentVersions is only valid for Keep`);
      if (!Number.isInteger(keepCount) || keepCount < 1)
        problems.push(`${name}: keepCount must be a positive integer`);
      if (!stringList(packageNamePrefixes)) problems.push(`${name}: packageNamePrefixes required`);
      if (Object.keys(rest).length) problems.push(`${name}: unknown mostRecentVersions keys`);
    }
    const c = p.condition;
    if (c) {
      const unknown = Object.keys(c).filter((k) => !CONDITION_KEYS.includes(k));
      if (unknown.length) problems.push(`${name}: unknown condition keys ${unknown.join(', ')}`);
      if (!['any', 'tagged', 'untagged'].includes(String(c.tagState).toLowerCase()))
        problems.push(`${name}: tagState must be any, tagged or untagged`);
      for (const key of ['tagPrefixes', 'versionNamePrefixes', 'packageNamePrefixes'])
        if (key in c && !stringList(c[key]))
          problems.push(`${name}: ${key} must be a non-empty string list`);
      if (c.tagPrefixes && String(c.tagState).toLowerCase() !== 'tagged')
        problems.push(`${name}: tagPrefixes require tagState tagged`);
      for (const key of ['olderThan', 'newerThan'])
        if (key in c && !DURATION.test(c[key])) problems.push(`${name}: ${key} must look like 14d`);
      if (type === 'Delete' && (!c.olderThan || !c.packageNamePrefixes))
        problems.push(`${name}: a Delete rule must be scoped by packageNamePrefixes and olderThan`);
    }
  }
  if (!policies.some((p) => p?.action?.type === 'Delete'))
    problems.push('no Delete rule: keep rules would be inert');
  if (problems.length) throw new Error(`Invalid cleanup policy:\n- ${problems.join('\n- ')}`);
  return policies;
}

/** Normalize `gcloud artifacts docker images list <image> --include-tags --format=json`. */
export function parseImages(entries) {
  if (!Array.isArray(entries) || entries.length === 0)
    throw new Error('Cannot establish registry versions');
  return entries.map((e) => {
    const createTime = Date.parse(e?.createTime ?? '');
    const tags = Array.isArray(e?.tags)
      ? e.tags
      : String(e?.tags ?? '')
          .split(',')
          .filter(Boolean);
    if (
      e?.package !== IMAGE ||
      !/^sha256:[a-f0-9]{64}$/.test(e?.version ?? '') ||
      Number.isNaN(createTime)
    )
      throw new Error('Unexpected registry version metadata');
    const size = Number(e.metadata?.imageSizeBytes);
    return {
      package: 'api',
      version: e.version,
      createTime,
      tags,
      sizeBytes: Number.isFinite(size) ? size : 0,
    };
  });
}

function matches(condition, v, now) {
  const state = condition.tagState.toLowerCase();
  if (state === 'tagged' && v.tags.length === 0) return false;
  if (state === 'untagged' && v.tags.length > 0) return false;
  const prefixed = (values, prefixes) =>
    !prefixes || values.some((x) => prefixes.some((p) => x.startsWith(p)));
  if (!prefixed(v.tags, condition.tagPrefixes)) return false;
  if (!prefixed([v.package], condition.packageNamePrefixes)) return false;
  if (!prefixed([v.version], condition.versionNamePrefixes)) return false;
  const age = now - v.createTime;
  if (condition.olderThan && age < durationMs(condition.olderThan)) return false;
  if (condition.newerThan && age > durationMs(condition.newerThan)) return false;
  return true;
}

/** A version is deleted when a Delete rule matches and no Keep rule does. */
export function evaluateCleanupPolicy(policies, versions, now) {
  const recent = new Map();
  for (const p of policies.filter((p) => p.mostRecentVersions)) {
    const { packageNamePrefixes, keepCount } = p.mostRecentVersions;
    const packages = new Map();
    for (const v of versions.filter((v) =>
      packageNamePrefixes.some((x) => v.package.startsWith(x)),
    ))
      packages.set(v.package, [...(packages.get(v.package) ?? []), v]);
    for (const group of packages.values())
      for (const v of [...group].sort((a, b) => b.createTime - a.createTime).slice(0, keepCount))
        recent.set(v.version, [...(recent.get(v.version) ?? []), p.name]);
  }
  return versions.map((v) => {
    const by = (type) =>
      policies
        .filter((p) => p.action.type === type && p.condition && matches(p.condition, v, now))
        .map((p) => p.name);
    const deleteBy = by('Delete');
    const keepBy = [...(recent.get(v.version) ?? []), ...by('Keep')];
    return { ...v, deleteBy, keepBy, deleted: deleteBy.length > 0 && keepBy.length === 0 };
  });
}

const normalizeRule = (rule) => {
  const condition = rule.condition && {
    ...Object.fromEntries(
      CONDITION_KEYS.filter((k) => rule.condition[k] !== undefined).map((k) => [
        k,
        rule.condition[k],
      ]),
    ),
    tagState: String(rule.condition.tagState).toUpperCase(),
    ...Object.fromEntries(
      ['olderThan', 'newerThan']
        .filter((k) => rule.condition[k] !== undefined)
        // gcloud installs `14d` as seconds, e.g. `1209600s`.
        .map((k) => {
          const value = String(rule.condition[k]);
          const seconds = /^\d+(\.\d+)?s$/.test(value)
            ? Number(value.slice(0, -1))
            : durationMs(value) / 1000;
          return [k, seconds];
        }),
    ),
  };
  const recent = rule.mostRecentVersions && {
    packageNamePrefixes: rule.mostRecentVersions.packageNamePrefixes,
    keepCount: Number(rule.mostRecentVersions.keepCount),
  };
  return JSON.stringify({
    action: String(rule.action?.type ?? rule.action).toUpperCase(),
    condition,
    recent,
  });
};

/** Read back the repository and require exactly the file's rules in the requested mode. */
export function verifyInstalled(repository, policies, mode) {
  const installed = repository.cleanupPolicies ?? {};
  const expected = new Map(policies.map((p) => [p.name, normalizeRule(p)]));
  const names = Object.keys(installed).sort();
  if (names.join() !== [...expected.keys()].sort().join())
    throw new Error(
      `Installed policies ${names.join(', ') || '(none)'} differ from ${POLICY_PATH}`,
    );
  for (const name of names)
    if (normalizeRule(installed[name]) !== expected.get(name))
      throw new Error(`Installed policy ${name} differs`);
  // The API omits the field when dry run is off.
  if ((repository.cleanupPolicyDryRun === true) !== (mode === 'dry-run'))
    throw new Error(`Repository dry-run flag does not match requested mode ${mode}`);
}

const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;

function describeRepository(run) {
  const repository = JSON.parse(
    run('artifacts', 'repositories', 'describe', ...REPO_SCOPE, '--format=json'),
  );
  if (!repository || typeof repository !== 'object') throw new Error('Cannot read repository');
  return repository;
}

const VERDICT_FILTER = [
  'protoPayload.serviceName="artifactregistry.googleapis.com"',
  `protoPayload.request.parent="projects/${PROJECT}/locations/us-central1/repositories/declutrmail/packages/-"`,
  'protoPayload.request.validateOnly=true',
].join(' AND ');

/**
 * Artifact Registry's own dry-run verdict from Data Access audit logs, checked against the
 * current serving- tags. No readable verdict is UNVERIFIED, never "nothing would be deleted".
 */
export function providerVerdict({ run = gcloud, log = console.log } = {}) {
  let entries;
  try {
    entries = JSON.parse(
      run(
        'logging',
        'read',
        VERDICT_FILTER,
        `--project=${PROJECT}`,
        '--freshness=3d',
        '--format=json',
      ),
    );
    if (!Array.isArray(entries)) throw new Error('unexpected log listing');
  } catch (error) {
    log(
      '::warning::UNVERIFIED: cannot read Data Access audit logs (needs roles/logging.privateLogViewer): ' +
        String(error.stderr || error.message)
          .trim()
          .split('\n')
          .at(-1),
    );
    return { verified: false, versions: [] };
  }
  const prefix = `projects/${PROJECT}/locations/us-central1/repositories/declutrmail/packages/api/versions/`;
  const versions = [
    ...new Set(
      entries
        .flatMap((e) => e?.protoPayload?.request?.names ?? [])
        .filter((n) => typeof n === 'string' && n.startsWith(prefix))
        .map((n) => decodeURIComponent(n.slice(prefix.length))),
    ),
  ].sort();
  if (!entries.length) {
    log(
      '::warning::UNVERIFIED: no provider dry-run verdict in the last 3 days. Either the background ' +
        'job has not run since install (about a day) or DATA_WRITE audit logs are off for ' +
        'artifactregistry.googleapis.com.',
    );
    return { verified: false, versions };
  }
  const serving = new Map(
    [...readTags(run)].filter(([tag]) => tag.startsWith('serving-')).map(([t, d]) => [d, t]),
  );
  log(`Provider dry run would delete ${versions.length} api version(s):`);
  for (const v of versions) log(`  ${v}${serving.has(v) ? `  PROTECTED (${serving.get(v)})` : ''}`);
  const overlap = versions.filter((v) => serving.has(v));
  if (overlap.length)
    throw new Error(
      `Provider verdict would delete ${overlap.length} image(s) holding a serving- tag; do not go live`,
    );
  log('No image holding a serving- tag is in the provider verdict.');
  return { verified: true, versions };
}

export function runCleanup({
  mode,
  confirm,
  run = gcloud,
  log = console.log,
  now = Date.now(),
  policyPath = POLICY_PATH,
  pin = pinProductionImages,
} = {}) {
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  if (mode === 'live' && confirm !== LIVE_CONFIRMATION)
    throw new Error(`Live deletion requires the confirmation phrase ${LIVE_CONFIRMATION}`);
  if (mode === 'verdict') return providerVerdict({ run, log });
  const policies = validateCleanupPolicy(JSON.parse(readFileSync(policyPath, 'utf8')));
  log(`${policyPath}: ${policies.length} valid rules (${policies.map((p) => p.name).join(', ')})`);
  if (mode === 'validate') return { policies };

  // Move serving tags to the current releases before judging what the policy would remove.
  const { protectedDigests } = pin({ run, log });
  const before = describeRepository(run);
  const size = Number(before.sizeBytes);
  log(`Repository size: ${Number.isFinite(size) ? `${gib(size)} (${size} bytes)` : 'unavailable'}`);
  log(
    `Installed policy: ${before.cleanupPolicyDryRun === true ? 'dry run' : 'live deletion'}; ` +
      `rules ${
        Object.keys(before.cleanupPolicies ?? {})
          .sort()
          .join(', ') || '(none)'
      }`,
  );
  const versions = parseImages(
    JSON.parse(
      run('artifacts', 'docker', 'images', 'list', IMAGE, '--include-tags', '--format=json'),
    ),
  );
  const verdicts = evaluateCleanupPolicy(policies, versions, now);
  const listed = new Set(versions.map((v) => v.version));
  const unlisted = protectedDigests.filter((d) => !listed.has(d));
  if (unlisted.length)
    throw new Error(`Protected images missing from the version listing: ${unlisted.join(', ')}`);
  const unsafe = verdicts.filter((v) => v.deleted && protectedDigests.includes(v.version));
  if (unsafe.length)
    throw new Error(
      `Policy would delete protected images: ${unsafe.map((v) => v.version).join(', ')}`,
    );

  const doomed = verdicts.filter((v) => v.deleted).sort((a, b) => a.createTime - b.createTime);
  log(
    `Versions in ${IMAGE}: ${versions.length}; protected serving/rollback images: ${protectedDigests.length}`,
  );
  log(
    `Would delete now under ${policyPath}: ${doomed.length} version(s), listed sizes total ${gib(
      doomed.reduce((n, v) => n + v.sizeBytes, 0),
    )} (upper bound: layers are shared)`,
  );
  for (const v of doomed)
    log(
      `  ${v.version}  created ${new Date(v.createTime).toISOString().slice(0, 10)}  ${gib(v.sizeBytes)}  tags ${v.tags.join(',') || '-'}`,
    );
  const kept = new Map();
  for (const v of verdicts.filter((v) => !v.deleted))
    for (const name of v.keepBy.length ? v.keepBy : ['not matched by a Delete rule'])
      kept.set(name, (kept.get(name) ?? 0) + 1);
  log(
    `Kept: ${versions.length - doomed.length} version(s); by rule: ${[...kept].map(([k, n]) => `${k}=${n}`).join(', ')}`,
  );
  if (mode === 'report') return { policies, verdicts, protectedDigests };

  try {
    run(
      'artifacts',
      'repositories',
      'set-cleanup-policies',
      ...REPO_SCOPE,
      `--policy=${policyPath}`,
      mode === 'live' ? '--no-dry-run' : '--dry-run',
      '--quiet',
    );
  } catch (error) {
    throw new Error(
      `set-cleanup-policies failed; installing needs artifactregistry.repositories.update on the ` +
        `declutrmail repository (see docs/ops/cost-efficiency.md): ${String(error.stderr || error.message).trim()}`,
      { cause: error },
    );
  }
  verifyInstalled(describeRepository(run), policies, mode);
  log(
    mode === 'live'
      ? 'Installed with deletion ENABLED. Artifact Registry applies it in a background job within about a day.'
      : 'Installed in dry-run mode. Nothing is deleted; review the audit-log verdict after about a day.',
  );
  return { policies, verdicts, protectedDigests };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode =
    process.argv.find((a) => a.startsWith('--mode='))?.slice('--mode='.length) ?? 'validate';
  runCleanup({ mode, confirm: process.env.CLEANUP_CONFIRM });
}
