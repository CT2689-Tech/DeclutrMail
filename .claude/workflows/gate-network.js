// gate-network — fan out the CLAUDE.md §7 gate agents across a diff.
//
// Replaces the sequential "run each applicable gate by hand" step before a
// merge recommendation. Routing mirrors the §7 table exactly and each gate
// keeps its own charter.
//
// Every agent() call sets `model` explicitly — never omitted. The gates are
// pinned to `opus` to match what their own .claude/agents/<name>.md frontmatter
// declares; if a gate definition changes tier, change it here in the same edit
// or the two silently disagree. The refuters are `opus` because adversarial
// verification is the one stage where a cheaper tier buys nothing: its whole
// job is to be harder to fool than the finder that produced the claim.
//
// Gates report; they never fix. This workflow inherits that: it returns
// findings, writes nothing, and posts nothing to GitHub.
//
// Usage:
//   Workflow({ name: 'gate-network' })                        // origin/main...HEAD
//   Workflow({ name: 'gate-network', args: { diffRef: 'abc123^..abc123' } })
//   Workflow({ name: 'gate-network', args: { files: ['apps/api/src/...'] } })

export const meta = {
  name: 'gate-network',
  description: 'Run the applicable DeclutrMail gate agents over a diff, then adversarially verify every BLOCKING finding',
  whenToUse: 'Before recommending merge on a PR that touches more than one workspace package, or any PR touching Gmail data, migrations, or webhooks.',
  phases: [
    { title: 'Scout', detail: 'resolve the diff ref to a changed-file list' },
    { title: 'Gates', detail: 'each in-scope gate agent reviews the diff (models per agent definition)' },
    { title: 'Verify', detail: 'two adversarial refuters per BLOCKING finding' },
  ],
}

const DEFAULT_REF = 'origin/main...HEAD'

// Routing mirrors CLAUDE.md §7. `tier` drives the merge verdict: a BLOCKING
// finding from a GATE tier blocks; advisory findings never do.
const GATES = [
  { type: 'privacy-auditor',           tier: 'gate',     when: /^(apps\/api\/src\/(gmail|messages|senders)\/|packages\/db\/src\/schema\/(mail-messages|senders)\.ts$)/ },
  { type: 'architecture-guardian',     tier: 'gate',     when: /^(apps\/api\/|packages\/(db|workers|events)\/)/ },
  { type: 'schema-migration-reviewer', tier: 'gate',     when: /^packages\/db\/(migrations\/|src\/schema\/)/ },
  { type: 'design-system-agent',       tier: 'gate',     when: /^(apps\/web\/src\/(components|features|app)\/|packages\/shared\/)|\.stories\.tsx$/ },
  { type: 'webhook-security-auditor',  tier: 'gate',     when: /^apps\/api\/src\/webhooks\/|-webhook\.controller\.ts$/ },
  { type: 'typescript-reviewer',       tier: 'advisory', when: /\.tsx?$/ },
  { type: 'silent-failure-hunter',     tier: 'advisory', when: /\.ts$/ },
  { type: 'flow-completeness-auditor', tier: 'advisory', when: /^apps\/web\/src\/features\// },
]

// Global cap on how many BLOCKING findings get the adversarial pass (2 refuters
// each), so a noisy gate cannot blow the agent budget. Shared across gates
// because the alternative — a per-gate cap — multiplies by the gate count.
// Anything past the cap is reported UNVERIFIED, never dropped silently
// (CLAUDE.md §8 / LEARNINGS "blind guard" class).
const VERIFY_BUDGET = 4
let verifyBudget = VERIFY_BUDGET

const SCOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files'],
  properties: {
    files: { type: 'array', items: { type: 'string' }, description: 'Repo-relative changed paths' },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['inScope', 'findings'],
  properties: {
    inScope: { type: 'boolean', description: 'false if the gate judged the diff out of its charter' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'file', 'summary'],
        properties: {
          severity: { enum: ['BLOCKING', 'WARNING', 'INFO'] },
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string', description: 'One sentence: the defect itself' },
          evidence: { type: 'string', description: 'The code or absence that proves it' },
        },
      },
    },
    stopCondition: {
      type: 'string',
      description: 'Set only if the gate hit a CLAUDE.md §9 stop condition needing the founder',
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
}

// `args` arrives as a parsed object when passed as a JSON value, but as a raw
// string when the caller (or harness) stringifies it — in which case a bare
// `args.diffRef` is silently undefined and the run falls back to the default
// ref. That failure is invisible: it looks like a clean diff. Normalize both.
let input = args ?? {}
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch {
    throw new Error(`gate-network: args was an unparseable string: ${input.slice(0, 120)}`)
  }
}

const diffRef = input.diffRef ?? DEFAULT_REF

phase('Scout')
let files = input.files
if (!files) {
  const scouted = await agent(
    `Run \`git diff --name-only ${diffRef}\` in the repo root and return the changed paths.\n` +
      `Return paths exactly as git prints them (repo-relative). Do not read or review the files.\n` +
      `If the command errors or the diff is empty, return an empty array.`,
    { label: 'scout:changed-files', phase: 'Scout', schema: SCOUT_SCHEMA, model: 'haiku', effort: 'low' },
  )
  files = scouted?.files ?? []
}

if (files.length === 0) {
  log(`No changed files for ${diffRef} — nothing to gate.`)
  return { diffRef, files: [], gatesRun: [], findings: [], verdict: 'NO_DIFF' }
}

const applicable = GATES.filter((g) => files.some((f) => g.when.test(f)))
const skipped = GATES.filter((g) => !applicable.includes(g)).map((g) => g.type)
log(`${files.length} changed files → ${applicable.length} gates: ${applicable.map((g) => g.type).join(', ')}`)
if (skipped.length) log(`Out of scope, not run: ${skipped.join(', ')}`)

// The gate charters tell each agent to post PR comments and set status checks.
// Inside this workflow they are pure reviewers — the caller decides what to do
// with the findings.
const chargeFor = (g) =>
  `Review the diff \`${diffRef}\` per your charter in .claude/agents/${g.type}.md.\n\n` +
  `Get the diff with \`git diff ${diffRef}\` and read whatever surrounding files you need for context.\n\n` +
  `Changed files:\n${files.map((f) => `- ${f}`).join('\n')}\n\n` +
  `Overrides for this run:\n` +
  `- Do NOT post PR comments, set status checks, or write to MISTAKES.md. Return findings only.\n` +
  `- Do NOT propose or apply fixes.\n` +
  `- If the diff is outside your charter, set inScope=false with an empty findings array.\n` +
  `- Every finding needs a concrete file and the evidence that proves it. A finding you cannot\n` +
  `  point at in the diff is not a finding — omit it.\n` +
  `- If you hit a CLAUDE.md §9 stop condition, set stopCondition and still return your findings.`

const refutePrompt = (g, f) =>
  `A ${g.type} review of the diff \`${diffRef}\` produced this BLOCKING finding:\n\n` +
  `  file: ${f.file}${f.line ? `:${f.line}` : ''}\n` +
  `  title: ${f.title}\n` +
  `  summary: ${f.summary}\n` +
  `  evidence: ${f.evidence ?? '(none given)'}\n\n` +
  `Your job is to REFUTE it. Read the actual code at that path and the diff itself.\n` +
  `Refute if: the cited code does not say what the finding claims, the path or line does not exist,\n` +
  `the pattern is already handled elsewhere, or the rule it invokes does not apply to this surface.\n` +
  `Do NOT refute merely because the finding is hard to verify — say so in the reason and set refuted=false.\n` +
  `Set refuted=true only when you can name the specific thing the finding got wrong.`

phase('Gates')
const reviews = await pipeline(
  applicable,
  (g) => agent(chargeFor(g), { agentType: g.type, label: g.type, phase: 'Gates', model: 'opus', schema: FINDINGS_SCHEMA }),
  (review, g) => {
    const found = (review?.findings ?? []).map((f) => ({ ...f, gate: g.type, tier: g.tier }))
    const blocking = found.filter((f) => f.severity === 'BLOCKING')
    const toVerify = blocking.slice(0, Math.max(0, verifyBudget))
    verifyBudget -= toVerify.length
    if (blocking.length > toVerify.length) {
      log(
        `${g.type}: ${blocking.length - toVerify.length} BLOCKING finding(s) past the global verify budget ` +
          `(${VERIFY_BUDGET}) — reported UNVERIFIED, not dropped`,
      )
    }
    const rest = found
      .filter((f) => !toVerify.includes(f))
      .map((f) => ({ ...f, verification: f.severity === 'BLOCKING' ? 'UNVERIFIED_CAPPED' : 'NOT_APPLICABLE' }))

    return parallel(
      toVerify.map((f) => () =>
        parallel([
          () => agent(refutePrompt(g, f), { label: `refute:${f.file}`, phase: 'Verify', model: 'opus', schema: VERDICT_SCHEMA }),
          () => agent(refutePrompt(g, f), { label: `refute2:${f.file}`, phase: 'Verify', model: 'opus', schema: VERDICT_SCHEMA }),
        ]).then((votes) => {
          const cast = votes.filter(Boolean)
          // Conservative: demote only on unanimous refutation by both refuters.
          // A refuter that died leaves the finding standing.
          const refuted = cast.length === 2 && cast.every((v) => v.refuted)
          return {
            ...f,
            verification: refuted ? 'REFUTED' : 'CONFIRMED',
            severity: refuted ? 'WARNING' : f.severity,
            refutations: cast.map((v) => v.reason),
          }
        }),
      ),
    ).then((verified) => ({
      gate: g.type,
      tier: g.tier,
      inScope: review?.inScope ?? false,
      stopCondition: review?.stopCondition,
      findings: [...verified.filter(Boolean), ...rest],
    }))
  },
)

const ran = reviews.filter(Boolean)
const died = applicable.filter((g) => !ran.some((r) => r.gate === g.type)).map((g) => g.type)
if (died.length) log(`Gates that returned nothing (treat as NOT run): ${died.join(', ')}`)

const findings = ran.flatMap((r) => r.findings)
const blockers = findings.filter((f) => f.severity === 'BLOCKING' && f.tier === 'gate')
const stops = ran.filter((r) => r.stopCondition).map((r) => ({ gate: r.gate, stopCondition: r.stopCondition }))

log(
  `${findings.length} findings — ${blockers.length} confirmed gate blocker(s), ` +
    `${findings.filter((f) => f.verification === 'REFUTED').length} refuted, ${stops.length} stop condition(s)`,
)

return {
  diffRef,
  files,
  gatesRun: ran.map((r) => r.gate),
  gatesSkipped: skipped,
  gatesFailed: died,
  stopConditions: stops,
  findings,
  // Structural only. CLAUDE.md §8: green gates are NOT a smoke.
  verdict: died.length ? 'INCOMPLETE' : blockers.length ? 'BLOCKED' : 'NO_BLOCKERS',
}
