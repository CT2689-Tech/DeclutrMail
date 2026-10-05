# Recent Brief editions

`GET /api/briefs/recent` returns the existing D202 envelope with `data: Brief[]`,
newest first, for the latest 30 calendar days inclusive of today. The date
boundary uses the authenticated user's persisted timezone, with UTC fallback
for absent or invalid legacy zones, matching `/api/briefs/today`. Calendar
arithmetic preserves the window across DST and month/year boundaries.

The endpoint shares the Brief controller's JWT, current-mailbox, CSRF and Pro
capability guards and triage-load rate limit. Every edition is filtered to the
guarded mailbox. A mailbox with no saved editions returns `200` with `data: []`;
missing today's edition remains a `404` on `/today`. Authorization/tier/read
failures retain their existing error envelopes. Frozen payloads and mark-opened
semantics are unchanged. Noise archive targets/protection are resolved at read
time through the existing range service.

The client uses this moving window only when today's read is a designed absence
(404 or server-hydrated null). It never substitutes history after a rejected
primary read. It excludes retained history following access rejection or a
mailbox scope reset, including cached fixed-range data older than that reset.
A saved-edition fallback is explicitly dated and never marked opened as today.
Refreshing can switch to today's edition once generated. History errors are
visible; a same-scope previously loaded edition may survive a 5xx with a stale
status and disabled mail-changing actions.
