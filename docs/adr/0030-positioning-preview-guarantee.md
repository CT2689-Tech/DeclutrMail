# ADR-0030: Positioning — sell the preview guarantee, not the sender unit

- **Status:** Accepted
- **Date:** 2026-08-02
- **Accepted:** 2026-08-02
- **Deciders:** chintan.a.thakkar@gmail.com, 13-agent marketing panel, Codex marketing pass
- **Related D-decisions:** D250 (landing headline, reverses D223), D251 (Autopilot
  splits on behaviour), D194 (Screener marketing rule), D209 (trust-first microcopy),
  D228 (privacy badge copy), D226 (mandatory preview)

## Context

D223 locked `Control Gmail by sender, not by email.` in 2026-05. Its rationale was
differentiation: every competitor opened with "AI inbox cleaner", so naming the unit of
work was defensive.

On 8 July 2025 Gmail shipped _Manage subscriptions_ — senders ranked by volume with
one-click unsubscribe. The unit of work is now a native Gmail feature. The founder's own
commissioned audit (`docs/execution/product-launch-audit-2026-07-25.md:110`, and `:115` for the
scope-preview row) grades
"sender list ranked by volume" a **dead differentiator** and "scope preview before the
mutation" **durable**.

This is a rule about how copy gets written, not a feature anyone will ask "is it built
yet?" about — so it is an ADR, per the registry rule the founder adopted 2026-07-28. The
shipped headline itself is D250.

## Decision

**Lead with the guarantee, use the sender as the mechanism.**

Every public surface — landing, pricing, comparison, onboarding, lifecycle email, launch
posts — argues from what Gmail structurally does not offer:

1. **A scope preview before the mutation.** Exact count, sample, and the precise Gmail
   changes, every time. Gemini's cleanup acts on a chat command with no scope preview.
2. **A per-sender record and an undo window.** Activity holds what happened; label
   changes are reversible for the plan's window.
3. **A stated, falsifiable data boundary.** `Full bodies fetched: 0` plus a storage list
   generated from the code that does the fetching.

Sender-level action remains in the copy as _how_ it works. It is never the lead claim.

**Three copy rules bind every surface:**

- **Truth outranks appeal.** A claim must hold at every tier and every verb, or it is
  scoped to the tier and verb where it holds. The landing H1 must additionally hold on
  **Free**, because the landing CTA signs a visitor up for Free.
- **Never compress a generated claim.** The privacy badge and storage list are generated
  from `gmail-data-inventory.ts`. Short paraphrases of them (`metadata only`,
  `never reads your email`) are either jargon or false. If the wedge must sit higher on
  the page, move the badge; do not restate it.
- **Objections come after desire.** Privacy and safety answer a question the reader has
  not yet asked if they appear above the headline.

## Alternatives considered

**Keep D223's headline.** Rejected: it names the capability Gmail shipped. Its
comprehension advantage was real and measured (unanimous 9/10 from three cold readers)
and survives — the clause is retained inside D250 as the mechanism.

**Lead with privacy** (`the Gmail cleanup that never reads your email`). Rejected: it is
a reassurance, not a reason. Buyers already trust Gmail with content; privacy resolves
the OAuth objection rather than creating demand, so it belongs in the trust strip. It
also cannot be stated absolutely without becoming false.

**Lead with reversibility** (`change your mind for 7 days`). Rejected: a delivered
unsubscribe cannot be recalled, so any blanket reversibility claim is false
(`packages/shared/src/copy/action-safety.ts`), and the 7-day floor compares poorly with
Gmail's own ~30-day Trash.

**Lead with a permission-layer claim** (`nothing reaches you that you haven't approved`).
Rejected as factually false: Screener is soft quarantine and new senders still arrive in
Gmail (D194, D72).

## Consequences

### Positive

- The lead claim is one Gmail cannot copy without rebuilding its bulk-action model.
- The tier ladder narrates the position rather than straining against it: Plus approves
  every batch, Pro is where approval is delegated (D251).
- Every claim is falsifiable against code, which is the posture the product already sells.

### Negative

- The position sells safety-adjacent value, which is weaker on browsing audiences
  (Product Hunt, X) than on arriving-scared audiences (r/gmail, Show HN). Mitigated by
  leading the headline with the outcome and keeping the payoff above the fold.
- Sender-level framing is retired from ~15 public surfaces, including page titles that
  currently rank.

### Neutral

- SEO long-tail pages (`/how-to/*`, `/answers/*`) keep their titles: those are queries,
  not positioning.

## Implementation notes

- Shipped copy and the per-surface change register live in
  `docs/execution/repositioning-copy-spec-2026-08-01.md` (see the DECISIONS LOCKED block
  at the top, which overrides the sections written before D251 expanded).
- Packaging rationale and the tier table live in
  `docs/execution/packaging-2026-08-02.md`.
- `check-microcopy.sh` enforces only the `Bodies read: 0` ban and the D227 verb rule. The
  constraints in this ADR are **not** hook-enforced; a false reversibility or privacy
  claim in marketing copy passes CI silently today. Treat the truth-scan in the copy
  spec's review brief as the compensating control.

## References

- `docs/execution/product-launch-audit-2026-07-25.md` §1, §7, line 110
- `packages/shared/src/copy/action-safety.ts`, `packages/shared/src/copy/privacy.ts`
- `packages/shared/src/contracts/gmail-data-inventory.ts`
- ADR-0011 (editorial copy voice scope), ADR-0019 (verb registry)
