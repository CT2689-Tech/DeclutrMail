'use client';

import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@declutrmail/shared';
import {
  fetchRuleSenders,
  type RuleSender,
  type SenderRule,
  type SenderRuleConfig,
} from '@/lib/api/autopilot-sender-rules';
import styles from './sender-rule-library.module.css';

export function useDebouncedQuery(value: string) {
  const [query, setQuery] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);
  return query;
}

export function SenderRuleEditor({
  rule,
  mailboxId,
  saving,
  error,
  onSave,
  onCancel,
}: {
  rule: SenderRule | null;
  mailboxId: string | undefined;
  saving: boolean;
  error: string | null;
  onSave: (config: SenderRuleConfig) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(rule?.name ?? '');
  const [action, setAction] = useState<SenderRuleConfig['action']>(rule?.action ?? 'archive');
  const [reach, setReach] = useState<SenderRuleConfig['reach']>(rule?.reach ?? 'inbox_only');
  const [age, setAge] = useState<SenderRuleConfig['olderThanDays']>(rule?.olderThanDays ?? null);
  // Keep selected metadata separately from search pages. Searching never drops a selection.
  const [selected, setSelected] = useState<Map<string, RuleSender>>(
    () => new Map(rule?.senders.filter((s) => !s.protected).map((s) => [s.senderKey, s])),
  );
  const [search, setSearch] = useState('');
  const query = useDebouncedQuery(search);
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  useEffect(() => setCursors([]), [query]);
  const results = useQuery({
    queryKey: ['autopilot-sender-picker', mailboxId, query, cursor ?? null],
    queryFn: ({ signal }) => fetchRuleSenders(query, cursor, signal, mailboxId),
    retry: false,
    staleTime: 0,
  });
  const [attempted, setAttempted] = useState(false);
  const valid =
    name.trim().length > 0 && name.trim().length <= 80 && selected.size > 0 && selected.size <= 100;
  const toggle = (sender: RuleSender, checked: boolean) => {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(sender.senderKey, sender);
      else next.delete(sender.senderKey);
      return next;
    });
  };
  return (
    <form
      aria-label={rule ? 'Edit sender rule' : 'Create sender rule'}
      onSubmit={(e) => {
        e.preventDefault();
        setAttempted(true);
        if (valid && !saving)
          onSave({
            name: name.trim(),
            action,
            reach: action === 'archive' ? 'inbox_only' : reach,
            olderThanDays: age,
            senderKeys: [...selected.keys()],
          });
      }}
    >
      <div className={styles.top}>
        <span className={styles.badge}>Approval first</span>
        <Button type="button" tone="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
      <h2>{rule ? 'Edit rule' : 'New sender rule'}</h2>
      <label className={styles.field} htmlFor={`${id}-name`}>
        Rule name
        <input
          id={`${id}-name`}
          className={styles.input}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={attempted && !name.trim()}
          autoFocus
        />
      </label>
      <fieldset className={styles.fieldset}>
        <legend>Email from these senders</legend>
        <label className={styles.field} htmlFor={`${id}-search`}>
          Search name or email
          <input
            id={`${id}-search`}
            type="search"
            className={styles.input}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCursors([]);
            }}
            aria-describedby={`${id}-help`}
            autoComplete="off"
          />
        </label>
        <div className={styles.chips} aria-label="Selected senders">
          {[...selected.values()].map((sender) => (
            <button
              type="button"
              className={styles.chip}
              key={sender.senderKey}
              onClick={() => toggle(sender, false)}
              aria-label={`Remove ${sender.name ?? sender.email ?? 'Unknown sender'}`}
            >
              <span>{sender.name ?? sender.email ?? 'Unknown sender'}</span>
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
        <p className={styles.muted} role="status">
          {selected.size} selected{results.isFetching ? ' · Searching…' : ''}
        </p>
        {results.isError ? (
          <div role="alert">
            <p className={styles.error}>Senders couldn’t load. Try again.</p>
            <Button type="button" tone="ghost" onClick={() => void results.refetch()}>
              Retry search
            </Button>
          </div>
        ) : (
          results.data?.senders.map((sender) => (
            <label className={styles.sender} key={sender.senderKey}>
              <input
                type="checkbox"
                checked={selected.has(sender.senderKey)}
                disabled={
                  sender.protected ||
                  saving ||
                  (!selected.has(sender.senderKey) && selected.size >= 100)
                }
                onChange={(e) => toggle(sender, e.target.checked)}
              />
              <span>
                <strong>{sender.name ?? sender.email ?? 'Unknown sender'}</strong>
                <small>{sender.email}</small>
              </span>
              {sender.protected && <em>Protected</em>}
            </label>
          ))
        )}
        {results.data?.senders.length === 0 && (
          <p className={styles.empty}>No matching senders. Your selections are kept.</p>
        )}
        {(cursors.length > 0 || results.data?.nextCursor) && (
          <nav className={styles.pagination} aria-label="Sender search pages">
            <Button
              type="button"
              tone="ghost"
              size="sm"
              disabled={cursors.length === 0 || results.isFetching}
              onClick={() => setCursors(cursors.slice(0, -1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              tone="ghost"
              size="sm"
              disabled={!results.data?.nextCursor || results.isFetching}
              onClick={() => {
                const next = results.data?.nextCursor;
                if (next) setCursors([...cursors, next]);
              }}
            >
              Next
            </Button>
          </nav>
        )}
        <p id={`${id}-help`} className={styles.muted}>
          Choose up to 100 senders. Protected senders stay excluded.
        </p>
      </fieldset>
      <fieldset className={styles.fieldset}>
        <legend>Action</legend>
        <div className={styles.options}>
          {(['archive', 'delete'] as const).map((value) => (
            <label className={styles.option} key={value}>
              <input
                type="radio"
                name={`${id}-action`}
                value={value}
                checked={action === value}
                onChange={() => {
                  setAction(value);
                  if (value === 'archive') setReach('inbox_only');
                }}
              />
              {value === 'archive' ? 'Archive' : 'Delete'}
            </label>
          ))}
        </div>
      </fieldset>
      <div className={styles.fieldRow}>
        {action === 'delete' ? (
          <label className={styles.field}>
            Include
            <select
              className={styles.select}
              value={reach}
              onChange={(e) => setReach(e.target.value as SenderRuleConfig['reach'])}
            >
              <option value="inbox_only">Inbox only</option>
              <option value="all_mail">Inbox and archived</option>
            </select>
          </label>
        ) : (
          <p className={styles.field}>
            Include<span className={styles.muted}>Inbox only</span>
          </p>
        )}
        <label className={styles.field}>
          Email age
          <select
            className={styles.select}
            value={age ?? 'any'}
            onChange={(e) =>
              setAge(e.target.value === 'any' ? null : (Number(e.target.value) as 30 | 90 | 180))
            }
          >
            <option value="any">Any age</option>
            {[30, 90, 180].map((days) => (
              <option key={days} value={days}>
                Older than {days} days
              </option>
            ))}
          </select>
        </label>
      </div>
      {attempted && !valid && (
        <p className={styles.error} role="alert">
          Add a rule name and choose at least one sender.
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <Button type="submit" tone="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save rule'}
        </Button>
      </div>
      <p className={styles.muted}>
        Saving a rule never moves email. Preview a batch when you’re ready.
      </p>
    </form>
  );
}
