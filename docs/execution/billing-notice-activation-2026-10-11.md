# Approved notice activation after private runtime proof

Root owns the workflow switch and this record. The founder already approved
provider receipts/invoices and cancellation/pause emails, with app emails for
access deadlines and grant expiry. This activation depends on merged #925, #948,
#952 and #955. It does not authorize live refund restoration or checkout cutover.

## Confirmed prerequisite

[Main CI 38121718414](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38121718414)
and the full notices-OFF
[release 38121718422](https://github.com/CT2689-Tech/DeclutrMail/actions/runs/38121718422)
passed for `bc26bdc496bdcc8a4fc9f0325b927587cc2b38b8`. The candidate-image private
probe passed both queue actor protocols and verified owned execution/job cleanup.
Worker rollout and exact serving verification preceded API rollout.

Fresh local Cloud Run readback at `2026-10-11T07:43:05.293789Z` found API
`declutrmail-api-00614-xox` and worker `declutrmail-worker-00162-btj`, each serving
100%. Direct revision reads confirmed Ready, the exact source above, notices OFF,
the fixed `2026-10-11T03:15:41.000Z` cutoff and refund restoration unset/default OFF.
Both resolved to immutable digest
`sha256:6bd13f58c982606d16e875c0bf59679a89293863434335e003b01441f59a700b`.

Earlier private-probe failures remain failed. Newly restored local logging
showed the older checker reached its generic catch refusal, but did not establish
its cause. This later successful observation is not evidence that a particular
broker, IAM, memory or shutdown defect was fixed.

## Activation scope and verification

Only the manifest notice flag changes to true; the first enrollment cutoff stays
fixed. The same private dual-protocol proof, immutable source/identity, terminal
execution and verified cleanup gates remain required for the activation release.
The worker deploys first; both services must prove one 100% serving revision with
the exact release, flag and cutoff. Automatic upgrade-refund restoration stays
OFF and new INR purchases remain paused.

Root passed 45 helper/deployment tests, formatting and diff checks. Independent
review passed 60 helper/deployment and notice tests plus 16 actual serving-script
controls. No application TypeScript changes or provider financial writes are
included. The single authorized synthetic email was already delivered; no second
synthetic test email or manufactured production billing event is part of this activation.

This source record does not itself establish notices-ON serving proof. The normal
merge queue, exact-main CI, complete activation release and fresh source/traffic,
flag/cutoff and immutable-image readback must all pass before reporting activation.
The failed checkout-revocation rehearsal and its retained deletion holds remain
separate, as recorded in #957.
