## 2026-10-26 — Preserve JSON shape during fixture cleanup

**PR:** [#1156](https://github.com/CT2689-Tech/DeclutrMail/pull/1156)
**Caught by:** required actual-server journey CI
**What happened:** The new preview journeys passed, but cleanup bound an already
stringified preferences object to a PostgreSQL JSONB parameter. postgres.js
serialized it again, leaving a scalar string; later fixture setup failed at
`jsonb_set`. No application or production preference was changed.
**Correct approach:** Use `sql.json` for native JSON parameters. Rehearse the exact
setup/cleanup against isolated PostgreSQL, then read back and compare the saved
object. Apply the same correction to the edited inline journey's restore.
**Rule:** JSON fixture restoration must preserve the driver's native JSON shape.
**Enforcement update:** The new journey's cleanup now asserts the restored
preferences equal its original snapshot; required CI still executes every journey.
