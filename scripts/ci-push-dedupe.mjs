/**
 * Push-to-main CI may skip its suite only when a successful merge_group
 * run already validated this identical SHA. A squash merge produces a
 * different SHA, so this stays a no-op until the queued commit is the
 * commit that lands. Needs Chintan's policy OK before it is treated as
 * accepted. A lookup error fails closed toward the full suite.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function matchingMergeGroupSuccess(sha, runs) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return false;
  return (runs ?? []).some(
    (run) =>
      run?.event === 'merge_group' &&
      run.status === 'completed' &&
      run.conclusion === 'success' &&
      run.headSha === sha,
  );
}

export function shouldShortCircuit({ event, sha, ref, runs, lookupError }) {
  if (event !== 'push') return false;
  if (lookupError) return false;
  if (ref !== 'refs/heads/main') return false;
  return matchingMergeGroupSuccess(sha, runs);
}

function lookup(sha) {
  try {
    const raw = execFileSync(
      'gh',
      [
        'run',
        'list',
        '--repo',
        process.env.REPO,
        '--workflow',
        'CI',
        '--commit',
        sha,
        '--event',
        'merge_group',
        '--limit',
        '20',
        '--json',
        'event,status,conclusion,headSha',
      ],
      { encoding: 'utf8' },
    );
    return { runs: JSON.parse(raw), lookupError: false };
  } catch {
    return { runs: [], lookupError: true };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.CI_EVENT !== 'push') {
    console.log('false');
  } else {
    const sha = process.env.SHA ?? '';
    const { runs, lookupError } = lookup(sha);
    console.log(
      shouldShortCircuit({
        event: 'push',
        sha,
        ref: 'refs/heads/main',
        runs,
        lookupError,
      })
        ? 'true'
        : 'false',
    );
  }
}
