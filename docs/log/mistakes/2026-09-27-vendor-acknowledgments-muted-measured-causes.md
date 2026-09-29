## 2026-09-27 — Vendor acknowledgments muted measured causes, three reviews running

**PR:** #795 (https://github.com/CT2689-Tech/DeclutrMail/pull/795)
**Caught by:** silent-failure-hunter through ct-gates, passes 1 to 3, and self-review between them
**What happened:** #795 made each line in `scripts/known-vendor-issues.tsv` acknowledge one vendor cause, up to a ceiling. Every review still found a path where a line muted a cause the run had measured, and the findings of passes 2 and 3 came out of the previous round's fixes:
- early returns skipped the causes after them (pass 1);
- a read that failed after others were measured replaced them with its error, so a line for the error also muted a suspension or a quota BREACH (pass 2);
- a `-` line held a measured cause at any size (pass 2);
- one line's text matched several causes; the first fix counted only the causes failing that run, so the same line held the spend BREACH the day after the volume spike it was written for (self-review, then pass 3);
- a timeout retry that failed earlier than the first attempt dropped what the first attempt measured; a missing budget or state read as healthy; only the first active database was gauged (pass 3).

**Correct approach:** before the first review, list every path by which a cause can go unmeasured or be matched by more than the line names: early returns, a read that fails after others, the retry, text that spans causes, a field that is missing. Test each one with the line that would mute it.
**Rule:** an acknowledgment must name one thing and hold it only at a measured size; enumerate what else it could cover before review, not after.
**Enforcement update:** none. The tests pin each path found, and since #789 ct-gates routes scripts to silent-failure-hunter.
