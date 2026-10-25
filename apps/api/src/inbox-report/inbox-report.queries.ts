import { sql, type SQL } from 'drizzle-orm';

import { readStateNotSweeperMarked } from '@declutrmail/db';

import { INBOX_REPORT_THRESHOLDS as T } from '@declutrmail/shared/inbox-report';

const REPORTABLE_FROM = '1995-01-01T00:00:00.000Z';

/** One mailbox-indexed pass, independent of sender pagination and report cache. */
export function mailboxSnapshotQuery(mailboxId: string): SQL {
  return sql`
    select
      count(*)::int as received_count,
      count(*) filter (
        where 'INBOX' = any(m.label_ids) and not ('TRASH' = any(m.label_ids))
      )::int as inbox_count,
      count(*) filter (
        where 'INBOX' = any(m.label_ids) and not ('TRASH' = any(m.label_ids)) and m.is_unread
      )::int as unread_inbox_count,
      sum(m.size_bytes)::bigint as total_bytes,
      count(m.size_bytes)::int as size_known_count
    from mail_messages m
    where m.mailbox_account_id = ${mailboxId} and m.is_outbound = false
  `;
}

/** Mailbox-level aggregates. Inbound only, and only dates the report may cite. */
export function mailboxFactsQuery(mailboxId: string, sinceIso: string, threeYearsIso: string): SQL {
  const notSweeper = readStateNotSweeperMarked(mailboxId, 'm');
  return sql`
    select
      count(*)::int as received_count,
      coalesce(sum(m.size_bytes), 0)::bigint as received_bytes,
      count(*) filter (where m.internal_date >= ${sinceIso}::timestamptz)::int as inbound_90,
      count(*) filter (
        where m.internal_date >= ${sinceIso}::timestamptz
          and m.is_unread = false
          and ${notSweeper}
      )::int as marked_read_90,
      count(*) filter (
        where exists (
          select 1 from senders s
          where s.mailbox_account_id = m.mailbox_account_id
            and s.sender_key = m.sender_key
            and s.wrote_to_count > 0
        )
      )::int as people_received,
      count(*) filter (where m.size_bytes >= ${T.largeMessageBytes})::int as large_count,
      coalesce(sum(m.size_bytes) filter (where m.size_bytes >= ${T.largeMessageBytes}), 0)::bigint as large_bytes,
      count(*) filter (
        where coalesce(m.label_ids, '{}') && (
          select coalesce(array_agg(ml.label_id), '{}')::text[]
          from mailbox_labels ml
          where ml.mailbox_account_id = ${mailboxId}
            and ml.sweeper_vendor is not null
        )
      )::int as third_party_count,
      coalesce(sum(m.size_bytes) filter (
        where coalesce(m.label_ids, '{}') && (
          select coalesce(array_agg(ml.label_id), '{}')::text[]
          from mailbox_labels ml
          where ml.mailbox_account_id = ${mailboxId}
            and ml.sweeper_vendor is not null
        )
      ), 0)::bigint as third_party_bytes,
      count(*) filter (
        where m.internal_date >= ${sinceIso}::timestamptz
          and coalesce(m.label_ids, '{}') && (
            select coalesce(array_agg(ml.label_id), '{}')::text[]
            from mailbox_labels ml
            where ml.mailbox_account_id = ${mailboxId}
              and ml.sweeper_vendor is not null
          )
      )::int as third_party_recent_90,
      extract(year from min(m.internal_date))::int as oldest_year,
      count(*) filter (where m.internal_date < ${threeYearsIso}::timestamptz)::int as older_than_3_years,
      count(*) filter (where 'TRASH' = any(coalesce(m.label_ids, '{}')))::int as trash_count,
      coalesce(sum(m.size_bytes) filter (where 'TRASH' = any(coalesce(m.label_ids, '{}'))), 0)::bigint as trash_bytes,
      (
        select coalesce(sum(c), 0)::int from (
          select count(*)::int as c
          from mail_messages t
          where t.mailbox_account_id = ${mailboxId}
            and t.is_outbound = false
            and t.internal_date >= ${REPORTABLE_FROM}::timestamptz
          group by t.sender_key
          order by c desc
          limit 10
        ) top_counts
      ) as top10_count,
      (
        select coalesce(sum(b), 0)::bigint from (
          select coalesce(sum(t.size_bytes), 0)::bigint as b
          from mail_messages t
          where t.mailbox_account_id = ${mailboxId}
            and t.is_outbound = false
            and t.internal_date >= ${REPORTABLE_FROM}::timestamptz
          group by t.sender_key
          order by b desc
          limit 10
        ) top_sizes
      ) as top10_bytes
    from mail_messages m
    where m.mailbox_account_id = ${mailboxId}
      and m.is_outbound = false
      and m.internal_date >= ${REPORTABLE_FROM}::timestamptz
  `;
}

/**
 * A forward archive/delete row is reverted once its Undo succeeds.
 * The journal row is pruned after the window; the activity copy remains.
 */
function actionReverted(alias: 'move'): SQL {
  return sql.raw(`(
    exists (
      select 1 from undo_journal uj
      where uj.token = ${alias}.undo_token
        and uj.reverted_at is not null
    )
    or exists (
      select 1 from activity_log al
      where al.action_job_id = ${alias}.id
        and al.reverted_at is not null
    )
  )`);
}

/**
 * Sender ids with a standing unsubscribe-backlog decision.
 *
 * Archive and delete count only when this backlog linked an unsubscribe
 * intent to that decision. The intent counts on its own for unsubscribe
 * without a move. A reverted move retires both, so Undo puts the sender
 * back. Queued, executing, and done-but-not-reverted stay out, including
 * while the Undo window is still open.
 */
function backlogHandledSenders(mailboxId: string): SQL {
  return sql`
    select move.selector->>'senderId' as sender_id
    from action_jobs move
    where move.mailbox_account_id = ${mailboxId}
      and move.direction = 'forward'
      and move.verb in ('archive', 'delete')
      and move.status in ('queued', 'executing', 'done')
      and move.selector->>'type' = 'sender'
      and not ${actionReverted('move')}
      and exists (
        select 1 from action_jobs unsub
        where unsub.mailbox_account_id = move.mailbox_account_id
          and unsub.direction = 'forward'
          and unsub.verb = 'unsubscribe'
          and unsub.status in ('queued', 'executing', 'done')
          and unsub.idempotency_key like 'unsub:%'
          and unsub.composite_id = coalesce(move.composite_id, move.id)
      )
    union
    select unsub.selector->>'senderId' as sender_id
    from action_jobs unsub
    where unsub.mailbox_account_id = ${mailboxId}
      and unsub.direction = 'forward'
      and unsub.verb = 'unsubscribe'
      and unsub.status in ('queued', 'executing', 'done')
      and unsub.idempotency_key like 'unsub:%'
      and unsub.selector->>'type' = 'sender'
      and not exists (
        select 1 from action_jobs move
        where move.mailbox_account_id = unsub.mailbox_account_id
          and move.direction = 'forward'
          and move.verb in ('archive', 'delete')
          and move.status in ('queued', 'executing', 'done')
          and move.selector->>'senderId' = unsub.selector->>'senderId'
          and coalesce(move.composite_id, move.id) = coalesce(unsub.composite_id, unsub.id)
          and ${actionReverted('move')}
      )
  `;
}

/**
 * True when the cached report must be recomputed.
 *
 * A newer archive, delete, unsubscribe, policy change, or revert misses.
 * Keep Undo removes the policy row, so its reverted audit row must also
 * invalidate a report computed while Keep was active. So does a fix
 * set that still lists a sender the backlog now covers. A row written
 * after those jobs is newer than updated_at, so the timestamp check
 * alone would serve it again.
 */
export function backlogChangedSinceQuery(
  mailboxId: string,
  generatedAtIso: string,
  cachedSenderIds: readonly string[],
): SQL {
  const changedSince = sql`
    select 1 as hit
    from action_jobs aj
    where aj.mailbox_account_id = ${mailboxId}
      and aj.verb in ('archive', 'delete', 'unsubscribe')
      and aj.updated_at > ${generatedAtIso}::timestamptz
    union all
    select 1
    from undo_journal uj
    where uj.mailbox_account_id = ${mailboxId}
      and uj.action_kind in ('archive', 'delete', 'unsubscribe')
      and uj.reverted_at > ${generatedAtIso}::timestamptz
    union all
    select 1
    from activity_log al
    where al.mailbox_account_id = ${mailboxId}
      and al.action in ('archive', 'delete', 'unsubscribe', 'keep')
      and al.reverted_at > ${generatedAtIso}::timestamptz
    union all
    select 1
    from sender_policies p
    where p.mailbox_account_id = ${mailboxId}
      and p.updated_at > ${generatedAtIso}::timestamptz
    union all
    select 1
    from activity_log al
    where al.mailbox_account_id = ${mailboxId}
      and al.action in ('keep', 'marked_protected', 'unmarked_protected')
      and al.created_at > ${generatedAtIso}::timestamptz
  `;
  if (cachedSenderIds.length === 0) {
    return sql`${changedSince} limit 1`;
  }
  const ids = sql.join(
    cachedSenderIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const handled = backlogHandledSenders(mailboxId);
  return sql`
    ${changedSince}
    union all
    select 1
    from (${handled}) handled
    where handled.sender_id in (${ids})
    limit 1
  `;
}

/** Per-sender window stats the fix set and the mostly-unread insight rank from. */
export function senderFactsQuery(mailboxId: string, sinceIso: string): SQL {
  const notSweeper = readStateNotSweeperMarked(mailboxId, 'm');
  const handled = backlogHandledSenders(mailboxId);
  return sql`
    with backlog_handled as (
      ${handled}
    )
    select
      s.id as sender_id,
      s.wrote_to_count,
      (s.unsubscribe_method is not null and s.unsubscribe_method <> 'none') as has_unsubscribe,
      coalesce(p.is_protected, false) as is_protected,
      coalesce(p.policy_type = 'keep', false) as is_keep,
      count(m.id) filter (
        where m.internal_date >= ${sinceIso}::timestamptz
      )::int as inbound_90,
      count(m.id) filter (
        where m.internal_date >= ${sinceIso}::timestamptz
          and m.is_unread = false
          and ${notSweeper}
      )::int as marked_read_90,
      count(m.id) filter (
        where m.internal_date >= ${sinceIso}::timestamptz
          and m.is_unread = false
          and not (${notSweeper})
      )::int as sweeper_marked_90,
      (
        select count(*)::int
        from mail_messages inbox
        where inbox.mailbox_account_id = s.mailbox_account_id
          and inbox.sender_key = s.sender_key
          and inbox.is_outbound = false
          and 'INBOX' = any(coalesce(inbox.label_ids, '{}'))
          and not ('TRASH' = any(coalesce(inbox.label_ids, '{}')))
      ) as inbox_count,
      (s.id::text in (select sender_id from backlog_handled)) as backlog_handled
    from senders s
    left join mail_messages m
      on m.mailbox_account_id = s.mailbox_account_id
     and m.sender_key = s.sender_key
     and m.is_outbound = false
     and m.internal_date >= ${REPORTABLE_FROM}::timestamptz
    left join sender_policies p
      on p.mailbox_account_id = s.mailbox_account_id
     and p.sender_key = s.sender_key
    where s.mailbox_account_id = ${mailboxId}
    group by s.id, s.sender_key, s.mailbox_account_id, s.wrote_to_count, s.unsubscribe_method, p.is_protected, p.policy_type
  `;
}

export function vendorQuery(mailboxId: string): SQL {
  return sql`
    select ml.sweeper_vendor as vendor_key
    from mail_messages m
    join mailbox_labels ml
      on ml.mailbox_account_id = m.mailbox_account_id
     and ml.label_id = any(coalesce(m.label_ids, '{}'))
     and ml.sweeper_vendor is not null
    where m.mailbox_account_id = ${mailboxId}
      and m.is_outbound = false
      and m.internal_date >= ${REPORTABLE_FROM}::timestamptz
    group by ml.sweeper_vendor
    order by count(*) desc, ml.sweeper_vendor
    limit 1
  `;
}
