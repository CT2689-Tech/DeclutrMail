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

export function pinProductionImages() {
  // Resolve every source before mutating tags, so incomplete discovery fails closed.
  const pins = SERVICES.flatMap(([name, region]) => {
    const service = JSON.parse(
      gcloud(
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
        gcloud(
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
  for (const pin of pins) {
    gcloud('artifacts', 'docker', 'tags', 'add', pin.digest, pin.tag, '--quiet');
    console.log(`Protected ${pin.revision}`);
  }
  return pins;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  pinProductionImages();
