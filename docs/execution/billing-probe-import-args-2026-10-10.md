# Private probe CLI argument correction

The billing private probe and newer email-preference preflight failed before
producer deployment. Prior failed releases/diagnostics and the denied audit-log
read remain preserved in their execution records; no IAM repair is inferred.

On 2026-10-10, root reproduced the exact Jobs Create argument vector offline,
adding only gcloud's read-only help flag. The local CLI exited 2 with:

> argument --args: "--import" cannot be specified multiple times

The list parser rejects repeated argument values before any provider request.
Using distinct Node options, --import=@sentry/node/import and
--import=@swc-node/register/esm-register, made the same read-only help check
exit 0. Node loaded both actual modules with that syntax successfully. This
is a reproduced command defect; actual job access, broker compatibility,
execution and cleanup still need the next main-only diagnostic's proof.

Change only the probe argument vector and strengthen its existing execution
contract test to reject duplicate list values. Keep immutable source, runtime
identity, minimal secret binding, deadlines, resource ownership, terminal reads
and cleanup gates intact. No actor check, producer flag, enrollment cutoff or
runtime billing behavior is relaxed. App notices remain OFF; refund restoration
remains OFF; no IAM, provider payment or security-policy write is included.

Root owns this isolated import-argument fix and integration. PR #947 changes the
same helper's failure projection and separate test cases; the argument/test
hunks are disjoint. Both candidates use normal queue integration. No branch is
updated solely because main advanced, and no required check is bypassed.
