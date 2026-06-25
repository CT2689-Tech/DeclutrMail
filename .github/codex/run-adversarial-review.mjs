#!/usr/bin/env node
// Adversarial Codex PR review — CI helper.
//
// Two modes (no Codex-plugin dependency; pure Node built-ins):
//   prompt   build the adversarial review prompt (diff + guardrails + schema) → stdout
//   format   read `codex exec --json` JSONL from stdin → markdown PR comment → stdout
//
// Advisory only: `format` always exits 0 so a flaky/empty review never gates a PR.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MODE = process.argv[2];
const STICKY_MARKER = '<!-- codex-adversarial-review -->';
const MAX_DIFF_BYTES = 180_000; // keep the prompt bounded; oversized diffs get truncated

// ── DeclutrMail hard guardrails (CLAUDE.md §2) — fed to Codex so the review
// flags violations of the invariants structural gates can miss.
const GUARDRAILS = `DeclutrMail invariants the change MUST NOT violate (treat any breach as a critical finding):
- Privacy (D7/D228): never fetch/store full bodies, attachments, inline images, raw MIME, or non-allowlisted headers. Stored fields are sender, subject, Gmail snippet, dates, labels, read state ONLY.
- Canonical verbs (D227): product UI uses exactly Keep/Archive/Unsubscribe/Later/Delete (K/A/U/L/D). "Screen" is an internal enum, never user-facing.
- Action lifecycle (D226): User intent → action sheet → action PREVIEW (mandatory) → mutation → undo. Destructive mutations without a preview + undo wiring are a defect.
- No ML category prediction (D222): categories are user-assigned or rule-matched, never predicted to auto-protect/route.
- Webhook auth (D229): Gmail Pub/Sub push verifies OIDC JWT (issuer+JWKS+aud+email+exp+messageId dedup+historyId monotonic). Never x-goog-authenticated-user-email.
- Scope change ⇒ reset scoped cache; a read guard's 4xx (409 SELECT_MAILBOX/NO_ACTIVE_MAILBOX) is a designed state, never a retry.`;

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    return String(err.stdout || '') + String(err.stderr || '');
  }
}

function buildPrompt() {
  const base = process.env.CODEX_DIFF_BASE || 'origin/main';
  const target = process.env.CODEX_TARGET_LABEL || 'this pull request';
  const stat = sh('git', ['diff', '--stat', `${base}...HEAD`]).trim();
  let diff = sh('git', ['diff', '--unified=3', `${base}...HEAD`]);
  let truncated = '';
  if (Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES) {
    diff = Buffer.from(diff, 'utf8').subarray(0, MAX_DIFF_BYTES).toString('utf8');
    truncated =
      '\n[diff truncated — review the largest changes; request the rest if a finding hinges on omitted lines]\n';
  }

  return `<role>
You are Codex performing an ADVERSARIAL software review. Your job is to break confidence in the change, not to validate it.
</role>

<task>
Review the diff below as if you are trying to find the strongest reasons it should not ship yet.
Target: ${target}
</task>

<operating_stance>
Default to skepticism. Assume the change can fail in subtle, high-cost, or user-visible ways until evidence says otherwise.
Do not give credit for good intent, partial fixes, or likely follow-up work. If something only works on the happy path, treat that as a real weakness.
</operating_stance>

<attack_surface>
Prioritize expensive, dangerous, or hard-to-detect failures: auth/permissions/tenant isolation; data loss/corruption/irreversible state; rollback/retry/partial-failure/idempotency gaps; races/ordering/stale state; empty/null/timeout/degraded-dependency behavior; schema drift/migration hazards/compat regressions; observability gaps that hide failure.
</attack_surface>

<project_guardrails>
${GUARDRAILS}
</project_guardrails>

<finding_bar>
Report only material findings. No style, naming, low-value cleanup, or speculative concerns without evidence. Each finding answers: what can go wrong, why this path is vulnerable, likely impact, and the concrete change that reduces risk. Prefer one strong finding over several weak ones. If the change looks safe, say so and return no findings.
</finding_bar>

<grounding_rules>
Be aggressive but grounded. Every finding must be defensible from the diff. Do not invent files, lines, or runtime behavior. State explicitly when a conclusion depends on an inference and keep confidence honest. Line numbers refer to the new-file side of the diff.
</grounding_rules>

<output_contract>
Output ONLY a single valid JSON object (no markdown fences, no prose) matching this schema:
{
  "verdict": "approve" | "needs-attention",
  "summary": string (a terse ship/no-ship assessment, not a neutral recap),
  "findings": [ { "severity": "critical"|"high"|"medium"|"low", "title": string, "body": string, "file": string, "line_start": int, "line_end": int, "confidence": number 0..1, "recommendation": string } ],
  "next_steps": [ string ]
}
Use "needs-attention" if there is any material risk worth flagging; "approve" only if you cannot support any substantive adversarial finding.
</output_contract>

<changed_files>
${stat || '(no textual diff against ' + base + ')'}
</changed_files>

<diff>
${diff}${truncated}
</diff>`;
}

function extractFinalMessage(jsonl) {
  let text = '';
  for (const line of jsonl.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (
      evt.type === 'item.completed' &&
      evt.item?.type === 'agent_message' &&
      typeof evt.item.text === 'string'
    ) {
      text = evt.item.text; // keep the last one
    }
  }
  return text;
}

function parseReview(message) {
  let body = message.trim();
  // strip ```json … ``` fences if present
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  // narrow to the outermost JSON object
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) body = body.slice(start, end + 1);
  return JSON.parse(body);
}

// critical/high → [BLOCKING], medium → [SUGGESTION], low → [NIT] (CLAUDE.md §6)
const PREFIX = { critical: '[BLOCKING]', high: '[BLOCKING]', medium: '[SUGGESTION]', low: '[NIT]' };
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function render(review) {
  const findings = Array.isArray(review.findings) ? [...review.findings] : [];
  findings.sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  const blocking = findings.filter(
    (f) => f.severity === 'critical' || f.severity === 'high',
  ).length;
  const icon = review.verdict === 'needs-attention' ? '🔴' : '🟢';

  const lines = [
    STICKY_MARKER,
    `## ${icon} Codex adversarial review — ${review.verdict ?? 'unknown'}`,
    '',
    review.summary?.trim() || '_No summary returned._',
    '',
  ];

  if (findings.length === 0) {
    lines.push('No material adversarial findings.');
  } else {
    lines.push(`### Findings (${findings.length}${blocking ? `, ${blocking} blocking` : ''})`, '');
    for (const f of findings) {
      const prefix = PREFIX[f.severity] ?? '[SUGGESTION]';
      const loc = f.file
        ? `\`${f.file}:${f.line_start ?? '?'}${f.line_end && f.line_end !== f.line_start ? `-${f.line_end}` : ''}\``
        : '';
      const conf = typeof f.confidence === 'number' ? ` _(conf ${f.confidence.toFixed(2)})_` : '';
      lines.push(`#### ${prefix} ${f.title ?? '(untitled)'} ${loc}${conf}`);
      if (f.body) lines.push('', f.body.trim());
      if (f.recommendation) lines.push('', `**Fix:** ${f.recommendation.trim()}`);
      lines.push('');
    }
  }

  if (Array.isArray(review.next_steps) && review.next_steps.length) {
    lines.push('### Next steps', '');
    for (const s of review.next_steps) lines.push(`- ${s}`);
    lines.push('');
  }

  lines.push(
    '<sub>🤖 Advisory only — does not block merge. Generated by `codex exec review` (adversarial prompt). Severity → prefix: critical/high = [BLOCKING], medium = [SUGGESTION], low = [NIT].</sub>',
  );
  return lines.join('\n');
}

function formatFromStdin() {
  const jsonl = readFileSync(0, 'utf8');
  const message = extractFinalMessage(jsonl);
  if (!message) {
    return [
      STICKY_MARKER,
      '## ⚠️ Codex adversarial review — no output',
      '',
      'Codex returned no final message. Check the workflow logs; this run did not produce a review.',
      '',
      '<sub>🤖 Advisory only — does not block merge.</sub>',
    ].join('\n');
  }
  try {
    return render(parseReview(message));
  } catch {
    return [
      STICKY_MARKER,
      '## ⚠️ Codex adversarial review — unparseable output',
      '',
      'Codex did not return JSON matching the review schema. Raw final message:',
      '',
      '```',
      message.slice(0, 4000),
      '```',
      '',
      '<sub>🤖 Advisory only — does not block merge.</sub>',
    ].join('\n');
  }
}

if (MODE === 'prompt') {
  process.stdout.write(buildPrompt());
} else if (MODE === 'format') {
  process.stdout.write(formatFromStdin());
} else {
  process.stderr.write('usage: run-adversarial-review.mjs <prompt|format>\n');
  process.exit(2);
}
