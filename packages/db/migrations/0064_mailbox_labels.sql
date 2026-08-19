-- Gmail label NAMES, so a manufactured read signal can be named (D7, F012).
--
-- THE PROBLEM. Gmail exposes exactly one engagement bit — the absence of
-- the `UNREAD` label — and any tool with API access can write it. On the
-- founder's mailbox one third-party sweeper's label carries 20,819 of the
-- 75,689 messages we count as read: 27.5% of the read signal was
-- manufactured by a tool the user is not currently using. We already
-- store `label_ids`, but an id like `Label_117` is opaque, so we could
-- not tell that label from any other.
--
-- WHAT THIS ADDS. One `users.labels.list` call per mailbox per sync maps
-- ids to names. `sweeper_vendor` records which known sweeper a label
-- belongs to, resolved from the maintained list in
-- `@declutrmail/shared/senders` at write time and recomputed on every
-- sync, so a change to that list reaches stored rows rather than
-- stranding them.
--
-- D7 / D228 — THIS IS A NEW GMAIL FIELD. Label NAMES were not previously
-- fetched or stored. The Gmail-data inventory
-- (`packages/shared/src/contracts/gmail-data-inventory.ts`) is amended in
-- the same change, per CLAUDE.md §2.1. A label name is mailbox metadata
-- the user chose or a tool created; it is not message content, and no
-- message body, attachment, or non-allowlisted header is involved.
--
-- Scoped per mailbox and cascade-deleted with it: label ids are only
-- meaningful inside the mailbox that issued them.

CREATE TABLE "mailbox_labels" (
  "mailbox_account_id" uuid NOT NULL
    REFERENCES "mailbox_accounts"("id") ON DELETE CASCADE,
  -- Gmail's label id, matching the values in `mail_messages.label_ids`.
  "label_id" text NOT NULL,
  -- The label's display name, as Gmail returns it. Case preserved:
  -- Gmail label names are case-sensitive and the user may have chosen
  -- the casing.
  "name" text NOT NULL,
  -- Which known third-party sweeper this label belongs to, or NULL for
  -- every ordinary label (the overwhelming majority). Derived, never
  -- user-set — recomputed from the maintained vendor list on each sync.
  "sweeper_vendor" text,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("mailbox_account_id", "label_id")
);
--> statement-breakpoint
ALTER TABLE "mailbox_labels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The read-rate exclusion asks one question per mailbox: "which label ids
-- are a sweeper's". Partial, because sweeper labels are a handful of rows
-- out of a few hundred.
CREATE INDEX "mailbox_labels_sweeper_idx"
  ON "mailbox_labels" ("mailbox_account_id", "label_id")
  WHERE "sweeper_vendor" IS NOT NULL;
