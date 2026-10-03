# Autopilot sender preview

`POST /api/autopilot/rules/:id/preview` evaluates the current mailbox once.
The default response retains the ten-row `sample` used by rule cards. Passing
`{ "includeSenders": true }` also returns `senderPage`: the first page of the
complete **actionable** sender list, with a preview ID and expiry time.

Pages contain at most 25 senders. Protected senders are excluded. Unsubscribe
rules exclude already-unsubscribed senders; Archive and Later require inbound
Inbox messages. The sender list therefore corresponds to
`actionableSenderCount`, rather than every historical match.

`GET /api/autopilot/rules/:id/preview/:previewId/senders?page=2` reads another
page from that same preview. Page numbers start at one. Invalid identifiers or
page numbers return 400. Authentication, active-mailbox selection, and rate
limits apply to both routes. Like existing rule previews, paging is available
on every tier; activation remains capability-gated. Preview IDs are scoped to their mailbox
and rule; they cannot grant access to another mailbox.

The ordered sender set, match reasons, and Inbox counts stay stable across
pages for five minutes. Names and email addresses are fetched from the sender
index for just the requested page. `inboxCount` counts inbound messages with
the Gmail `INBOX` label; history and read-rate evidence cover the rule's email
history. For Unsubscribe, Inbox counts provide context: requests affect future
delivery and do not move existing email.

Missing or expired previews return 410 with code `AUTOPILOT_PREVIEW_EXPIRED`.
The dialog offers **Refresh preview**, which runs a new evaluation and resets
the sender list to page one. Cache outages return 503 and offer retry. The
dialog disables confirmation while a page is loading, after a page error, or
when its preview expires; an error leaves the current page readable.

Production uses a shared Redis hash, with one field per page and an atomic
five-minute expiry. Cache reads transfer only one page. Local development
without `REDIS_URL` uses a bounded, expiring in-memory store; Redis outages do
not fall back to process-local snapshots. Cached data contains sender hashes,
match reasons, and Inbox counts, with no raw sender identities or email bodies.
The lifecycle is registered in `gmail-data-inventory.ts`.

The preview is display evidence, not an execution token. Activation retains
the existing rule mutation and daily action cap. The worker independently
rechecks current matches, protection, and action eligibility before acting;
cached preview rows never drive Gmail mutations.
