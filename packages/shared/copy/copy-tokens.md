# Copy tokens — approved product language

D209 names this file as the home for approved copy patterns. It did not
exist until now, which is why the vocabulary below drifted: the rule said
"trust-first, plain, no AI theater" and nothing said which _word_ to use.

This file is the term standard. `check-microcopy.sh` enforces the
forbidden-word list; this document covers the choices a regex cannot make.

---

## 1. One concept, one word

| Concept                      | Use                              | Never                       | Why                                                                                                                                                                 |
| ---------------------------- | -------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A message                    | **email**                        | mail, mails                 | "mail" cannot count — "12 mails" is wrong, so it can never be the single standard. `action-semantics.ts` already uses "email" everywhere.                           |
| A connected Google account   | **Gmail account**                | mailbox                     | "mailbox" is the database table name (`mailbox_accounts`) surfacing in the UI. The privacy screen put "mailbox" and "account" in one sentence on the deletion flow. |
| Your login and billing       | **DeclutrMail account**          | account (bare)              | Bare "account" is ambiguous between the two above.                                                                                                                  |
| Mail already in the inbox    | **older email**                  | backlog                     | Inventory jargon.                                                                                                                                                   |
| A scheduled automatic run    | **check**                        | sweep                       | "sweep" is undefined anywhere in the product.                                                                                                                       |
| Bringing a Later sender back | **bring back** / **return time** | wake, wake time, wake timer | Nothing else in the product uses a sleep metaphor, and `receipt-strip.tsx` already says "Returns to Inbox".                                                         |

### Deliberate exceptions

These are correct and must not be "fixed":

- **All Mail** — Gmail's own label name.
- **one-click unsubscribe** — the industry term (RFC 8058) and Gmail's own
  naming. Comparison and help pages must be able to name the standard.
- **mail server** — the correct technical term, and it appears inside
  factual descriptions of third-party products.
- **DeclutrMail** — the brand. The wordmark renders as two spans,
  `Declutr` + `Mail`; a blind replace turns it into "DeclutrEmail".
- `mail_messages.*`, `/api/mailboxes/...`, `declutrmail:mailbox-scope-reset`,
  `X-Active-Mailbox-Id` — identifiers, not copy.

---

## 2. One fact, one owner, per screen

An action surface has four slots. A fact belongs to exactly one:

| Slot          | Owns                     | Example                                     |
| ------------- | ------------------------ | ------------------------------------------- |
| Title         | what happens             | "Move inbox email from Acme to Gmail Trash" |
| Impact figure | how much                 | "12 · in Inbox now"                         |
| Lead          | what does **not** happen | "Future email is unchanged."                |
| Footer        | how to undo              | "Undo from Activity for 30 days."           |

`senders/confirm-action-modal.tsx` is the reference implementation — it
splits effect copy from recovery copy and never renders the whole fact
blob.

**The rule this replaces:** D209 requires automation copy to "state
mechanism, state reversibility, state retention." That is a floor with no
ceiling. Read it per _screen_, not per component — otherwise every
component restates all three and one Delete sheet names Gmail Trash three
times.

### What must never be shortened away

- A statement of reversibility, on any surface that can start an
  irreversible action. Three surfaces have no footer slot
  (`screener/decide-preview.tsx`, `triage/triage-row.tsx`, the public
  simulator) — on those, recovery copy stays in the lead.
- The reason a disabled control is disabled, and the route out of that
  state.
- A count's honesty clause ("rechecked when it runs").

---

## 3. Reading level

Target grade 6–8 for in-product copy. Two cautions learned while
measuring it:

- Flesch-Kincaid is noisy below ~30 strings. The consent screen scored
  11.5 on 13 fragments and reads plainly; the number over-indicted it.
- **Never trade precision for grade level on an irreversible action.**
  The account-deletion copy is dense because it explains why a date may
  be weeks out, that undo keeps working, and that you can cancel. Fix
  vocabulary there, not length.
