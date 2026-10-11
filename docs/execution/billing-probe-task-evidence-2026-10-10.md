# Private probe runtime evidence

PR #948 corrected a reproduced local CLI parser defect. Main-only diagnostic
#38118665413, source `7bbed6c25f8e35c8c97d2038379ea4317e6edaf7`, subsequently failed
at `jobs_execute`; its owned-resource recovery reported `probeDeleted: true`.
The sanitized failure named no missing IAM permission. The failed audit read and
earlier parser failures remain separate evidence.

An isolated local import succeeded. The actual standalone Node process also
passed against one owned, compatible local Redis actor and exited naturally in
1.43 seconds. Its Redis server and actor were stopped. These observations do not
explain the cloud failure or verify the production broker. Memory pressure is a
hypothesis; no production memory limit or compatibility predicate is changed.

The authenticated built-in Logs Explorer opened the exact private probe filter,
but its query returned an unknown operation error. This is an unavailable read,
not proof of absent logs. No logging role or other IAM grant was made.

Root owns this follow-up helper, its contract tests and this record in an isolated
worktree. Before deleting a failed owned execution, read at most two task status
records for that exact execution with a 30-second command deadline. Require one
structured task result to project numeric exit/signal/status codes, timestamp
presence, fixed condition names and fixed error hints. Never forward raw task
messages, arbitrary reasons, container/environment fields or secret values.

Unavailable or malformed metadata stays unavailable. Successful probes need no
new read. Every existing compatibility, immutable-source, runtime-identity,
ownership and cleanup predicate remains intact; diagnostic evidence cannot clear
rollout. The same main-only workflow is used after normal merge, retaining its
existing pinned image and private runtime identity. Real task evidence is pending
that controlled run. App notices and automatic refund restoration remain OFF;
new INR purchases remain paused. The locally prepared notice activation stays
unpublished until runtime proof and a full dual-protocol OFF release pass.
