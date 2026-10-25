## 2026-10-24 — Hero and rule inventory used different sets
**PR:** Follow-up to [#1126](https://github.com/CT2689-Tech/DeclutrMail/pull/1126).
**Caught by:** User report.
**What happened:** Quiet watch counted enabled preset and custom rules, but Your rules listed and counted only custom rules; presets were hidden in a separate disclosure.
**Correct approach:** Put both rule kinds in the visible inventory and use their existing editors and lifecycle handlers.
**Rule:** When a summary counts multiple entity kinds, verify each kind can be found and managed in the adjacent list, including an account with only built-in entities.
**Enforcement update:** Route regression for two watching presets and zero custom rules, plus mixed inventory pagination and responsive editing checks.
