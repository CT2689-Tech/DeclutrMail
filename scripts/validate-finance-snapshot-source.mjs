/** Only completed main-branch vendor runs may supply privileged finance imports. */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function validateSnapshotSource(run, runId) {
  if (!/^[1-9][0-9]*$/.test(runId ?? '') || String(run.id) !== runId)
    throw new Error('Snapshot run ID mismatch');
  if (
    run.path !== '.github/workflows/vendor-limits-watchdog.yml' ||
    run.head_branch !== 'main' ||
    run.head_repository?.full_name !== 'CT2689-Tech/DeclutrMail' ||
    !['schedule', 'workflow_dispatch'].includes(run.event) ||
    run.status !== 'completed'
  )
    throw new Error('Snapshot provenance not trusted');
  // A completed failed run can contain valid observations: vendor breaches are
  // intentionally failures, while collection and artifact retention continue.
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const id = process.env.SNAPSHOT_RUN_ID;
    if (!/^[1-9][0-9]*$/.test(id ?? '')) throw new Error('Invalid run ID');
    const run = JSON.parse(
      execFileSync('gh', ['api', `repos/CT2689-Tech/DeclutrMail/actions/runs/${id}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      }),
    );
    validateSnapshotSource(run, id);
    console.log('Snapshot source verified: completed main-branch vendor workflow.');
  } catch {
    console.error('Snapshot provenance verification failed; no finance import permitted.');
    process.exitCode = 1;
  }
}
