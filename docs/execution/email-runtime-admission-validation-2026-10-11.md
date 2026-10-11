# Email admission validation correction

Root owns this follow-up to the OFF foundation in PR #974, merged as
`1f90672962024998bd1293e12a3d5f09a8c137e8`. “Validate this” retains the managed
fleet, retirement and release integration boundary. No manifest or production
flag is changed.

An extra owned Redis control reproduced a structural validation mismatch after
the foundation's queue passed: the strict reader refused an actor with the
correct protocol and a future expiry but missing required fields, while actual
claim admission accepted it. A second real BullMQ control inserted that malformed
record after claim admission and before the final delivery boundary; the old
BEGIN script still called the synthetic provider and completed the job. The
first reproduction failed one test; the expanded reproduction failed ten. These
failures are retained, not reclassified as successful checks.

Claim admission and atomic pre-send BEGIN now share the full actor validator.
It checks UUID boot keys, exact six-field records, worker revision and source
formats, boolean capability/readiness values, integer broker-time expiry within
the allowed lease bound, and the expected protocol. Renewal/publication also
refuse a malformed owned actor rather than normalizing it into a valid record.
Malformed, expired or incompatible data refuses admission. This validates data
shape only: source authorization and complete legacy retirement still require
the independently verified adoption boundary.

Nine real Redis controls cover missing/extra fields, invalid capability and
readiness types, source/revision formats, future/fractional expiry and invalid
boot keys. The late-insertion BullMQ control now leaves the exact job delayed
with zero attempts consumed, creates no delivery marker, and makes no provider
call. The existing success, uncertain-send retention, polling-loss and real-I/O
shutdown controls must also pass. Local startup ECONNREFUSED warnings from the
owned Redis fixture remain in the original logs; they were not suppressed or
treated as production observations. Exact check counts and source identity are
recorded in the PR handoff before normal queue integration.

The serving foundation remains disabled while this correction is reviewed.
Service-only identity, worker-pool refusal, expired settlement holds, queue
retention and the absence of an authenticated production witness remain as
described in the [foundation record](email-runtime-admission-foundation-2026-10-11.md).
Neither a passing local control nor this follow-up merge certifies production
fleet adoption. The full runtime probe repair remains open.
