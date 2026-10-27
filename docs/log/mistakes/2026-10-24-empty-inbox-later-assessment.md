## 2026-10-24 — Include the expanded assessment in current-Inbox checks

**PR:** Follow-up to [#1118](https://github.com/CT2689-Tech/DeclutrMail/pull/1118).
**Caught by:** Source review and a failing regression test.
**What happened:** Guided Review's Why disclosure labelled a Later assessment as
Suggested when the current Inbox was empty. The existing zero-Inbox Archive
condition omitted Later. Shared confidence policy already kept Later neutral at
rest; the defect was the expanded label.
**Correct approach:** Apply the same known-zero check to both Inbox-moving
verdicts while retaining the historical evidence, explicit actions and fresh preview.
**Rule:** Review recommendation presentation at rest and inside disclosures;
separate an inapplicable suggestion from action availability.
**Enforcement update:** Zero-Inbox Later regression plus positive/unknown and
standalone controls, with a Storybook example of Why open.
