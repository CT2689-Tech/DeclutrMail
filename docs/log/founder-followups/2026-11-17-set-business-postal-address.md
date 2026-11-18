### 2026-11-17 — Set the business postal address to open owned email

**Source:** Decision 7A on the stale-rules PR (`chore/distill-drop-stale-decisions`)
**Why:**
- The founder approved newsletter and waitlist signups on content pages.
- CAN-SPAM requires a physical postal address in commercial email. While
  `BUSINESS_POSTAL_ADDRESS` is empty, the send worker refuses every commercial
  email kind. That covers the sync reminder, the lapse re-engagement email and
  the weekly-value receipt, not just a future newsletter.
- Only the founder can choose and register the address. A virtual mailbox
  service works.
**How:**
1. Get a business mailing address, for example a virtual mailbox.
2. Send it to an agent, who puts it in `BUSINESS_POSTAL_ADDRESS` in
   `packages/shared/src/copy/postal-address.ts`, one line per array element.
   That one constant opens all commercial email.
3. Before any signup form ships, have an agent add the marketing list to
   `/privacy`: what is collected, why, how to unsubscribe, and retention.
   Then build the form.
**Verifies by:** `/contact` and the email footer show the address, and
`hasPostalAddress()` is true. A lapse re-engagement email sends in staging
instead of being refused by `assertPostalAddressForKind`.
**Status:** Open
