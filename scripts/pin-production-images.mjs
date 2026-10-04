/** Keep serving images addressable when the registry removes old build artifacts. */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PROJECT = 'declutrmail-ai-prod';
const IMAGE = `us-central1-docker.pkg.dev/${PROJECT}/declutrmail/api`;
const SERVICES = [
  ['declutrmail-api', 'us-central1'],
  ['declutrmail-worker', 'us-west1'],
];
const gcloud = (...args) =>
  execFileSync('gcloud', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });

export function servingRevisions(service) {
  const traffic = service.status?.traffic;
  if (!Array.isArray(traffic) || traffic.reduce((n, t) => n + (t.percent ?? 0), 0) !== 100)
    throw new Error('Cannot establish complete serving traffic; refusing retention update');
  const names = traffic.filter((t) => t.percent > 0 || t.tag).map((t) => t.revisionName);
  if (
    !names.length ||
    names.some((n) => typeof n !== 'string' || !/^declutrmail-(api|worker)-[a-z0-9-]+$/.test(n))
  )
    throw new Error('Unknown serving revision');
  return [...new Set(names)].sort();
}

export function retentionTag(revision) {
  if (!/^declutrmail-(api|worker)-[a-z0-9-]+$/.test(revision)) throw new Error('Unknown revision');
  // Additive protection: never move a tag away from an earlier known-good release.
  return `${IMAGE}:retain-${revision}`;
}

export function pinProductionImages({ run = gcloud, log = console.log } = {}) {
  // Resolve every source before mutating tags, so incomplete discovery fails closed.
  const pins = SERVICES.flatMap(([name, region]) => {
    const service = JSON.parse(
      run(
        'run',
        'services',
        'describe',
        name,
        `--region=${region}`,
        `--project=${PROJECT}`,
        '--format=json',
      ),
    );
    return servingRevisions(service).map((revision) => {
      const value = JSON.parse(
        run(
          'run',
          'revisions',
          'describe',
          revision,
          `--region=${region}`,
          `--project=${PROJECT}`,
          '--format=json',
        ),
      );
      const digest = value.status?.imageDigest;
      if (
        typeof digest !== 'string' ||
        !digest.startsWith(`${IMAGE}@sha256:`) ||
        !/sha256:[a-f0-9]{64}$/.test(digest)
      )
        throw new Error('Serving revision has an unexpected image');
      return { digest, tag: retentionTag(revision), revision };
    });
  });
  const packageName = `projects/${PROJECT}/locations/us-central1/repositories/declutrmail/packages/api`;
  const readTags = () => {
    const entries = JSON.parse(
      run(
        'artifacts',
        'docker',
        'tags',
        'list',
        IMAGE,
        '--filter=tag:retain-',
        '--format=json(tag,version)',
      ),
    );
    if (!Array.isArray(entries)) throw new Error('Cannot establish existing retention tags');
    const tags = new Map();
    for (const { tag, version } of entries) {
      const name =
        typeof tag === 'string' && tag.startsWith(`${packageName}/tags/`)
          ? tag.slice(`${packageName}/tags/`.length)
          : '';
      if (
        !/^retain-declutrmail-(api|worker)-[a-z0-9-]+$/.test(name) ||
        typeof version !== 'string' ||
        !version.startsWith(`${packageName}/versions/sha256:`) ||
        !/sha256:[a-f0-9]{64}$/.test(version) ||
        tags.has(name)
      )
        throw new Error('Unexpected retention tag metadata');
      tags.set(name, `${IMAGE}@${version.slice(`${packageName}/versions/`.length)}`);
    }
    return tags;
  };
  const existing = readTags();
  // Validate all conflicts before writing. A retention tag must never move.
  for (const pin of pins) {
    const digest = existing.get(`retain-${pin.revision}`);
    if (digest && digest !== pin.digest)
      throw new Error(`Retention tag conflicts with ${pin.revision}`);
  }
  for (const pin of pins) {
    if (!existing.has(`retain-${pin.revision}`)) {
      // Create-only API: even a concurrent writer cannot cause an overwrite.
      run(
        'artifacts',
        'tags',
        'create',
        `retain-${pin.revision}`,
        '--location=us-central1',
        '--repository=declutrmail',
        '--package=api',
        `--project=${PROJECT}`,
        `--version=${pin.digest.slice(`${IMAGE}@`.length)}`,
        '--quiet',
      );
    }
  }
  const verified = readTags();
  for (const pin of pins) {
    if (verified.get(`retain-${pin.revision}`) !== pin.digest)
      throw new Error(`Retention tag readback failed for ${pin.revision}`);
  }
  for (const pin of pins) log(`Protected ${pin.revision}`);
  return pins;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  pinProductionImages();
