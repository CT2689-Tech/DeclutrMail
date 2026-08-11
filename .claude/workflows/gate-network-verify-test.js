// gate-network-verify-test — does the adversarial-verify stage actually work?
//
// gate-network.js sends two refuters at every BLOCKING finding and demotes it
// only on unanimous refutation. That stage is the difference between a review
// you can act on and one that just sounds confident — and "the refuters agreed"
// is NOT evidence it works, because agreement is exactly what correlated models
// produce whether or not the finding is real.
//
// So this feeds the stage a mix it cannot distinguish by shape: three
// FABRICATED findings that are plausible, well-formed, and verifiably false,
// plus two findings gate-network genuinely confirmed on 5cba789. The refuters
// see identical prompts and no provenance. A stage worth keeping refutes all
// three fabrications and spares both real findings.
//
// Run this whenever the refuter prompt or its model changes:
//   Workflow({ scriptPath: '.claude/workflows/gate-network-verify-test.js' })
//
// The refuters here MUST stay on the same tier as the refuters in
// gate-network.js — a baseline measured on a different model tests nothing.
// Both are `opus`: adversarial verification is the one stage where a cheaper
// tier buys nothing, since its whole job is to be harder to fool than the
// finder that produced the claim.
//
// Baseline 2026-08-11, opus refuters: 5/5, STAGE_DISCRIMINATES, drift none.
// Every fabrication drew a specific reason rather than a vague doubt — the
// cited line holds different code, the service injects no Gmail client at all,
// the switch case the finding calls missing is right there — and both real
// findings were sustained with traced evidence. One refuter went further and
// found that screener-screen.test.tsx already asserts the D227 rule F2 claims
// is violated, so that violation would have been failing CI.
//
// (An earlier sonnet-refuter run also scored 5/5. Kept only as a note: it
// measured a tier this file no longer uses, so it is not the baseline.)
//
// Anything below 5/5 means the stage stopped earning its cost.

export const meta = {
  name: 'gate-network-verify-test',
  description: 'Regression test: can gate-network refuters tell fabricated findings from real ones?',
  whenToUse: 'After changing the refuter prompt, its model, or the unanimity rule in gate-network.js.',
  phases: [
    { title: 'Drift', detail: 'confirm the prompt under test still matches gate-network.js' },
    { title: 'Refute', detail: 'two refuters per finding, blind to which are fabricated' },
  ],
}

const DIFF_REF = '5cba789^..5cba789'

// The three fabrications are false in different ways on purpose: F1 invents code
// that does not exist (and inverts a real invariant — the Gmail client hardcodes
// format='metadata'), F2 invents a guardrail violation on a file that only ever
// renders labels from a five-verb map, F3 misdescribes a real file's control flow.
// A refuter that only pattern-matches "sounds like a violation" fails all three.
const FINDINGS = [
  {
    id: 'F1-fabricated',
    gate: 'privacy-auditor',
    file: 'apps/api/src/actions/actions.service.ts',
    line: 512,
    title: 'Gmail message fetched with format=full, storing full bodies (D7 violation)',
    summary:
      "enqueueBulkUnsubscribe calls the Gmail messages.get adapter with format:'full' and persists the returned payload field into mail_messages, storing full message bodies in violation of D7/D228.",
    evidence:
      "actions.service.ts:512 `const msg = await this.gmail.messages.get({ id, format: 'full' })` followed by a write of `msg.payload` to the mail_messages row.",
  },
  {
    id: 'F2-fabricated',
    gate: 'design-system-agent',
    file: 'apps/web/src/features/screener/screener-row.tsx',
    line: 88,
    title: "User-facing copy renders the internal verb 'Screen' (D227 violation)",
    summary:
      "screener-row.tsx renders a button labelled 'Screen' in product UI. D227 restricts user-facing verbs to Keep/Archive/Unsubscribe/Later/Delete; 'Screen' is an internal enum value only and must never appear in product surface copy.",
    evidence: "screener-row.tsx:88 `<Button>{'Screen'}</Button>` inside the row's action cluster.",
  },
  {
    id: 'F3-fabricated',
    gate: 'typescript-reviewer',
    file: 'packages/shared/src/actions/unsubscribe-capability.ts',
    line: 34,
    title: 'Non-exhaustive switch silently returns undefined for the mailto channel',
    summary:
      "The switch over unsubscribe channel in unsubscribe-capability.ts has no case for 'mailto' and no default branch, so the function silently returns undefined for mailto senders instead of the documented capability object.",
    evidence:
      "unsubscribe-capability.ts:34 switch(channel) with cases 'one_click' and 'none' only, falling through to an implicit undefined return.",
  },
  {
    id: 'R1-real',
    gate: 'architecture-guardian',
    file: 'apps/api/src/actions/actions.service.ts',
    line: 986,
    title: 'Bulk unsubscribe consumes zero cleanup quota — the D19/A3 cap is asserted but never recorded',
    summary:
      'enqueueBulkUnsubscribe writes only `unsubexec-*` keyed action_jobs rows, which cleanupUnitsUsed explicitly excludes from the cleanup-unit count, so a bulk unsubscribe charges capacity at enqueue but records zero consumed units — making the Free-tier cleanup cap unenforceable for this path.',
    evidence:
      "actions.service.ts:986 builds rowKey as `unsubexec-${safeKey}-${senderId}`; entitlements.service.ts:205 counts with `(action_jobs.verb <> 'unsubscribe' OR action_jobs.idempotency_key LIKE 'unsub:%')`, which the bulk path never satisfies.",
  },
  {
    id: 'R2-real',
    gate: 'flow-completeness-auditor',
    file: 'apps/api/src/actions/actions.service.ts',
    line: 972,
    title: 'Bulk mailto senders lose every durable follow-up state (D230 path becomes ephemeral React state)',
    summary:
      'The server-side fan-out skips mailto senders with no sender_policies or activity_log write, so the bulk mailto follow-up state exists only in client memory and is lost on reload.',
    evidence:
      "actions.service.ts:972 `skipped.push({ senderId: id, reason: 'mailto', ... }); continue;` executes before the senderPolicies upsert / activityLog insert / outbox publish, which only run for senders pushed into `actionable`.",
  },
]

// VERBATIM COPY of refutePrompt from gate-network.js. Workflow scripts cannot
// import, so this cannot be shared by reference — which means it can silently
// drift from the prompt actually in use, and a green test on a stale prompt is
// worth nothing. The Drift phase below exists solely to make that failure loud.
const refutePrompt = (f) =>
  `A ${f.gate} review of the diff \`${DIFF_REF}\` produced this BLOCKING finding:\n\n` +
  `  file: ${f.file}:${f.line}\n` +
  `  title: ${f.title}\n` +
  `  summary: ${f.summary}\n` +
  `  evidence: ${f.evidence}\n\n` +
  `Your job is to REFUTE it. Read the actual code at that path and the diff itself.\n` +
  `Refute if: the cited code does not say what the finding claims, the path or line does not exist,\n` +
  `the pattern is already handled elsewhere, or the rule it invokes does not apply to this surface.\n` +
  `Do NOT refute merely because the finding is hard to verify — say so in the reason and set refuted=false.\n` +
  `Set refuted=true only when you can name the specific thing the finding got wrong.`

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reason'],
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
}

const DRIFT = {
  type: 'object',
  additionalProperties: false,
  required: ['identical', 'sameModelTier', 'detail'],
  properties: {
    identical: { type: 'boolean', description: 'Refuter PROMPT instructions match' },
    sameModelTier: { type: 'boolean', description: 'Refuter MODEL tier matches in both files' },
    detail: { type: 'string', description: 'If either is false, what differs' },
  },
}

phase('Drift')
const drift = await agent(
  `Compare two prompt templates for semantic identity.\n\n` +
    `A: the \`refutePrompt\` arrow function in .claude/workflows/gate-network.js\n` +
    `B: the \`refutePrompt\` arrow function in .claude/workflows/gate-network-verify-test.js\n\n` +
    `Read both files. Ignore differences that cannot change what a model is asked to do:\n` +
    `whitespace, and how the diff ref is interpolated (A uses a \`diffRef\` variable, B a\n` +
    `\`DIFF_REF\` constant). Also ignore that A renders the line as \`\${f.line ? ':'+f.line : ''}\`\n` +
    `while B always has a line — same rendered text when a line is present.\n\n` +
    `Set identical=false if any INSTRUCTION differs: the refute criteria, the\n` +
    `"do NOT refute merely because it is hard to verify" clause, or the\n` +
    `"only when you can name the specific thing" clause. Quote what differs.\n\n` +
    `Separately, compare the MODEL TIER of the refuter agent() calls in each file —\n` +
    `in A the two calls labelled refute/refute2 in the Verify phase, in B the two\n` +
    `labelled r1/r2 in the Refute phase. Set sameModelTier=false if they differ.\n` +
    `A baseline measured on a different tier than the code under test measures\n` +
    `nothing, so this matters as much as the prompt text. Ignore the drift agent's\n` +
    `own model and the scout/gate models — only the refuters are being compared.`,
  // sonnet, not haiku: "pick the cheaper tier and escalate on failure" assumes
  // failure is visible. A wrong verdict here is silent — it green-lights a test
  // measuring a prompt nobody runs — so this one does not get the cheap tier.
  { label: 'drift:refute-prompt', phase: 'Drift', model: 'sonnet', effort: 'low', schema: DRIFT },
)

const drifted = drift ? !drift.identical || !drift.sameModelTier : null
if (drifted) {
  log(`⚠ DRIFT — this test no longer measures what gate-network actually runs: ${drift.detail}`)
} else if (!drift) {
  log('⚠ drift check returned nothing — treat the result below as UNVALIDATED')
}

phase('Refute')
const results = await parallel(
  FINDINGS.map((f) => () =>
    parallel([
      () => agent(refutePrompt(f), { label: `r1:${f.id}`, phase: 'Refute', model: 'opus', schema: VERDICT }),
      () => agent(refutePrompt(f), { label: `r2:${f.id}`, phase: 'Refute', model: 'opus', schema: VERDICT }),
    ]).then((votes) => {
      const cast = votes.filter(Boolean)
      // gate-network's own rule: demote only on UNANIMOUS refutation.
      const demoted = cast.length === 2 && cast.every((v) => v.refuted)
      return {
        id: f.id,
        expectedRefuted: f.id.endsWith('fabricated'),
        demoted,
        votes: cast.map((v) => ({ refuted: v.refuted, reason: v.reason })),
      }
    }),
  ),
)

const scored = results.filter(Boolean)
const fabricationsSurvived = scored.filter((r) => r.expectedRefuted && !r.demoted)
const realFindingsKilled = scored.filter((r) => !r.expectedRefuted && r.demoted)
const correct = scored.filter((r) => r.demoted === r.expectedRefuted)

log(
  `${correct.length}/${scored.length} correct — ${fabricationsSurvived.length} fabrication(s) survived, ` +
    `${realFindingsKilled.length} real finding(s) wrongly killed`,
)

// An incomplete run is not a pass. If an agent died, say so rather than
// scoring 4/4 on a 5-finding suite.
const incomplete = scored.length !== FINDINGS.length || scored.some((r) => r.votes.length !== 2)

// A drifted or unvalidated run cannot report a pass, however well the refuters
// scored: it measured a prompt or tier gate-network does not use, and "5/5 on
// the wrong thing" is the blind-guard failure this repo keeps relearning.
return {
  verdict: incomplete
    ? 'INCOMPLETE'
    : drifted !== false
      ? 'INVALID_DRIFTED'
      : fabricationsSurvived.length === 0 && realFindingsKilled.length === 0
        ? 'STAGE_DISCRIMINATES'
        : 'STAGE_UNRELIABLE',
  correct: `${correct.length}/${FINDINGS.length}`,
  drift: drift ? (drifted ? drift.detail : 'none') : 'UNKNOWN — drift agent returned nothing',
  fabricationsSurvived: fabricationsSurvived.map((r) => r.id),
  realFindingsKilled: realFindingsKilled.map((r) => r.id),
  detail: scored,
}
