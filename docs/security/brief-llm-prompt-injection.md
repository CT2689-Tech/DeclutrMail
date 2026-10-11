# Brief and explanation LLM prompt injection

DeclutrMail sends a short, quoted metadata envelope to Anthropic for
suggestion explanations and the Daily Brief. It never sends full email
contents, attachments, or images. This note is the control description
for CASA recertification.

## Call paths

Both paths refuse the provider unless the workspace owner has current
consent (`2026-10`) for that scope and the scope is not revoked.

1. Suggestion explanations. `ScoreWorker.generateProse` calls
   `AnthropicHaikuAdapter.explain`. `POST /api/triage/explain` only
   queues that same worker when `TriageReadService.explanationsAllowed`
   is true. The worker checks again.
2. Daily Brief. `BriefSnapshotWorker.composeNarrative` calls
   `BriefLlmAnthropicAdapter.generateNarrative`.

Missing consent, a lookup error, or a kill switch skips the call. The
user sees the rule-based explanation or the template Brief. Stored
`llm_haiku` prose is not reused and is not shown: the read path
replaces it with the plain volume text and stamps `generatedBy:
template`.

## Kill switches

`EXPLAIN_LLM_ENABLED=false` and `BRIEF_LLM_ENABLED=false`. Anything
other than the string `false` leaves the path enabled. Set each on the
API (paused copy) and the worker (enforcement). A kill switch does not
clear the stored consent row.

## Untrusted input

Before the request:

- Control characters and zero-width characters are stripped.
- Each field is length-capped.
- Values are wrapped as quoted data (`«…»`), and the quote marks are
  stripped from the value so a sender name cannot close the quote.
- The system instruction says the user message is untrusted data, must
  not be followed, and must not trigger tools.
- The request sets no `tools` and no function calling.

## Output

The reply is checked before it is stored:

- empty text is rejected
- word count is capped
- a URL that was not in the input is rejected
- instructions to click, tap, open a link, or reply to the message are
  rejected

A rejection falls back to the template. The log line is
`reasoning.output_rejected` or `brief.output_rejected` with a `reason`
only. The model text is not logged.

## Consent record

Explanations and Brief are separate scopes. Allow on the Free card
records explanations only. After an upgrade, the short Brief card asks
again. Not now on that card records `brief_ai_declined_at` and leaves
explanations in place. Settings → AI off sets `revoked_at` on both
scopes. A version mismatch re-asks and is not active. Until the user
chooses, both paths stay off.
