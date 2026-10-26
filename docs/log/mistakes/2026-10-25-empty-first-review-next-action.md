## 2026-10-25 — Empty first review lacked an actionable next step

**Caught by:** User report; independent design-system/usability review.
**What happened:** A sender’s pending first review survived the disappearance of its current inbox/archive mail. The UI did not explain the independent states and offered a disabled cleanup confirmation. The initial direct Keep/Unsubscribe controls also unmounted their focused button; review caught that focus risk, and a focused test reproduced it. A glossary check rejected generic action wording before publication.
**Correct approach:** Explain why review is pending, offer the existing decision previews, preserve focus on the persistent toolbar action, and use the established action vocabulary. Require fresh unwindowed counts before declaring the sender empty.
**Rule:** A zero-match cleanup preview must explain whether mail is outside the selected scope or genuinely absent, then offer an explicit next step without submitting a different action implicitly.
**Enforcement update:** Three first-review transition regressions, negative unknown/window-count cases, keyboard-focus assertion, unchanged glossary baseline, and a synthetic API/database journey proving review completion persists without moving mail.
