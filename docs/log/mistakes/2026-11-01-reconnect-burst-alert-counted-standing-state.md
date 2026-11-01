## 2026-11-01 — A "burst" alert counted standing state and flapped on its own tick

**PR:** pending (fix/d159-reconnect-burst-new-breaks)
**Caught by:** user report (founder: "why does Gmail show so many gcloud alerts")
**What happened:** "DeclutrMail multiple Gmail reconnects required" fired 19 times between
2026-10-28 and 2026-11-01 (about 39 emails with 4-hour repeats). It averaged
`ops.mailbox_health` `affectedMailboxes` for `needs_reconnect`, which is how many mailboxes
are disconnected right now, not how many broke recently. Two unrelated users, one disconnected
before 2026-10-20 and one on 2026-10-28, read as an authorization outage indefinitely. The
query also used a 5-minute window over a 5-minute log tick, so any 6-minute tick or worker
deploy emptied the window: the incident closed and reopened ten minutes later with a new
email. A replay of 7 days of production logs reproduced 18 of the 19 incidents at matching times.
**Correct approach:** Count reconnect requests created in a window (`ops_reconnect_incidents`,
24-hour creations per outbox status), take the mean per status across revisions, and use a
look-back that spans at least three ticks (15 minutes). Standing disconnects stay in the
daily summary. The same replay gives 0 incidents for the new rule, and 1 non-flapping
incident when a second break is injected. The policy had no auto-close, so the incident
opened under the old condition stayed open after the condition was replaced; it now
auto-closes after 30 minutes without data, like the other incident policies.
**Rule:** A burst alert must count events in a window, not the current size of a state; and
a PromQL look-back over a log-based metric must span at least three of its emission ticks.
**Enforcement update:** promtool fixtures `reconnect-late-tick` and `reconnect-deploy-overlap`
in `scripts/fixtures/alert-promql.test.yml`
