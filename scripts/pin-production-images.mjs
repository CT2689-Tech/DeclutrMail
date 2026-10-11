/** Keep serving and recent rollback images addressable when the registry removes old build artifacts. */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PROJECT = 'declutrmail-ai-prod';
export const IMAGE = `us-central1-docker.pkg.dev/${PROJECT}/declutrmail/api`;
const PACKAGE = `projects/${PROJECT}/locations/us-central1/repositories/declutrmail/packages/api`;
export const ROLLBACK_SLOTS = 5;
export const ROUTE_SLOTS = 4;
export const JOB_SLOTS = 4;
// Each writer owns one namespace and is serialized with itself: the deploy workflow under the
// release lock, the reconciler (schedule, cleanup and rollback runs) under its own lock. A
// writer can never move another writer's tags, so a stale run cannot undo a newer one.
export const NAMESPACES = { deploy: 'serving-', observed: 'serving-observed-' };
// The disabled legacy worker service stays a source: it is the worker pool's rollback path.
// When the pool becomes a deploy target, mark it required (a test reads the deploy workflow).
export const SOURCES = [
  { role: 'api', kind: 'service', name: 'declutrmail-api', region: 'us-central1', required: true },
  {
    role: 'worker',
    kind: 'service',
    name: 'declutrmail-worker',
    region: 'us-west1',
    required: true,
  },
  {
    role: 'worker-pool',
    kind: 'workerPool',
    name: 'declutrmail-worker-pool',
    region: 'us-west1',
    required: false,
  },
];
// Images a workflow runs by a fixed tag instead of a release.
export const PINNED = [
  {
    name: 'pinned-billing-probe',
    source: 'bc26bdc496bdcc8a4fc9f0325b927587cc2b38b8',
    workflow: '.github/workflows/billing-queue-access-diagnosis.yml',
  },
];
const KINDS = {
  service: {
    describe: (name) => ['run', 'services', 'describe', name],
    revisions: (name) => ['run', 'revisions', 'list', `--service=${name}`],
    shift: (name, revision) => [
      'run',
      'services',
      'update-traffic',
      name,
      `--to-revisions=${revision}=100`,
    ],
    splits: (resource) => resource.status?.traffic,
    absent: /Cannot find service \[/,
  },
  workerPool: {
    describe: (name) => ['run', 'worker-pools', 'describe', name],
    revisions: (name) => ['run', 'worker-pools', 'revisions', 'list', `--worker-pool=${name}`],
    shift: (name, revision) => [
      'run',
      'worker-pools',
      'update-instance-split',
      name,
      `--to-revisions=${revision}=100`,
    ],
    splits: (resource) => resource.status?.instanceSplits,
    absent: /Cannot find worker pool \[/,
  },
};
const REVISION = /^declutrmail-(api|worker)-[a-z0-9-]+$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
// deploy-api-safely.mjs stages candidates at 0% behind a `verify-` tag until their smoke passes.
const VERIFICATION_TAG = /^verify-/;
const gcloud = (...args) =>
  execFileSync('gcloud', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });

/**
 * Every traffic destination, primary (highest share) first. `served` is false for a
 * destination reachable only through a verification tag: it is protected, but it has not
 * served users and must not count as a known-good rollback.
 */
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
  const byName = new Map();
  for (const t of routes) {
    const r = byName.get(t.revisionName) ?? { revision: t.revisionName, percent: 0, served: false };
    r.percent += t.percent ?? 0;
    r.served ||= t.percent > 0 || !VERIFICATION_TAG.test(t.tag ?? '');
    byName.set(t.revisionName, r);
  }
  return [...byName.values()].sort(
    (a, b) => b.percent - a.percent || a.revision.localeCompare(b.revision),
  );
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

/**
 * The newest distinct images deployed before the primary serving revision, excluding live ones.
 * Revisions that served traffic (`served`, known from their retain- tags) come first, so a
 * candidate that failed its smoke and never took traffic cannot displace a known-good image.
 */
export function rollbackDigests(revisions, primary, live, served = new Set()) {
  const created = (r) => Date.parse(r.metadata?.creationTimestamp ?? '');
  const head = revisions.find((r) => r.metadata?.name === primary);
  if (!head || Number.isNaN(created(head)))
    throw new Error(`Cannot establish deployment history before ${primary}`);
  const earlier = revisions
    .filter((r) => created(r) < created(head))
    .sort((a, b) => created(b) - created(a));
  const digests = [];
  for (const r of [
    ...earlier.filter((r) => served.has(r.metadata?.name)),
    ...earlier.filter((r) => !served.has(r.metadata?.name)),
  ]) {
    const digest = imageDigest(r);
    if (digest && !live.includes(digest) && !digests.includes(digest)) digests.push(digest);
  }
  return digests.slice(0, ROLLBACK_SLOTS);
}

/** Every slot always names a current image, so no slot can strand an old build. */
export function releaseSlots(role, live, rollbacks, prefix = NAMESPACES.deploy) {
  const [primary, ...routes] = live;
  if (!primary) throw new Error(`No serving image for ${role}`);
  if (routes.length > ROUTE_SLOTS)
    throw new Error(
      `${role} has more live routes than protected slots; refusing partial protection`,
    );
  const slots = [[`${prefix}${role}`, primary]];
  for (let i = 1; i <= ROUTE_SLOTS; i++)
    slots.push([`${prefix}${role}-route-${i}`, routes[i - 1] ?? primary]);
  for (let i = 1; i <= ROLLBACK_SLOTS; i++)
    slots.push([`${prefix}${role}-rollback-${i}`, rollbacks[i - 1] ?? primary]);
  return slots.map(([tag, digest]) => ({ tag, digest }));
}

/** The exact set of serving- tags the pin owns. Anything else under `serving-` is unknown. */
export function managedTags(sources = SOURCES, pinned = PINNED) {
  const names = new Set();
  for (const prefix of Object.values(NAMESPACES)) {
    for (const { role } of sources)
      for (const { tag } of releaseSlots(role, ['x'], [], prefix)) names.add(tag);
    for (let i = 1; i <= JOB_SLOTS; i++) names.add(`${prefix}job-${i}`);
    for (const p of pinned) names.add(`${prefix}${p.name}`);
    names.add(`${prefix}spare`);
  }
  return names;
}

const errorText = (error) => String(error?.stderr || error?.message || error);

function readServing(source, run) {
  const kind = KINDS[source.kind];
  if (!kind) throw new Error(`Unknown release source kind ${source.kind}`);
  const scope = [`--region=${source.region}`, `--project=${PROJECT}`, '--format=json'];
  let resource;
  try {
    resource = JSON.parse(run(...kind.describe(source.name), ...scope));
  } catch (error) {
    // Only a definite "does not exist" may skip an optional source; anything else fails closed.
    if (!source.required && kind.absent.test(errorText(error))) return null;
    throw error;
  }
  const serving = servingRevisions(resource, source.kind);
  if (serving.some((s) => !s.revision.startsWith(`${source.name}-`)))
    throw new Error('Unknown serving revision');
  return { scope, serving };
}

function readRelease(source, run, tags) {
  const current = readServing(source, run);
  if (!current) return null;
  const kind = KINDS[source.kind];
  const revisions = JSON.parse(run(...kind.revisions(source.name), ...current.scope));
  if (!Array.isArray(revisions)) throw new Error(`Cannot list revisions of ${source.name}`);
  const serving = current.serving.map((s) => {
    const value = revisions.find((r) => r.metadata?.name === s.revision);
    const digest = value && imageDigest(value);
    if (!digest) throw new Error('Serving revision has an unexpected image');
    return { ...s, digest };
  });
  const live = [...new Set(serving.map((s) => s.digest))];
  const served = new Set(
    revisions
      .map((r) => r.metadata?.name)
      .filter((name) => typeof name === 'string' && tags.has(`retain-${name}`)),
  );
  const rollbacks = rollbackDigests(revisions, serving[0].revision, live, served);
  return { source, serving, live, revisions, rollbacks };
}

/** Images referenced by any Cloud Run job template in any region, by digest or by tag. */
export function jobImages(jobs, tags) {
  if (!Array.isArray(jobs)) throw new Error('Cannot list Cloud Run jobs');
  const refs = new Set();
  const walk = (value) => {
    if (typeof value === 'string') {
      if (value.startsWith(`${IMAGE}@`) || value.startsWith(`${IMAGE}:`)) refs.add(value);
    } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(jobs);
  const digests = new Set();
  const unresolved = [];
  for (const ref of refs) {
    const digest = ref.startsWith(`${IMAGE}@`)
      ? ref.slice(IMAGE.length + 1)
      : tags.get(ref.slice(IMAGE.length + 1));
    if (digest && DIGEST.test(digest)) digests.add(digest);
    else unresolved.push(ref);
  }
  return { digests: [...digests].sort(), unresolved };
}

/** Every tag on the api package as name → digest; managed names are parsed strictly. */
export function readTags(run) {
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
    const digest =
      typeof version === 'string' && version.startsWith(`${PACKAGE}/versions/`)
        ? version.slice(`${PACKAGE}/versions/`.length)
        : '';
    const managed =
      /^retain-declutrmail-(api|worker)-[a-z0-9-]+$/.test(name) || name.startsWith('serving-');
    if (managed && (!DIGEST.test(digest) || tags.has(name)))
      throw new Error('Unexpected retention tag metadata');
    if (name && DIGEST.test(digest)) tags.set(name, digest);
  }
  return tags;
}

/**
 * Order tag writes so no write removes the last serving- tag of an image that is still
 * wanted: a slot moves only once its current image is unwanted or also held by another
 * serving- tag. When only cycles remain (slots swapping images), one cycle member's image is
 * first parked on the spare tag; that write is always safe, so there is never a gap. The
 * spare ends on `spareTarget`.
 */
export function writeOrder(slots, existing, spare, spareTarget) {
  const state = new Map(existing);
  const wanted = new Set([...slots.map((s) => s.digest), spareTarget]);
  const holders = (digest) =>
    [...state].filter(([t, d]) => d === digest && t.startsWith('serving-')).length;
  const safe = (tag) => {
    const current = state.get(tag);
    return !current || !wanted.has(current) || holders(current) > 1;
  };
  const order = [];
  const write = (tag, digest) => {
    order.push({ tag, digest, existed: state.has(tag) });
    state.set(tag, digest);
  };
  const pending = slots.filter((s) => state.get(s.tag) !== s.digest);
  while (pending.length) {
    const ready = pending.findIndex((s) => safe(s.tag));
    if (ready >= 0) {
      const [slot] = pending.splice(ready, 1);
      write(slot.tag, slot.digest);
    } else if (safe(spare)) write(spare, state.get(pending[0].tag));
    else throw new Error('No gap-free tag order; refusing to move serving tags');
  }
  if (state.get(spare) !== spareTarget) {
    if (!safe(spare)) throw new Error('No gap-free tag order; refusing to move serving tags');
    write(spare, spareTarget);
  }
  return order;
}

export function pinProductionImages({
  run = gcloud,
  log = console.log,
  namespace,
  sources = SOURCES,
  pinned = PINNED,
  hold,
} = {}) {
  const prefix = NAMESPACES[namespace];
  if (!prefix) throw new Error(`--namespace must be one of ${Object.keys(NAMESPACES).join(', ')}`);
  // Resolve everything before mutating tags, so incomplete discovery fails closed.
  const existing = readTags(run);
  const releases = [];
  for (const source of sources) {
    const release = readRelease(source, run, existing);
    if (release) releases.push(release);
    else log(`${source.name} does not exist; nothing to protect for ${source.role}`);
  }
  if (!releases.length) throw new Error('No release source found');
  const retained = releases.flatMap((r) =>
    r.serving
      .filter((s) => s.served)
      .map(({ revision, digest }) => ({ revision, digest, tag: retentionTag(revision) })),
  );
  const jobs = jobImages(
    JSON.parse(run('run', 'jobs', 'list', `--project=${PROJECT}`, '--format=json')),
    existing,
  );
  const primary = releases[0].live[0];
  const deferred = [];
  if (jobs.unresolved.length)
    deferred.push(`job image references not in the registry: ${jobs.unresolved.join(', ')}`);
  if (jobs.digests.length > JOB_SLOTS)
    deferred.push(`${jobs.digests.length} job images exceed ${JOB_SLOTS} job slots`);
  const missing = pinned.filter(
    (p) => !existing.has(`${prefix}${p.name}`) && !existing.has(p.source),
  );
  for (const p of missing) deferred.push(`${prefix}${p.name} (source tag ${p.source} not found)`);
  const slots = [
    ...releases.flatMap((r) => releaseSlots(r.source.role, r.live, r.rollbacks, prefix)),
    ...Array.from({ length: JOB_SLOTS }, (_, i) => ({
      tag: `${prefix}job-${i + 1}`,
      digest: jobs.digests[i] ?? primary,
    })),
    ...pinned
      .filter((p) => !missing.includes(p))
      // Follow the image the workflow names; keep the last pin if that tag is gone.
      .map((p) => ({
        tag: `${prefix}${p.name}`,
        digest: existing.get(p.source) ?? existing.get(`${prefix}${p.name}`),
      })),
  ];
  if (new Set(slots.map((s) => s.tag)).size !== slots.length)
    throw new Error('Two release sources share a role');
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
  const spare = { tag: `${prefix}spare`, digest: hold ?? primary };
  // Moving a tag is `tags update` (artifactregistry.tags.update); no tag is ever deleted.
  for (const write of writeOrder(slots, existing, spare.tag, spare.digest))
    run(
      'artifacts',
      'tags',
      write.existed ? 'update' : 'create',
      write.tag,
      ...scope,
      `--version=${write.digest}`,
      '--quiet',
    );
  const verified = readTags(run);
  for (const pin of retained) {
    if (verified.get(`retain-${pin.revision}`) !== pin.digest)
      throw new Error(`Retention tag readback failed for ${pin.revision}`);
  }
  for (const slot of [...slots, spare]) {
    if (verified.get(slot.tag) !== slot.digest)
      throw new Error(`Serving tag readback failed for ${slot.tag}`);
  }
  // A traffic change while this ran may have made an unprotected image current.
  for (const r of releases) {
    const now = readServing(r.source, run);
    const live = now && [...new Set(now.serving.map((s) => s.revision))].join();
    if (live !== r.serving.map((s) => s.revision).join())
      throw new Error(`${r.source.name} serving state changed during the pin; run it again`);
  }
  const managed = managedTags(sources, pinned);
  const unknown = [...verified.keys()].filter((t) => t.startsWith('serving-') && !managed.has(t));
  if (unknown.length)
    log(
      `::warning::Unknown serving- tags keep their images forever; delete them with an admin ` +
        `account: ${unknown.join(', ')}`,
    );
  for (const r of releases)
    log(
      `Protected ${r.source.name}: serving ${r.serving.map((s) => s.revision).join(', ')}; ` +
        `${r.rollbacks.length} rollback image(s)`,
    );
  log(`Protected ${jobs.digests.length} Cloud Run job image(s)`);
  if (deferred.length)
    throw new Error(`Cannot pin ${deferred.join('; ')}; every other image is protected`);
  const servingTags = new Map([...verified].filter(([t]) => t.startsWith('serving-')));
  return {
    retained,
    slots,
    unknown,
    servingTags,
    protectedDigests: [...new Set(servingTags.values())],
  };
}

/**
 * The sanctioned rollback: protect the target image first, then move traffic, then re-pin.
 * A rollback done directly in Cloud Run is only protected once the reconciler next runs.
 */
export function rollbackTraffic({
  role,
  revision,
  run = gcloud,
  log = console.log,
  sources = SOURCES,
}) {
  const source = sources.find((s) => s.role === role);
  if (!source) throw new Error(`Unknown role ${role}`);
  if (!REVISION.test(revision ?? '') || !revision.startsWith(`${source.name}-`))
    throw new Error(`${revision} is not a revision of ${source.name}`);
  const kind = KINDS[source.kind];
  const scope = [`--region=${source.region}`, `--project=${PROJECT}`];
  const revisions = JSON.parse(run(...kind.revisions(source.name), ...scope, '--format=json'));
  const target = Array.isArray(revisions) && revisions.find((r) => r.metadata?.name === revision);
  const digest = target && imageDigest(target);
  if (!digest) throw new Error(`Cannot resolve the image of ${revision}`);
  const spare = `${NAMESPACES.observed}spare`;
  try {
    pinProductionImages({ run, log, namespace: 'observed', sources, hold: digest });
  } catch (error) {
    if (readTags(run).get(spare) !== digest)
      throw new Error(`Cannot protect ${revision} before rollback; traffic not moved`, {
        cause: error,
      });
    log(`::warning::${errorText(error)}`);
  }
  log(`Protected ${digest} on ${spare}; moving ${source.name} to ${revision}`);
  run(...kind.shift(source.name, revision), ...scope, '--quiet');
  return pinProductionImages({ run, log, namespace: 'observed', sources });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (arg('rollback-role'))
    rollbackTraffic({ role: arg('rollback-role'), revision: arg('rollback-revision') });
  else {
    const { unknown } = pinProductionImages({ namespace: arg('namespace') });
    // The reconciler is where stale tags get noticed; the deploy only warns.
    if (unknown.length && arg('namespace') === 'observed') process.exitCode = 1;
  }
}
