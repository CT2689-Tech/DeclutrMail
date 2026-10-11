/**
 * Deploy wait decision. A successful push CI run deploys, including one
 * that short-circuited because the identical SHA already passed in the
 * merge queue. A merge_group success alone does not: the caller still
 * queries `--event push`.
 */
import { pathToFileURL } from 'node:url';

export function awaitCiDecision({ event, superseded, status, conclusion }) {
  if (event === 'workflow_dispatch') return 'deploy';
  if (superseded === true || superseded === 'true') return 'skip';
  if (status === 'completed' && conclusion === 'success') return 'deploy';
  if (status === 'completed') return 'refuse';
  return 'wait';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const decision = awaitCiDecision({
    event: process.env.EVENT_NAME,
    superseded: process.env.SUPERSEDED,
    status: process.env.STATUS,
    conclusion: process.env.CONCLUSION,
  });
  if (!['deploy', 'skip', 'refuse', 'wait'].includes(decision)) {
    console.error(`Unexpected deploy decision: ${decision}`);
    process.exitCode = 1;
  } else {
    console.log(decision);
  }
}
