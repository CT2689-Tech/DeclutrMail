'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@declutrmail/shared';
import { hasCapability, undoWindowDaysFor } from '@declutrmail/shared/entitlements';
import { useOptionalAuth, getActiveMailboxEmail } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY } from '@/features/auth/api/use-me';
import { acceptActionFeedback } from '@/features/undo/feedback-store';
import { newIdempotencyKey } from '@/lib/api/actions';
import { apiErrorCode } from '@/lib/api/client';
import { fetchAutopilotRules, type AutopilotRuleDto } from '@/lib/api/autopilot';
import {
  fetchSenderRules,
  previewSenderRule,
  executeSenderRule,
  type SenderRule,
  type SenderRuleExecution,
  type RuleSender,
} from '@/lib/api/autopilot-sender-rules';
import { loadErrorDescription } from '@/lib/load-error-copy';
import { track } from '@/lib/posthog';
import { ConfirmModalFrame } from './confirm-modal-frame';
import { senderRuleFailureCopy } from './sender-rule-feedback';
import styles from './sender-rule-library.module.css';

export type FrozenRuleTarget =
  | { kind: 'sender'; rule: SenderRule }
  | { kind: 'preset'; rule: AutopilotRuleDto; senderKeys?: string[] };
const num = (n: number) => n.toLocaleString('en-US');
const verb = (v: string) => (v === 'delete' ? 'Delete' : 'Archive');
function errorCopy(error: unknown, operation: 'preview' | 'execute' = 'preview') {
  const code = apiErrorCode(error);
  return (
    (code && senderRuleFailureCopy([code])) ||
    (code === 'AUTOPILOT_RULE_CHANGED'
      ? 'This rule changed. Refresh it and try again.'
      : code === 'AUTOPILOT_PREVIEW_EXPIRED'
        ? 'This preview expired. Refresh the preview to continue.'
        : operation === 'execute'
          ? 'Confirmation couldn’t be verified. Retry this batch or check Activity.'
          : loadErrorDescription(error))
  );
}

/** One exact-message approval flow for sender rules and configured preset Delete. */
export function FrozenRulePreview({
  target,
  mailboxId,
  available,
  onCancel,
  onApproved,
}: {
  target: FrozenRuleTarget;
  mailboxId: string | undefined;
  available: boolean;
  onCancel: () => void;
  onApproved: (result: SenderRuleExecution, name: string) => void;
}) {
  const auth = useOptionalAuth();
  const qc = useQueryClient();
  const [current, setCurrent] = useState(target);
  const rule = current.rule;
  const action = current.kind === 'sender' ? current.rule.action : 'delete';
  const [excluded, setExcluded] = useState<string[]>([]);
  const [generation, setGeneration] = useState(0);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now);
  const idempotency = useRef(newIdempotencyKey());
  const presetSenders = useRef<RuleSender[]>([]);
  const presetUniverse = useRef<string[] | undefined>(
    target.kind === 'preset' ? target.senderKeys : undefined,
  );
  const [selectionNotice, setSelectionNotice] = useState('');
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const preview = useQuery({
    queryKey: [
      'autopilot-sender-rule-preview',
      mailboxId,
      rule.id,
      rule.version,
      excluded,
      generation,
      current.kind,
      current.kind === 'preset' ? current.senderKeys : null,
    ],
    queryFn: ({ signal }) =>
      current.kind === 'sender'
        ? previewSenderRule(current.rule, excluded, signal, mailboxId)
        : previewSenderRule(
            { id: rule.id, version: rule.version! },
            excluded,
            signal,
            mailboxId,
            presetUniverse.current,
          ),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
  });
  useEffect(() => {
    if (current.kind === 'preset' && preview.data && !preview.isPlaceholderData) {
      if (presetUniverse.current === undefined)
        presetUniverse.current = preview.data.senders.map((s) => s.senderKey);
      const allowed = new Set(presetUniverse.current);
      const byKey = new Map(presetSenders.current.map((s) => [s.senderKey, s]));
      for (const sender of preview.data.senders)
        if (allowed.has(sender.senderKey)) byKey.set(sender.senderKey, sender);
      presetSenders.current = [...byKey.values()].slice(0, 100);
    }
  }, [current.kind, preview.data, preview.isPlaceholderData]);
  // Include current response immediately; the ref retains excluded identities between checks.
  const candidates =
    current.kind === 'sender'
      ? current.rule.senders
      : [
          ...new Map(
            [...presetSenders.current, ...(preview.data?.senders ?? [])].map((s) => [
              s.senderKey,
              s,
            ]),
          ).values(),
        ];
  const checking =
    preview.isFetching ||
    preview.isPlaceholderData ||
    preview.fetchStatus === 'paused' ||
    refreshing;
  const expired = preview.data ? Date.parse(preview.data.expiresAt) <= now : false;
  const execute = useMutation({
    mutationFn: () =>
      executeSenderRule(rule, preview.data!.previewId, idempotency.current, mailboxId),
    onSuccess: (result) => {
      const senders = preview.data!.senders;
      if (result.actionIds.length > 0)
        acceptActionFeedback(mailboxId, {
          groupId: result.batchId,
          verb: action,
          mixedVerbs: false,
          senderCount: senders.length,
          senderIds: senders.map((s) => s.id),
          senderKeys: senders.map((s) => s.senderKey),
          startedAt: new Date().toISOString(),
        });
      void qc.invalidateQueries({ queryKey: ['autopilot-sender-rules', mailboxId] });
      void qc.invalidateQueries({ queryKey: ['autopilot'] });
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      void track('autopilot_sender_rule_changed', {
        operation: 'confirm',
        action,
        reach: preview.data!.reach,
        sender_count: senders.length,
        message_count: result.requestedCount,
      });
      onApproved(result, rule.name);
    },
  });
  const canConfirm =
    !!preview.data &&
    !checking &&
    !preview.isError &&
    !expired &&
    !refreshError &&
    available &&
    hasCapability(auth?.me.tier ?? 'free', 'autopilot') &&
    rule.enabled &&
    rule.mode === 'observe' &&
    preview.data.messageCount > 0 &&
    preview.data.version === rule.version &&
    !execute.isPending;
  const refresh = async () => {
    if (execute.isPending) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      if (current.kind === 'sender') {
        const rules = await fetchSenderRules(new AbortController().signal, mailboxId);
        const next = rules.find((r) => r.id === rule.id);
        if (!next)
          throw new Error(
            'This rule is no longer available. Close this preview and choose another rule.',
          );
        setExcluded((keys) => keys.filter((key) => next.senderKeys.includes(key)));
        setCurrent({ kind: 'sender', rule: next });
      } else {
        const { data: rules } = await fetchAutopilotRules(new AbortController().signal, mailboxId);
        const next = rules.find((r) => r.id === rule.id);
        if (!next || next.actionKind !== 'delete')
          throw new Error('This rule changed. Close this preview and review its settings.');
        presetSenders.current = [];
        presetUniverse.current = current.senderKeys;
        setExcluded([]);
        setSelectionNotice('Preview refreshed. Check the sender selection before approving.');
        setCurrent({ ...current, rule: next });
      }
      execute.reset();
      idempotency.current = newIdempotencyKey();
      setGeneration((n) => n + 1);
    } catch (error) {
      setRefreshError(error);
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <ConfirmModalFrame
      title={
        preview.data && !checking && !preview.isError
          ? `${verb(action)} ${num(preview.data.messageCount)} email${preview.data.messageCount === 1 ? '' : 's'}?`
          : 'Check this batch'
      }
      subtitle={
        action === 'delete'
          ? 'Move this batch to Trash. Future email is unchanged.'
          : 'Move this batch out of Inbox.'
      }
      note={`Approving queues this batch. During a Schedule pause, it waits until the window ends. Undo from Activity within ${undoWindowDaysFor(auth?.me.tier ?? 'free')} days.`}
      mailboxEmail={auth ? (getActiveMailboxEmail(auth.me) ?? undefined) : undefined}
      confirmLabel={verb(action)}
      confirmBusyLabel="Queueing…"
      confirmTone={action === 'delete' ? 'danger' : 'primary'}
      canConfirm={canConfirm}
      isBusy={execute.isPending}
      error={
        execute.isError
          ? errorCopy(execute.error, 'execute')
          : refreshError
            ? errorCopy(refreshError)
            : null
      }
      onCancel={() => {
        if (!execute.isPending) onCancel();
      }}
      onConfirm={() => {
        if (canConfirm) execute.mutate();
      }}
      footer={
        expired || preview.isError || execute.isError || refreshError ? (
          <Button
            tone="ghost"
            disabled={execute.isPending || checking}
            onClick={() => void refresh()}
          >
            Refresh preview
          </Button>
        ) : undefined
      }
    >
      {preview.isPending ? (
        <p role="status">Checking current email…</p>
      ) : preview.isError ? (
        <p role="alert">{errorCopy(preview.error)}</p>
      ) : preview.data ? (
        <>
          {checking && (
            <p role="status">
              {preview.fetchStatus === 'paused' ? 'Waiting for connection…' : 'Refreshing preview…'}
            </p>
          )}
          <p className={styles.summary}>
            {verb(preview.data.action)} ·{' '}
            {preview.data.reach === 'all_mail' ? 'Inbox + archived' : 'Inbox only'} ·{' '}
            {preview.data.olderThanDays === null
              ? 'Any age'
              : `Older than ${preview.data.olderThanDays} days`}
          </p>
          {expired && <p role="alert">This preview expired. Refresh to continue.</p>}
          {!checking && preview.data.hasMore && (
            <p>
              This batch includes {num(preview.data.messageCount)} of{' '}
              {num(preview.data.totalEligibleCount)} matching emails. Preview again after it
              finishes for the next batch.
            </p>
          )}
          {preview.data.messageCount === 0 && <p>No emails can be included in this batch.</p>}
          {preview.data.protectedSenderCount > 0 && (
            <p>
              {num(preview.data.protectedSenderCount)} Protected sender
              {preview.data.protectedSenderCount === 1 ? '' : 's'} excluded.
            </p>
          )}
        </>
      ) : null}
      {!available && (
        <p role="alert">
          Rule settings couldn’t be verified. Close this preview and reload Autopilot.
        </p>
      )}
      {(!rule.enabled || rule.mode !== 'observe') && (
        <p role="status">Enable this rule in Watch first before approving a batch.</p>
      )}
      {selectionNotice && <p role="status">{selectionNotice}</p>}
      <p className={styles.muted}>Choose which senders to include this time.</p>
      {candidates.map((sender) => {
        const match = preview.data?.senders.find((s) => s.senderKey === sender.senderKey);
        const protectedSender = sender.protected || match?.protected;
        return (
          <label className={styles.sender} key={sender.senderKey}>
            <input
              type="checkbox"
              checked={!excluded.includes(sender.senderKey) && !protectedSender}
              disabled={protectedSender || execute.isPending || checking}
              onChange={(e) => {
                execute.reset();
                idempotency.current = newIdempotencyKey();
                setExcluded((keys) =>
                  e.target.checked
                    ? keys.filter((k) => k !== sender.senderKey)
                    : [...keys, sender.senderKey],
                );
              }}
            />
            <span>
              <strong>{sender.name ?? sender.email ?? 'Unknown sender'}</strong>
              <small>{sender.email}</small>
            </span>
            {protectedSender ? (
              <em>Protected</em>
            ) : (
              <span className={styles.count}>
                {checking
                  ? 'Checking…'
                  : preview.isError || refreshError
                    ? 'Unavailable'
                    : excluded.includes(sender.senderKey)
                      ? 'Excluded'
                      : match
                        ? `${num(match.messageCount)} email${match.messageCount === 1 ? '' : 's'}`
                        : 'Not in this batch'}
              </span>
            )}
          </label>
        );
      })}
    </ConfirmModalFrame>
  );
}
