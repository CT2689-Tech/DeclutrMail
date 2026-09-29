// ct-gates — fan out the CLAUDE.md §7 gate agents across a diff.
//
// Replaces the sequential "run each applicable gate by hand" step before a
// merge recommendation. Routing follows the CLAUDE.md §7 table, taking paths
// from a gate's own charter where §7 names none, with one addition:
// silent-failure-hunter also reads scripts, hooks, workflows, watchdog
// acknowledgment lists and hook registrations, where this repo's watchdogs
// and guards live. Each gate keeps its own charter.
//
// Each gate the files route to ends in one outcome: reviewed, declined (the
// diff is outside its charter), unreadable (it could not read the diff) or
// died. Verdicts, first match wins:
//   SCOUT_FAILED       the changed files could not be listed
//   NO_DIFF            the diff lists no files (`checkedIn` says where)
//   NO_GATES_IN_SCOPE  no gate routes a changed file
//   INCOMPLETE         a gate died or could not read the diff
//   BLOCKED            a gate-tier BLOCKING finding the refuters did not refute
//   STOP_CONDITION     a gate hit a CLAUDE.md §9 stop condition
//   NO_GATES_IN_SCOPE  every gate that ran declined the diff
//   PARTIAL            a must-pass gate declined, or a changed file that is
//                      not prose was reviewed by no gate (`unreviewed`)
//   NO_BLOCKERS        every must-pass gate reviewed, every file that is not
//                      prose was reviewed by some gate, and no blocker
// Only NO_BLOCKERS is clean. Prose is .md outside .claude/ and CLAUDE.md
// (charters and commands decide what the gates do). An advisory gate that
// declines a file another gate reviewed is listed in gatesDeclined only.
// Agents run git; the scout and every gate echo the command they ran and
// this script compares it. That is the limit of what it can check: an agent
// that misreports its own command or its result passes. A scout that drops a
// git error reads as NO_DIFF; a gate that says it read a diff it saw only a
// preview of reads as reviewed.
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
//   Workflow({ name: 'ct-gates', args: { diffRef: 'origin/main...my-branch' } })
//   Workflow({ name: 'ct-gates', args: { diffRef: 'abc123^..abc123' } })
//   Workflow({ name: 'ct-gates', args: { diffRef: 'origin/main...my-branch', files: [...] } })
// diffRef is required: a range of two named sides, `<base>...<tip>` or
// `<base>..<tip>`. Agents may start in another checkout, so nothing that
// resolves against a checkout is accepted: HEAD in any case, @, @{...},
// FETCH_HEAD and the like, an empty side, or a single ref (which diffs a
// working tree). Branches and commits are the same in every checkout.
// `files`, when given, must match the diff exactly.

export const meta = {
  name: 'ct-gates',
  description: 'Run the applicable DeclutrMail gate agents over a diff, then adversarially verify every BLOCKING finding',
  whenToUse: 'Before recommending merge on a PR that touches more than one workspace package, or any PR touching Gmail data, migrations, or webhooks.',
  phases: [
    { title: 'Scout', detail: 'resolve the diff ref to a changed-file list' },
    { title: 'Gates', detail: 'each in-scope gate agent reviews the diff (models per agent definition)' },
    { title: 'Verify', detail: 'two adversarial refuters per BLOCKING finding' },
  ],
}

// Prose no gate reviews, by design: unrouted, listed, but not a coverage
// gap. Agent charters, commands and CLAUDE.md are not prose: they decide
// what the gates do.
const isProse = (f) => /\.md$/.test(f) && !/^\.claude\/|(^|\/)CLAUDE\.md$/.test(f)

// Routing mirrors CLAUDE.md §7. `tier` drives the merge verdict: a BLOCKING
// finding from a GATE tier blocks; advisory findings never do.
const GATES = [
  { type: 'privacy-auditor',           tier: 'gate',     when: /^(apps\/api\/src\/(gmail|messages|senders)\/|packages\/db\/src\/schema\/(mail-messages|senders)\.ts$)/ },
  { type: 'architecture-guardian',     tier: 'gate',     when: /^(apps\/api\/|packages\/(db|workers|events)\/)/ },
  { type: 'schema-migration-reviewer', tier: 'gate',     when: /^packages\/db\/(migrations\/|src\/schema\/)/ },
  { type: 'design-system-agent',       tier: 'gate',     when: /^(apps\/web\/src\/(components|features|app)\/|packages\/shared\/)|\.stories\.tsx$/ },
  { type: 'webhook-security-auditor',  tier: 'gate',     when: /^apps\/api\/src\/webhooks\/|-webhook\.controller\.ts$/ },
  { type: 'typescript-reviewer',       tier: 'advisory', when: /\.tsx?$/ },
  // §7's "all TS files" (.ts and .tsx), plus scripts, shell hooks, workflows,
  // the acknowledgment lists that mute watchdogs and the hook registrations:
  // the guard-that-cannot-fail class (§8) keeps recurring there, and before
  // this route a PR touching only those ran zero gates and came back
  // NO_BLOCKERS. The agent's charter covers the same paths.
  { type: 'silent-failure-hunter',     tier: 'advisory', when: /\.tsx?$|\.(mjs|cjs|js|sh)$|^\.github\/workflows\/|^\.husky\/|^scripts\/.*\.tsv$|^\.claude\/settings\.json$/ },
  { type: 'flow-completeness-auditor', tier: 'advisory', when: /^apps\/web\/src\/features\// },
  // §7: "any PR that changes user-facing copy" under these paths.
  { type: 'usability-editor',          tier: 'advisory', when: /^(apps\/web\/src\/features\/|packages\/shared\/src\/(actions|components|copy)\/)/ },
  // §7 says only "type-heavy files"; these are the paths its charter lists.
  { type: 'type-design-analyzer',      tier: 'advisory', when: /^(packages\/(events|workers)\/|apps\/api\/.*\/(dto|types|contracts)\/|apps\/web\/.*\/(types|domain)\/)/ },
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
  required: ['ran', 'toplevel', 'head', 'files', 'count'],
  properties: {
    ran: { type: 'string', description: 'The diff command you executed, verbatim' },
    count: { type: 'integer', description: 'The number that command piped to `wc -l` prints' },
    toplevel: { type: 'string', description: 'Output of `git rev-parse --show-toplevel`' },
    head: { type: 'string', description: 'Output of `git rev-parse --abbrev-ref HEAD`' },
    files: { type: 'array', items: { type: 'string' }, description: 'Repo-relative changed paths' },
    error: { type: 'string', description: 'Set only if the diff command failed: its error output' },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ran', 'diffRead', 'inScope', 'findings'],
  properties: {
    ran: { type: 'string', description: 'The `git diff` command you ran for this review, verbatim' },
    diffRead: {
      type: 'boolean',
      description: 'false if `git diff <ref>` failed or printed nothing; then return no findings',
    },
    diffError: { type: 'string', description: 'Set only if diffRead is false: what git printed' },
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
    throw new Error(`ct-gates: args was an unparseable string: ${input.slice(0, 120)}`)
  }
}

const diffRef = input.diffRef
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Exactly this git command, from any checkout (`git -C <dir>` or
// `cd <dir> &&`), and nothing after it: a trailing `| head`, `-- <path>` or
// `2>/dev/null` would change what the command shows.
const exactGit = (args) => new RegExp(`^(cd \\S+ && )?git( -C \\S+)? ${escapeRe(args)}$`)

// Refs that resolve against the checkout an agent starts in, which may not
// be the caller's: a diff of one can review the wrong branch and pass.
const checkoutRelative = (side) => !side || /^@([~^{].*)?$|(^|[/_])head([~^@{].*)?$/i.test(side)
const range = diffRef?.match(/^([^.\s]\S*?)\.\.\.?([^.\s]\S*)$/)
const refError = !diffRef
  ? 'pass diffRef naming the branch or commits, e.g. origin/main...my-branch'
  : !range || checkoutRelative(range[1]) || checkoutRelative(range[2])
    ? `diffRef ${diffRef} must be <base>...<tip> with both sides named; HEAD, @ or an empty side depend on the checkout an agent starts in`
    : null
if (refError) {
  log(`${refError}. SCOUT_FAILED is not a pass.`)
  return { diffRef, files: [], gatesRun: [], findings: [], error: refError, verdict: 'SCOUT_FAILED' }
}

phase('Scout')
let files
let checkedIn
{
  // --no-renames lists a moved file's old path too, so moving a file out of
  // a gate's paths still routes that gate.
  const command = `git diff --name-only --no-renames ${diffRef}`
  const scouted = await agent(
    `Run exactly \`${command}\`, then \`git rev-parse --show-toplevel\` and \`git rev-parse --abbrev-ref HEAD\`.\n` +
      `Do not change, correct or substitute the ref, even if it looks mistyped: its failure is the answer.\n` +
      `Return \`ran\` as the diff command you executed, verbatim; \`toplevel\` and \`head\` as git printed them;\n` +
      `and the changed paths exactly as git printed them. Then run \`${command} | wc -l\` and return its number\n` +
      `as \`count\`. If the diff command fails, put its error output in \`error\` and return an empty array.\n` +
      `Do not read or review the files.`,
    { label: 'scout:changed-files', phase: 'Scout', schema: SCOUT_SCHEMA, model: 'haiku', effort: 'low' },
  )
  // A failed git command, a dead scout or a scout that ran some other ref is
  // not an empty diff: NO_DIFF would read a mistyped ref as "nothing changed".
  const error = !scouted
    ? 'the scout agent returned nothing'
    : scouted.error?.trim()
      ? scouted.error
      : !exactGit(command.slice(4)).test(scouted.ran.trim())
        ? `the scout ran \`${scouted.ran}\`, not \`${command}\``
        : // A tool can show a long list as a preview. The count is too short
          // to be cut, so a list shorter than it was truncated.
          scouted.count !== scouted.files.length
          ? `the scout listed ${scouted.files.length} paths but the diff has ${scouted.count}`
          : // Only git's own form routes as intended: \`./x\`, \`a//b\` or a stray
            // space match the extension-only routes but no anchored must-pass one.
            scouted.files.some((f) => f !== f.trim() || f.split('/').some((seg) => ['', '.', '..'].includes(seg)))
            ? 'the scout returned paths not in git\'s repo-relative form, which the must-pass routes would not match'
            : null
  if (error) {
    log(`Could not list the changed files for ${diffRef}: ${error}. SCOUT_FAILED is not a pass.`)
    return { diffRef, files: [], gatesRun: [], findings: [], error, verdict: 'SCOUT_FAILED' }
  }
  files = scouted.files
  checkedIn = `${scouted.toplevel} (HEAD ${scouted.head})`
  // A list the caller passes routes the gates, so it must be the whole diff:
  // a file left out would route no gate and appear nowhere.
  if (input.files) {
    const missing = files.filter((f) => !input.files.includes(f))
    const extra = input.files.filter((f) => !files.includes(f))
    if (missing.length || extra.length) {
      const mismatch = `the files passed differ from ${diffRef}: missing [${missing.join(', ')}], not in the diff [${extra.join(', ')}]`
      log(`${mismatch}. SCOUT_FAILED is not a pass.`)
      return { diffRef, files, gatesRun: [], findings: [], error: mismatch, verdict: 'SCOUT_FAILED' }
    }
  }
}

if (files.length === 0) {
  log(`No changed files for ${diffRef} (checked in ${checkedIn}).`)
  return { diffRef, files: [], gatesRun: [], findings: [], checkedIn, verdict: 'NO_DIFF' }
}

const applicable = GATES.filter((g) => files.some((f) => g.when.test(f)))
const skipped = GATES.filter((g) => !applicable.includes(g)).map((g) => g.type)
log(`${files.length} changed files in ${checkedIn} → ${applicable.length} gates: ${applicable.map((g) => g.type).join(', ')}`)
if (skipped.length) log(`Out of scope, not run: ${skipped.join(', ')}`)

// No gate routes these. A gate that runs for another file may still read
// them, but nothing is charged with them.
const unrouted = files.filter((f) => !GATES.some((g) => g.when.test(f)))
if (unrouted.length) log(`No gate routes: ${unrouted.join(', ')}`)

// Zero gates is not zero findings. Returning NO_BLOCKERS here would make
// this a gate network that cannot fail (CLAUDE.md §8): nothing looked.
if (applicable.length === 0) {
  log(`No gate is in scope for ${files.length} changed file(s): nothing was reviewed. NO_GATES_IN_SCOPE is not a pass.`)
  return {
    diffRef,
    files,
    checkedIn,
    gatesRun: [],
    gatesSkipped: skipped,
    gatesFailed: [],
    unrouted,
    stopConditions: [],
    findings: [],
    verdict: 'NO_GATES_IN_SCOPE',
  }
}

// The gate charters tell each agent to post PR comments and set status checks.
// Inside this workflow they are pure reviewers — the caller decides what to do
// with the findings.
const chargeFor = (g) =>
  `Review the diff \`${diffRef}\` per your charter in .claude/agents/${g.type}.md.\n\n` +
  `Get the diff with \`git diff ${diffRef}\` and read whatever surrounding files you need for context.\n` +
  `Do not change or substitute the ref. If your tool shows only a preview of the output, read the saved\n` +
  `output in full before reviewing; if you cannot, set diffRead=false.\n` +
  `Return \`ran\` as that whole-diff command, verbatim, with no\n` +
  `options or paths (you may prefix it with \`git -C <dir>\` or \`cd <dir> &&\`).\n` +
  `If it fails or prints nothing, set diffRead=false, put what git printed in diffError, and return no\n` +
  `findings: a review of some other diff is not this one.\n\n` +
  `Changed files:\n${files.map((f) => `- ${f}`).join('\n')}\n\n` +
  `Overrides for this run:\n` +
  `- Do NOT post PR comments, set status checks, or write MISTAKES entries (docs/log/mistakes/ or MISTAKES.md). Return findings only.\n` +
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

// A gate that could not read the diff, or read anything but the whole diff of
// the asked ref (another ref, some paths only, no patch), did not review it.
const gateDiff = exactGit(`diff ${diffRef}`)
const readTheDiff = (review) => review?.diffRead !== false && gateDiff.test(review?.ran?.trim() ?? '')

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
          // A refuter that died leaves the finding standing, but unverified:
          // CONFIRMED means two refuters read it and could not refute it.
          const refuted = cast.length === 2 && cast.every((v) => v.refuted)
          if (cast.length < 2) log(`${g.type}: ${2 - cast.length} refuter(s) returned nothing for ${f.file}`)
          return {
            ...f,
            verification: refuted ? 'REFUTED' : cast.length === 2 ? 'CONFIRMED' : 'UNVERIFIED_REFUTER_FAILED',
            severity: refuted ? 'WARNING' : f.severity,
            refutations: cast.map((v) => v.reason),
          }
        }),
      ),
    ).then((verified) => ({
      gate: g.type,
      tier: g.tier,
      outcome: !readTheDiff(review) ? 'unreadable' : review?.inScope ? 'reviewed' : 'declined',
      diffError: readTheDiff(review) ? undefined : review?.diffError ?? `ran \`${review?.ran}\``,
      stopCondition: review?.stopCondition,
      findings: [...verified.filter(Boolean), ...rest],
    }))
  },
)

const ran = reviews.filter(Boolean)
const died = applicable.filter((g) => !ran.some((r) => r.gate === g.type)).map((g) => g.type)
if (died.length) log(`Gates that returned nothing (treat as NOT run): ${died.join(', ')}`)

// Only a gate that read the diff and judged it in its charter reviewed it.
const gatesWith = (outcome) => ran.filter((r) => r.outcome === outcome).map((r) => r.gate)
const reviewed = gatesWith('reviewed')
const declined = gatesWith('declined')
const unreadable = gatesWith('unreadable')
if (declined.length) log(`Declined the diff as outside their charter, so reviewed nothing: ${declined.join(', ')}`)
if (unreadable.length) {
  const why = ran.filter((r) => r.outcome === 'unreadable').map((r) => `${r.gate} (${r.diffError ?? 'no output'})`)
  log(`Could not read the diff ${diffRef}, so reviewed nothing: ${why.join(', ')}`)
}

// Coverage is per file: a file is reviewed if some gate it routes to
// reviewed. A must-pass gate that declined leaves its charter unchecked.
const unreviewed = files.filter((f) => !isProse(f) && !GATES.some((g) => g.when.test(f) && reviewed.includes(g.type)))
const mustPassDeclined = declined.filter((type) => GATES.find((g) => g.type === type).tier === 'gate')
if (unreviewed.length) log(`Reviewed by no gate: ${unreviewed.join(', ')}`)

const findings = ran.flatMap((r) => r.findings)
const blockers = findings.filter((f) => f.severity === 'BLOCKING' && f.tier === 'gate')
const stops = ran.filter((r) => r.stopCondition).map((r) => ({ gate: r.gate, stopCondition: r.stopCondition }))

log(
  `${findings.length} findings — ${blockers.length} gate blocker(s) ` +
    `(${blockers.filter((f) => f.verification === 'CONFIRMED').length} confirmed), ` +
    `${findings.filter((f) => f.verification === 'REFUTED').length} refuted, ${stops.length} stop condition(s)`,
)

return {
  diffRef,
  files,
  checkedIn,
  gatesRun: ran.map((r) => r.gate),
  gatesSkipped: skipped,
  gatesFailed: died,
  gatesUnreadable: unreadable,
  gatesDeclined: declined,
  unrouted,
  unreviewed,
  stopConditions: stops,
  findings,
  // Structural only. CLAUDE.md §8: green gates are NOT a smoke.
  verdict:
    died.length || unreadable.length
      ? 'INCOMPLETE'
      : blockers.length
        ? 'BLOCKED'
        : stops.length
          ? 'STOP_CONDITION'
          : reviewed.length === 0
            ? 'NO_GATES_IN_SCOPE'
            : mustPassDeclined.length || unreviewed.length
              ? 'PARTIAL'
              : 'NO_BLOCKERS',
}
