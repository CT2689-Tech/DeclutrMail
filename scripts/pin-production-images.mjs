/** Keep serving and recent rollback images addressable when the registry removes old build artifacts. */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PROJECT = 'declutrmail-ai-prod';
export const IMAGE = `us-central1-docker.pkg.dev/${PROJECT}/declutrmail/api`;
const PACKAGE = `projects/${PROJECT}/locations/us-central1/repositories/declutrmail/packages/api`;
export const ROLLBACK_SLOTS = 5;
export const ROUTE_SLOTS = 4;
// Each source gets a fixed set of `serving-<role>*` tags that move to its current digests.
// A worker pool is read through the same v1 Run API, so moving the worker is a one-line change:
//   { role: 'worker', kind: 'workerPool', name: 'declutrmail-worker-pool', region: 'us-west1' }
export const SOURCES = [
  { role: 'api', kind: 'service', name: 'declutrmail-api', region: 'us-central1' },
  { role: 'worker', kind: 'service', name: 'declutrmail-worker', region: 'us-west1' },
];
const KINDS = {
  service: {
    describe: (name) => ['run', 'services', 'describe', name],
    revisions: (name) => ['run', 'revisions', 'list', `--service=${name}`],
    splits: (resource) => resource.status?.traffic,
  },
  workerPool: {
    describe: (name) => ['run', 'worker-pools', 'describe', name],
    revisions: (name) => ['run', 'worker-pools', 'revisions', 'list', `--worker-pool=${name}`],
    splits: (resource) => resource.status?.instanceSplits,
  },
};
const REVISION = /^declutrmail-(api|worker)-[a-z0-9-]+$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SLOT = /^serving-(api|worker)(-route-[1-9]|-rollback-[1-9])?$/;
const gcloud = (...args) =>
  execFileSync('gcloud', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });

/** Serving revisions, primary (highest share) first, including tagged zero-percent routes. */
export function servingRevisions(resource, kind = 'service') {
  const splits = KINDS[kind].splits(resource);
  if (!Array.isArray(splits) || splits.reduce((n, t) => n + (t.percent ?? 0), 0) !== 100)
    throw new Error('Cannot establish complete serving traffic; refusing retention update');
  const routes = splits.filter((t) => t.percent > 0 || t.tag);
  if (
    !routes.length ||
    routes.some((t) => typeof t.revisionName !== 'string' || !REVISION.test(t.revisionName))
  )
    throw new Error('Unknown serving revision');
  const share = new Map();
  for (const t of routes)
    share.set(t.revisionName, (share.get(t.revisionName) ?? 0) + (t.percent ?? 0));
  return [...share].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

export function retentionTag(revision) {
  if (!REVISION.test(revision)) throw new Error('Unknown revision');
  // Additive record: never move a tag away from an earlier known-good release.
  return `${IMAGE}:retain-${revision}`;
}

function imageDigest(revision) {
  const value = revision.status?.imageDigest;
  if (typeof value !== 'string' || !value.startsWith(`${IMAGE}@`)) return null;
  const digest = value.slice(`${IMAGE}@`.length);
  return DIGEST.test(digest) ? digest : null;
}

/** The newest distinct images deployed before the primary serving revision, excluding live ones. */
export function rollbackDigests(revisions, primary, live) {
  const created = (r) => Date.parse(r.metadata?.creationTimestamp ?? '');
  const head = revisions.find((r) => r.metadata?.name === primary);
  if (!head || Number.isNaN(created(head)))
    throw new Error(`Cannot establish deployment history before ${primary}`);
  const digests = [];
  for (const r of revisions
    .filter((r) => created(r) < created(head))
    .sort((a, b) => created(b) - created(a))) {
    const digest = imageDigest(r);
    if (digest && !live.includes(digest) && !digests.includes(digest)) digests.push(digest);
  }
  return digests.slice(0, ROLLBACK_SLOTS);
}

/** Every slot always names a current image, so no slot can strand an old build. */
export function releaseSlots(role, live, rollbacks) {
  const [primary, ...routes] = live;
  if (!primary) throw new Error(`No serving image for ${role}`);
  if (routes.length > ROUTE_SLOTS)
    throw new Error(
      `${role} has more live routes than protected slots; refusing partial protection`,
    );
  const slots = [[`serving-${role}`, primary]];
  for (let i = 1; i <= ROUTE_SLOTS; i++)
    slots.push([`serving-${role}-route-${i}`, routes[i - 1] ?? primary]);
  for (let i = 1; i <= ROLLBACK_SLOTS; i++)
    slots.push([`serving-${role}-rollback-${i}`, rollbacks[i - 1] ?? primary]);
  return slots.map(([tag, digest]) => ({ tag, digest }));
}

function readRelease(source, run) {
  const kind = KINDS[source.kind];
  if (!kind) throw new Error(`Unknown release source kind ${source.kind}`);
  const scope = [`--region=${source.region}`, `--project=${PROJECT}`, '--format=json'];
  const revisions = JSON.parse(run(...kind.revisions(source.name), ...scope));
  if (!Array.isArray(revisions)) throw new Error(`Cannot list revisions of ${source.name}`);
  const serving = servingRevisions(
    JSON.parse(run(...kind.describe(source.name), ...scope)),
    source.kind,
  ).map((revision) => {
    if (!revision.startsWith(`${source.name}-`)) throw new Error('Unknown serving revision');
    const value = revisions.find((r) => r.metadata?.name === revision);
    const digest = value && imageDigest(value);
    if (!digest) throw new Error('Serving revision has an unexpected image');
    return { revision, digest };
  });
  const live = [...new Set(serving.map((s) => s.digest))];
  const rollbacks = rollbackDigests(revisions, serving[0].revision, live);
  return { source, serving, rollbacks, slots: releaseSlots(source.role, live, rollbacks) };
}

function readTags(run) {
  const entries = JSON.parse(
    run('artifacts', 'docker', 'tags', 'list', IMAGE, '--format=json(tag,version)'),
  );
  if (!Array.isArray(entries)) throw new Error('Cannot establish existing retention tags');
  const tags = new Map();
  for (const { tag, version } of entries) {
    const name =
      typeof tag === 'string' && tag.startsWith(`${PACKAGE}/tags/`)
        ? tag.slice(`${PACKAGE}/tags/`.length)
        : '';
    const managed = /^retain-declutrmail-(api|worker)-[a-z0-9-]+$/.test(name) || SLOT.test(name);
    if (!managed) continue;
    const digest =
      typeof version === 'string' && version.startsWith(`${PACKAGE}/versions/`)
        ? version.slice(`${PACKAGE}/versions/`.length)
        : '';
    if (!DIGEST.test(digest) || tags.has(name))
      throw new Error('Unexpected retention tag metadata');
    tags.set(name, digest);
  }
  return tags;
}

export function pinProductionImages({ run = gcloud, log = console.log, sources = SOURCES } = {}) {
  // Resolve every source before mutating tags, so incomplete discovery fails closed.
  const releases = sources.map((source) => readRelease(source, run));
  const retained = releases.flatMap((r) =>
    r.serving.map(({ revision, digest }) => ({ revision, digest, tag: retentionTag(revision) })),
  );
  const slots = releases.flatMap((r) => r.slots);
  if (new Set(slots.map((s) => s.tag)).size !== slots.length)
    throw new Error('Two release sources share a role');
  const existing = readTags(run);
  // Validate all conflicts before writing. A retention tag must never move.
  for (const pin of retained) {
    const digest = existing.get(`retain-${pin.revision}`);
    if (digest && digest !== pin.digest)
      throw new Error(`Retention tag conflicts with ${pin.revision}`);
  }
  const scope = [
    '--location=us-central1',
    '--repository=declutrmail',
    '--package=api',
    `--project=${PROJECT}`,
  ];
  for (const pin of retained) {
    if (!existing.has(`retain-${pin.revision}`))
      // Create-only API: even a concurrent writer cannot cause an overwrite.
      run(
        'artifacts',
        'tags',
        'create',
        `retain-${pin.revision}`,
        ...scope,
        `--version=${pin.digest}`,
        '--quiet',
      );
  }
  // Oldest slot first: shifting history right never leaves a still-wanted image without a tag.
  // Moving a tag is `tags update` (artifactregistry.tags.update); no tag is ever deleted.
  for (const slot of [...slots].reverse()) {
    const current = existing.get(slot.tag);
    if (current === slot.digest) continue;
    run(
      'artifacts',
      'tags',
      current ? 'update' : 'create',
      slot.tag,
      ...scope,
      `--version=${slot.digest}`,
      '--quiet',
    );
  }
  const verified = readTags(run);
  for (const pin of retained) {
    if (verified.get(`retain-${pin.revision}`) !== pin.digest)
      throw new Error(`Retention tag readback failed for ${pin.revision}`);
  }
  for (const slot of slots) {
    if (verified.get(slot.tag) !== slot.digest)
      throw new Error(`Serving tag readback failed for ${slot.tag}`);
  }
  for (const r of releases)
    log(
      `Protected ${r.source.name}: serving ${r.serving.map((s) => s.revision).join(', ')}; ` +
        `${r.rollbacks.length} rollback image(s)`,
    );
  return { retained, slots, protectedDigests: [...new Set(slots.map((s) => s.digest))] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  pinProductionImages();
