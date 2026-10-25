'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Button, ScreenIntro, Skeleton } from '@declutrmail/shared';
import {
  hasCapability,
  minimumTierForCapability,
  TIER_MANIFEST,
} from '@declutrmail/shared/entitlements';
import { useOptionalAuth, getActiveMailboxEmail } from '@/features/auth/auth-provider';
import { apiErrorCode } from '@/lib/api/client';
import { newIdempotencyKey } from '@/lib/api/actions';
import {
  saveSenderRule,
  retireSenderRule,
  setSenderRuleMode,
  type SenderRule,
  type SenderRuleExecution,
  type SenderRuleConfig,
} from '@/lib/api/autopilot-sender-rules';
import { track } from '@/lib/posthog';
import { loadErrorDescription } from '@/lib/load-error-copy';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { usePauseAll } from './api/use-pause-all';
import { useSenderRules } from './api/use-sender-rules';
import { ConfirmModalFrame } from './confirm-modal-frame';
import { SenderRuleEditor, useDebouncedQuery } from './sender-rule-editor';
import styles from './sender-rule-library.module.css';
import { QuietWatch } from './quiet-watch';
import { presetDisplayName } from './preset-labels';
import type { AutopilotWorkspace } from './autopilot-screen';

const num = (value: number) => value.toLocaleString('en-US');
const verb = (action: SenderRuleConfig['action']) => (action === 'archive' ? 'Archive' : 'Delete');
export function senderRuleSummary(
  rule: Pick<SenderRuleConfig, 'action' | 'reach' | 'olderThanDays'>,
) {
  return `${verb(rule.action)} · ${rule.reach === 'all_mail' ? 'Inbox and archived' : 'Inbox only'} · ${rule.olderThanDays === null ? 'Any age' : `Older than ${rule.olderThanDays} days`}`;
}
export { senderRuleFailureCopy } from './sender-rule-feedback';
import { senderRuleFailureCopy } from './sender-rule-feedback';
import { deleteRuleMatchOptions } from './delete-rule-review';
import { FrozenRulePreview } from './frozen-rule-preview';
import { ApprovedBatches } from './approved-batches';

function ruleError(error: unknown, operation: 'save' | 'preview' | 'execute' | 'retire') {
  const code = apiErrorCode(error);
  const stopReason = code ? senderRuleFailureCopy([code]) : null;
  if (stopReason) return stopReason;
  if (code === 'AUTOPILOT_RULE_CHANGED' || code === 'AUTOPILOT_PREVIEW_CHANGED')
    return 'This rule changed. Refresh it and try again.';
  if (code === 'AUTOPILOT_RULE_PAUSED')
    return 'This rule is paused. Resume it before previewing a batch.';
  if (code === 'AUTOPILOT_PREVIEW_EMPTY')
    return 'No eligible email remains. Refresh the preview to check again.';
  if (code === 'AUTOPILOT_RULE_LIMIT')
    return 'You have 50 rules. Retire one before adding another.';
  if (code === 'AUTOPILOT_PREVIEW_EXPIRED')
    return 'This preview expired. Refresh the preview to continue.';
  if (code === 'PROTECTED_SENDER')
    return 'A sender is now Protected. Refresh the rule and choose again.';
  if (operation === 'execute')
    return 'Confirmation couldn’t be verified. Retry this batch or check Activity.';
  return loadErrorDescription(error);
}

export function SenderRuleLibrary({
  presetRules = [],
  presetsAvailable = false,
  renderPresetRule,
  workspace,
  renderReview,
}: {
  presetRules?: AutopilotRuleDto[];
  presetsAvailable?: boolean;
  renderPresetRule: (rule: AutopilotRuleDto) => ReactNode;
  workspace?: AutopilotWorkspace | undefined;
  renderReview?: ((customMatches: ReactNode, hasCustomMatches: boolean) => ReactNode) | undefined;
}) {
  const auth = useOptionalAuth();
  const mailboxId = auth?.me.activeMailboxId ?? undefined;
  // Remount local drafts/preview tokens synchronously when mailbox scope changes.
  return (
    <SenderRuleLibraryScope
      key={mailboxId ?? 'none'}
      mailboxId={mailboxId}
      presetRules={presetRules}
      presetsAvailable={presetsAvailable}
      renderPresetRule={renderPresetRule}
      workspace={workspace}
      renderReview={renderReview}
    />
  );
}

export function SenderRuleLibraryScope({
  mailboxId,
  presetRules = [],
  presetsAvailable = false,
  renderPresetRule,
  workspace,
  renderReview,
}: {
  mailboxId: string | undefined;
  presetRules?: AutopilotRuleDto[];
  presetsAvailable?: boolean;
  renderPresetRule: (rule: AutopilotRuleDto) => ReactNode;
  workspace?: AutopilotWorkspace | undefined;
  renderReview?: ((customMatches: ReactNode, hasCustomMatches: boolean) => ReactNode) | undefined;
}) {
  const auth = useOptionalAuth();
  const email = auth ? getActiveMailboxEmail(auth.me) : undefined;
  const entitled = auth ? hasCapability(auth.me.tier, 'autopilot') : true;
  const requiredPlan = TIER_MANIFEST[minimumTierForCapability('autopilot')].name;
  const qc = useQueryClient();
  const pauseAll = usePauseAll();
  const [pauseOpen, setPauseOpen] = useState(false);
  const [search, setSearch] = useState('');
  const query = useDebouncedQuery(search);
  const [cursors, setCursors] = useState<string[]>([]);
  const [selected, setSelected] = useState<SenderRule | null>(null);
  const createKey = useRef('');
  const [editing, setEditing] = useState<'create' | 'edit' | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const libraryHeading = useRef<HTMLHeadingElement>(null);
  const approvalsRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState<(SenderRuleExecution & { ruleName?: string }) | null>(
    null,
  );
  useEffect(() => {
    if (!receipt || workspace?.view === 'rules') return;
    approvalsRef.current?.querySelector<HTMLHeadingElement>('h2')?.focus();
  }, [receipt, workspace?.view]);
  useEffect(() => {
    if (workspace?.approvedBatch) setReceipt(workspace.approvedBatch);
  }, [workspace?.approvedBatch]);
  const [filter, setFilter] = useState<'all' | 'ready' | 'paused'>('all');
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const [focusReview, setFocusReview] = useState(0);
  const handledReviewFocus = useRef(0);
  useEffect(() => {
    if (focusReview <= handledReviewFocus.current || editing !== null) return;
    handledReviewFocus.current = focusReview;
    // A row can open its preview and select the rule in the same render.
    // The modal owns focus then; closing it restores its actual opener.
    if (!previewOpen) reviewHeading.current?.focus();
  }, [focusReview, editing, selected?.id, previewOpen]);
  const page = cursors.length;
  const rules = useSenderRules(mailboxId, entitled);
  const planLocked = !entitled || apiErrorCode(rules.error) === 'PRO_FEATURE_REQUIRED';
  const runningPresets = presetRules.filter((rule) => rule.enabled && rule.mode !== 'paused');
  const runningCustom = (rules.data ?? []).filter((rule) => rule.enabled && rule.mode !== 'paused');
  const runningCount = runningPresets.length + runningCustom.length;
  const pausablePresets = presetRules.filter((rule) => rule.mode !== 'paused');
  const pausableCustom = (rules.data ?? []).filter((rule) => rule.mode !== 'paused');
  const pausableCount = pausablePresets.length + pausableCustom.length;
  const canPause = presetsAvailable && rules.isSuccess && !rules.isError && runningCount > 0;
  const deleteRules = presetRules.filter((rule) => rule.actionKind === 'delete');
  const deleteMatches = useQueries({
    queries: deleteRules.map((rule) => ({
      ...deleteRuleMatchOptions(rule, mailboxId),
      enabled: entitled,
    })),
  });
  const deleteMatchById = new Map(
    deleteRules.map((rule, index) => [rule.id, deleteMatches[index]]),
  );
  const inventory = [
    ...presetRules.map((rule) => ({ kind: 'preset' as const, rule })),
    ...(rules.data ?? []).map((rule) => ({ kind: 'sender' as const, rule })),
  ];
  const filtered = inventory.filter((item) => {
    const rule = item.rule;
    const name =
      item.kind === 'preset'
        ? `${presetDisplayName(item.rule.presetKey, item.rule.name)} ${item.rule.actionKind}`
        : `${item.rule.name} ${item.rule.senders.map((sender) => sender.name ?? sender.email ?? '').join(' ')}`;
    const pending =
      item.kind === 'preset'
        ? item.rule.actionKind === 'delete'
          ? deleteMatchById.get(item.rule.id)?.isSuccess
            ? (deleteMatchById.get(item.rule.id)?.data?.actionableMessageCount ?? 0)
            : 0
          : (item.rule.observeDigest?.pendingTotal ?? 0)
        : item.rule.matchingMessageCount;
    return (
      name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'paused'
          ? rule.mode === 'paused' || !rule.enabled
          : rule.enabled && rule.mode !== 'paused' && pending > 0))
    );
  });
  const visibleRules = filtered.slice(page * 6, page * 6 + 6);
  const inventoryComplete = presetsAvailable && rules.isSuccess && !rules.isError;
  // A changed search result or a retired rule can remove the final page.
  useEffect(() => {
    if (page > 0 && page * 6 >= filtered.length) setCursors([]);
  }, [page, filtered.length]);
  useEffect(() => {
    if (!rules.data || editing !== null || previewOpen) return;
    if (selected && !rules.data.some((rule) => rule.id === selected.id))
      setFocusReview((value) => value + 1);
    setSelected((current) => {
      const candidate = rules.data.find((rule) => rule.id === current?.id);
      if (candidate && (!current || candidate.version >= current.version)) return candidate;
      return candidate ? current : (rules.data[0] ?? null);
    });
  }, [rules.data, editing, previewOpen]);
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ['autopilot-sender-rules', mailboxId] });
  const save = useMutation({
    mutationFn: (config: SenderRuleConfig) =>
      saveSenderRule(
        config,
        mailboxId,
        editing === 'edit' && selected ? selected : undefined,
        editing === 'create' ? createKey.current : undefined,
      ),
    onSuccess: (rule, config) => {
      qc.setQueryData<SenderRule[]>(['autopilot-sender-rules', mailboxId], (current) =>
        current?.some((item) => item.id === rule.id)
          ? current.map((item) => (item.id === rule.id ? rule : item))
          : [...(current ?? []), rule],
      );
      setSelected(rule);
      setEditing(null);
      setFocusReview((value) => value + 1);
      const sameConfig =
        rule.name === config.name &&
        rule.action === config.action &&
        rule.reach === config.reach &&
        rule.olderThanDays === config.olderThanDays &&
        JSON.stringify([...rule.senderKeys].sort()) ===
          JSON.stringify([...config.senderKeys].sort());
      setNotice(
        sameConfig
          ? 'Rule saved. Email stays where it is.'
          : 'Showing the saved rule; edit it to make further changes.',
      );
      invalidate();
      void track('autopilot_sender_rule_changed', {
        operation: editing === 'edit' ? 'edit' : 'create',
        action: rule.action,
        reach: rule.reach,
        sender_count: rule.senderKeys.length,
        message_count: rule.matchingMessageCount,
      });
    },
  });
  const retire = useMutation({
    mutationFn: (rule: SenderRule) => retireSenderRule(rule, mailboxId),
    onSuccess: (_result, rule) => {
      qc.setQueryData<SenderRule[]>(['autopilot-sender-rules', mailboxId], (current) =>
        current?.filter((item) => item.id !== rule.id),
      );
      setSelected(null);
      setFocusReview((value) => value + 1);
      setNotice('Rule retired.');
      invalidate();
      void track('autopilot_sender_rule_changed', {
        operation: 'retire',
        action: rule.action,
        reach: rule.reach,
        sender_count: rule.senderKeys.length,
        message_count: 0,
      });
    },
  });
  const mode = useMutation({
    mutationFn: (rule: SenderRule) =>
      setSenderRuleMode(rule, rule.mode === 'paused' ? 'observe' : 'paused', mailboxId),
    onSuccess: (rule) => {
      setSelected(rule);
      setFocusReview((value) => value + 1);
      invalidate();
      setNotice(
        rule.mode === 'paused'
          ? 'Rule paused.'
          : 'Rule resumed. Preview a batch when you’re ready.',
      );
    },
  });
  const busy = save.isPending || retire.isPending || mode.isPending || pauseAll.isPending;
  const choose = (rule: SenderRule) => {
    setSelected(rule);
    setEditing(null);
    setDetailOpen(true);
    setFocusReview((value) => value + 1);
    setNotice('');
    save.reset();
    retire.reset();
  };
  const beginCreate = () => {
    workspace?.onViewChange('rules');
    createKey.current = newIdempotencyKey();
    setEditing('create');
    setDetailOpen(true);
    save.reset();
    setNotice('');
  };
  const readyCustomRules = (rules.isError ? [] : (rules.data ?? [])).filter(
    (rule) => rule.enabled && rule.mode === 'observe' && rule.matchingMessageCount > 0,
  );
  const previewBatch = (rule: SenderRule) => {
    setSelected(rule);
    setPreviewOpen(true);
  };
  return (
    <div className={styles.screen} data-testid="sender-rule-library">
      <ScreenIntro
        id="autopilot-sender-rules"
        title="Autopilot"
        body="Choose senders and save rules for Archive or Delete. Saving a sender rule never moves email. Preview and approve each batch. Preset rules have their own Observe and Active settings."
        tip="Use Pause all to pause rules. Resume them individually when you’re ready."
      />
      <header className={styles.header}>
        <div>
          <h1 ref={workspace?.headingRef} tabIndex={-1}>
            Autopilot
          </h1>
          <p>Rules watch for matches. You choose what happens next.</p>
        </div>
        <div className={styles.tools}>
          <Link className={styles.settingsLink} href="/autopilot/settings">
            Settings
          </Link>
          <Button
            tone="default"
            disabled={busy || !canPause}
            onClick={() => {
              pauseAll.reset();
              setPauseOpen(true);
            }}
          >
            Pause all
          </Button>
          <Button
            tone="primary"
            onClick={beginCreate}
            disabled={busy || mailboxId === undefined || rules.isError || planLocked}
          >
            New rule
          </Button>
        </div>
      </header>
      {workspace && (
        <nav className={styles.views} aria-label="Autopilot views">
          {(['review', 'rules'] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={workspace.view === view}
              onClick={() => workspace.onViewChange(view)}
            >
              {view === 'review' ? 'Needs review' : 'Your rules'}
              {view === 'rules' && inventoryComplete && <span>{inventory.length}</span>}
            </button>
          ))}
        </nav>
      )}
      {!planLocked && rules.isSuccess && !rules.isError && presetsAvailable && (
        <QuietWatch
          watching={
            runningCustom.length + runningPresets.filter((rule) => rule.mode === 'observe').length
          }
          automatic={runningPresets.filter((rule) => rule.mode === 'active').length}
          paused={pausableCount < (rules.data?.length ?? 0) + presetRules.length}
        />
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {planLocked ? (
        <section className={styles.card} aria-label="Sender rules plan">
          <span className={styles.badge}>Approval first</span>
          <h2>Make room with your own rules</h2>
          <p>
            Sender rules are included with {requiredPlan}. Choose senders, preview the matching
            emails, and approve each cleanup.
          </p>
          <Link href="/billing">Explore plans</Link>
        </section>
      ) : (
        <div className={styles.split} hidden={workspace?.view === 'review'}>
          <aside className={styles.library} aria-label="Rule library">
            <div id="sender-rule-library-content" className={styles.libraryContent}>
              <div className={styles.libraryHead}>
                <h2 ref={libraryHeading} tabIndex={-1}>
                  Your rules
                </h2>
                <span className={styles.count}>{inventoryComplete ? inventory.length : '—'}</span>
              </div>
              <input
                className={styles.input}
                type="search"
                aria-label="Search rules"
                placeholder="Search rules…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCursors([]);
                }}
              />
              <div className={styles.filters} role="group" aria-label="Filter rules">
                {(['all', 'ready', 'paused'] as const).map((value) => (
                  <button
                    type="button"
                    className={styles.filter}
                    key={value}
                    aria-pressed={filter === value}
                    onClick={() => {
                      setFilter(value);
                      setCursors([]);
                    }}
                  >
                    {value === 'all'
                      ? 'All rules'
                      : value === 'ready'
                        ? 'With matches'
                        : 'Inactive'}
                  </button>
                ))}
              </div>
              {rules.isFetching && (
                <p role="status" className={styles.muted}>
                  Loading rules…
                </p>
              )}
              {rules.isError && (
                <div role="alert">
                  <p className={styles.error}>Rules couldn’t load. Try again.</p>
                  <Button tone="ghost" onClick={() => void rules.refetch()}>
                    Retry
                  </Button>
                </div>
              )}
              <ul className={styles.ruleList} aria-label="Autopilot rules">
                {visibleRules.map((item) => {
                  if (item.kind === 'preset') return renderPresetRule(item.rule);
                  const rule = item.rule;
                  return (
                    <li key={rule.id} className={styles.row}>
                      <button
                        type="button"
                        className={styles.ruleSelect}
                        aria-current={selected?.id === rule.id ? 'true' : undefined}
                        disabled={busy}
                        onClick={() => choose(rule)}
                      >
                        <span>
                          <strong>{rule.name}</strong>
                          <small>{senderRuleSummary(rule)}</small>
                          <small>
                            {rule.enabled
                              ? rule.mode === 'paused'
                                ? 'Paused'
                                : 'Approval first'
                              : 'Retired'}{' '}
                            · {num(rule.matchingMessageCount)} matching emails from{' '}
                            {num(rule.matchingSenderCount)}{' '}
                            {rule.matchingSenderCount === 1 ? 'sender' : 'senders'}
                          </small>
                        </span>
                      </button>
                      <div className={styles.tools}>
                        <Button
                          tone="default"
                          size="sm"
                          ariaLabel={`Edit rule ${rule.name}`}
                          disabled={busy || !rule.enabled}
                          onClick={() => {
                            choose(rule);
                            setEditing('edit');
                            save.reset();
                          }}
                        >
                          Edit rule
                        </Button>
                        <Button
                          tone="ghost"
                          size="sm"
                          ariaLabel={`${rule.mode === 'paused' ? 'Resume rule' : 'Preview batch for'} ${rule.name}`}
                          disabled={busy || !rule.enabled || rules.isError}
                          onClick={() => {
                            choose(rule);
                            if (rule.mode === 'paused') {
                              mode.mutate(rule);
                              return;
                            }
                            setPreviewOpen(true);
                          }}
                        >
                          {rule.mode === 'paused' ? 'Resume rule' : 'Preview batch'}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {filter === 'ready' &&
                deleteMatches.some((query) => query.isPending || query.isError) && (
                  <p role={deleteMatches.some((query) => query.isError) ? 'alert' : 'status'}>
                    {deleteMatches.some((query) => query.isError)
                      ? 'Some Delete matches couldn’t be checked.'
                      : 'Checking Delete matches…'}
                    {deleteMatches.some((query) => query.isError) && (
                      <Button
                        tone="ghost"
                        onClick={() =>
                          void Promise.allSettled(deleteMatches.map((query) => query.refetch()))
                        }
                      >
                        Retry matches
                      </Button>
                    )}
                  </p>
                )}
              {inventoryComplete &&
                filtered.length === 0 &&
                !(
                  filter === 'ready' &&
                  deleteMatches.some((query) => query.isPending || query.isError)
                ) && (
                  <p className={styles.empty}>
                    {query
                      ? 'No rules match your search.'
                      : filter === 'ready'
                        ? 'No rules ready for review.'
                        : filter === 'paused'
                          ? 'No inactive rules.'
                          : 'Your rules will appear here.'}
                  </p>
                )}
              {(page > 0 || filtered.length > (page + 1) * 6) && (
                <nav className={styles.pagination} aria-label="Rule pages">
                  <Button
                    tone="ghost"
                    size="sm"
                    disabled={!cursors.length || rules.isFetching}
                    onClick={() => setCursors(cursors.slice(0, -1))}
                  >
                    Previous
                  </Button>
                  <span>Page {cursors.length + 1}</span>
                  <Button
                    tone="ghost"
                    size="sm"
                    disabled={filtered.length <= (page + 1) * 6 || rules.isFetching}
                    onClick={() => setCursors([...cursors, String(page + 1)])}
                  >
                    Next
                  </Button>
                </nav>
              )}
            </div>
          </aside>
          <div className={styles.review}>
            {(detailOpen ||
              editing !== null ||
              mailboxId === undefined ||
              rules.isError ||
              rules.isPending ||
              (rules.data?.length === 0 && presetRules.length === 0)) && (
              <section
                className={styles.card}
                aria-label={editing ? 'Rule editor' : 'Selected rule'}
              >
                {detailOpen && !editing && selected && (
                  <div className={styles.top}>
                    <Button
                      tone="ghost"
                      size="sm"
                      onClick={() => {
                        setDetailOpen(false);
                        libraryHeading.current?.focus();
                      }}
                    >
                      Close rule
                    </Button>
                  </div>
                )}
                {mailboxId === undefined ? (
                  <>
                    <h2>Choose a Gmail account</h2>
                    <p className={styles.empty}>
                      Choose a connected account to manage its sender rules.
                    </p>
                  </>
                ) : editing ? (
                  <SenderRuleEditor
                    key={editing === 'create' ? 'new' : `${selected?.id}:${selected?.version}`}
                    rule={editing === 'edit' ? selected : null}
                    mailboxId={mailboxId}
                    saving={save.isPending}
                    error={save.isError ? ruleError(save.error, 'save') : null}
                    onSave={(config) => save.mutate(config)}
                    onCancel={() => {
                      setEditing(null);
                      setFocusReview((value) => value + 1);
                    }}
                  />
                ) : selected ? (
                  <>
                    <div className={styles.top}>
                      <span className={styles.badge}>
                        {!selected.enabled
                          ? 'Retired'
                          : selected.mode === 'paused'
                            ? 'Paused'
                            : 'Approval first'}
                      </span>
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing('edit');
                          save.reset();
                        }}
                        disabled={busy || !selected.enabled}
                      >
                        Edit rule
                      </Button>
                    </div>
                    <h2 ref={reviewHeading} tabIndex={-1}>
                      {selected.name}
                    </h2>
                    <p className={styles.muted}>Email from the senders you selected.</p>
                    <p className={styles.summary}>
                      <strong>{senderRuleSummary(selected)}</strong>
                    </p>
                    <div className={styles.section}>
                      <div className={styles.top}>
                        <h3>{num(selected.matchingMessageCount)} matching emails</h3>
                        <span className={styles.count}>
                          {num(selected.matchingSenderCount)}{' '}
                          {selected.matchingSenderCount === 1 ? 'sender' : 'senders'}
                        </span>
                      </div>
                      {selected.senders.map((sender) => (
                        <div className={styles.sender} key={sender.senderKey}>
                          <span>
                            <strong>{sender.name ?? sender.email ?? 'Unknown sender'}</strong>
                            <small>{sender.email}</small>
                          </span>
                          {sender.protected && <em>Protected</em>}
                        </div>
                      ))}
                    </div>
                    <p className={styles.muted}>
                      {selected.checkedAt
                        ? `${Date.now() - Date.parse(selected.checkedAt) > 300000 ? 'Matches may have changed. ' : ''}Checked ${new Date(selected.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Preview refreshes the exact batch.`
                        : 'Preview to check current matches.'}
                    </p>
                    <div className={styles.actions}>
                      <Button
                        tone="primary"
                        disabled={busy || !selected.enabled || rules.isError}
                        onClick={() => {
                          if (selected.mode === 'paused') {
                            mode.mutate(selected);
                            return;
                          }
                          setPreviewOpen(true);
                        }}
                      >
                        {selected.mode === 'paused' ? 'Resume rule' : 'Preview'}
                      </Button>
                      <Button
                        tone="ghost"
                        size="sm"
                        disabled={busy || rules.isFetching}
                        onClick={() => void rules.refetch()}
                      >
                        Refresh rule
                      </Button>
                    </div>
                    <details className={styles.section}>
                      <summary className={styles.muted}>Rule options</summary>
                      {selected.mode !== 'paused' && (
                        <Button
                          tone="ghost"
                          disabled={busy || !selected.enabled}
                          onClick={() => mode.mutate(selected)}
                        >
                          {mode.isPending ? 'Saving…' : 'Pause rule'}
                        </Button>
                      )}
                      <p className={styles.muted}>Retire this rule when you’re finished with it.</p>
                      <Button
                        tone="ghost"
                        disabled={busy || !selected.enabled}
                        onClick={() => retire.mutate(selected)}
                      >
                        {retire.isPending ? 'Retiring…' : 'Retire rule'}
                      </Button>
                    </details>
                    {mode.isError && (
                      <p role="alert" className={styles.error}>
                        {ruleError(mode.error, 'save')}
                      </p>
                    )}
                    {retire.isError && (
                      <p role="alert" className={styles.error}>
                        {ruleError(retire.error, 'retire')}
                      </p>
                    )}
                  </>
                ) : rules.isError ? (
                  <>
                    <h2>Sender rules unavailable</h2>
                    <p className={styles.error}>Try again to load your sender rules.</p>
                    <Button tone="ghost" onClick={() => void rules.refetch()}>
                      Retry rules
                    </Button>
                  </>
                ) : rules.isPending ? (
                  <>
                    <Skeleton width="70%" height={28} />
                    <p className={styles.muted}>Loading your sender rules…</p>
                  </>
                ) : (
                  <>
                    <h2 ref={reviewHeading} tabIndex={-1}>
                      Your first sender rule
                    </h2>
                    <p className={styles.empty}>
                      Choose the senders and what to do with their email.
                    </p>
                    <Button tone="primary" onClick={beginCreate} disabled={mailboxId === undefined}>
                      New rule
                    </Button>
                  </>
                )}
              </section>
            )}
          </div>
        </div>
      )}
      <div ref={approvalsRef} hidden={workspace?.view === 'rules'}>
        {!planLocked && mailboxId && (
          <ApprovedBatches
            mailboxId={mailboxId}
            receipt={receipt}
            compactEmpty={workspace !== undefined}
          />
        )}
      </div>
      {renderReview?.(
        rules.isError ? (
          <div role="alert" className={styles.card}>
            <p className={styles.error}>Couldn’t check your saved rule matches.</p>
            <Button tone="ghost" onClick={() => void rules.refetch()}>
              Retry rules
            </Button>
          </div>
        ) : rules.isPending ? (
          <p role="status" className={styles.muted}>
            Checking saved rule matches…
          </p>
        ) : readyCustomRules.length > 0 ? (
          <section className={styles.readyRules} aria-label="Sender rule batches to review">
            {readyCustomRules.map((rule) => (
              <section className={styles.card} key={rule.id} aria-label={`Review ${rule.name}`}>
                <div className={styles.top}>
                  <div>
                    <h3>{rule.name}</h3>
                    <p className={styles.muted}>{senderRuleSummary(rule)}</p>
                  </div>
                  <Button
                    tone="primary"
                    size="sm"
                    disabled={busy || planLocked}
                    ariaLabel={`Preview batch for ${rule.name}`}
                    onClick={() => previewBatch(rule)}
                  >
                    Preview batch
                  </Button>
                </div>
                <p className={styles.muted}>
                  {num(rule.matchingMessageCount)} matching emails from{' '}
                  {num(rule.matchingSenderCount)}{' '}
                  {rule.matchingSenderCount === 1 ? 'sender' : 'senders'}. Preview checks the
                  current batch.
                </p>
              </section>
            ))}
          </section>
        ) : null,
        readyCustomRules.length > 0 || rules.isError || rules.isPending,
      )}
      {pauseOpen && !planLocked && (
        <ConfirmModalFrame
          title={`Pause ${num(pausableCount)} rules?`}
          subtitle="Pause rules and automatic preset cleanups."
          note="Resume individual rules when you’re ready."
          confirmLabel="Pause all"
          confirmBusyLabel="Pausing…"
          canConfirm={canPause}
          isBusy={pauseAll.isPending}
          mailboxEmail={email ?? undefined}
          error={pauseAll.isError ? loadErrorDescription(pauseAll.error) : null}
          onCancel={() => {
            if (!pauseAll.isPending) setPauseOpen(false);
          }}
          onConfirm={() => {
            if (canPause && !pauseAll.isPending)
              pauseAll.mutate(undefined, {
                onSuccess: () => {
                  setPauseOpen(false);
                },
              });
          }}
        >
          <ul>
            {pausableCustom.map((rule) => (
              <li key={rule.id}>{rule.name}</li>
            ))}
            {pausablePresets.map((rule) => (
              <li key={rule.id}>
                {rule.name}
                {rule.mode === 'active' ? ' · Active' : ' · Observe'}
              </li>
            ))}
          </ul>
        </ConfirmModalFrame>
      )}
      {previewOpen && selected && !planLocked && (
        <FrozenRulePreview
          key={selected.id}
          target={{ kind: 'sender', rule: selected }}
          mailboxId={mailboxId}
          available={rules.isSuccess && !rules.isError}
          onCancel={() => setPreviewOpen(false)}
          onApproved={(result, name) => {
            setReceipt({ ...result, ruleName: name });
            workspace?.onViewChange('review');
            setPreviewOpen(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}
