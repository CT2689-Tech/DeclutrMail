'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Button, ScreenIntro, Skeleton } from '@declutrmail/shared';
import {
  hasCapability,
  minimumTierForCapability,
  TIER_MANIFEST,
  undoWindowDaysFor,
} from '@declutrmail/shared/entitlements';
import { useOptionalAuth, getActiveMailboxEmail } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY } from '@/features/auth/api/use-me';
import { acceptActionFeedback } from '@/features/undo/feedback-store';
import { apiErrorCode } from '@/lib/api/client';
import { newIdempotencyKey } from '@/lib/api/actions';
import {
  saveSenderRule,
  retireSenderRule,
  setSenderRuleMode,
  previewSenderRule,
  executeSenderRule,
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

const num = (value: number) => value.toLocaleString('en-US');
const verb = (action: SenderRuleConfig['action']) => (action === 'archive' ? 'Archive' : 'Delete');
export function senderRuleSummary(
  rule: Pick<SenderRuleConfig, 'action' | 'reach' | 'olderThanDays'>,
) {
  return `${verb(rule.action)} · ${rule.reach === 'all_mail' ? 'Inbox and archived' : 'Inbox only'} · ${rule.olderThanDays === null ? 'Any age' : `Older than ${rule.olderThanDays} days`}`;
}
export { senderRuleFailureCopy } from './sender-rule-feedback';
import { senderRuleFailureCopy } from './sender-rule-feedback';
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
}: {
  presetRules?: AutopilotRuleDto[];
  presetsAvailable?: boolean;
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
    />
  );
}

export function SenderRuleLibraryScope({
  mailboxId,
  presetRules = [],
  presetsAvailable = false,
}: {
  mailboxId: string | undefined;
  presetRules?: AutopilotRuleDto[];
  presetsAvailable?: boolean;
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
  const [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState<(SenderRuleExecution & { ruleName?: string }) | null>(
    null,
  );
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
  const filteredRules = (rulesData: SenderRule[]) =>
    rulesData.filter(
      (rule) =>
        `${rule.name} ${rule.senders.map((sender) => sender.name ?? sender.email ?? '').join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === 'all' ||
          (filter === 'paused'
            ? rule.mode === 'paused' || !rule.enabled
            : rule.enabled && rule.mode !== 'paused' && rule.matchingMessageCount > 0)),
    );
  const rules = useSenderRules(mailboxId, entitled);
  const planLocked = !entitled || apiErrorCode(rules.error) === 'PRO_FEATURE_REQUIRED';
  const runningPresets = presetRules.filter((rule) => rule.enabled && rule.mode !== 'paused');
  const runningCustom = (rules.data ?? []).filter((rule) => rule.enabled && rule.mode !== 'paused');
  const runningCount = runningPresets.length + runningCustom.length;
  const pausablePresets = presetRules.filter((rule) => rule.mode !== 'paused');
  const pausableCustom = (rules.data ?? []).filter((rule) => rule.mode !== 'paused');
  const pausableCount = pausablePresets.length + pausableCustom.length;
  const canPause = presetsAvailable && rules.isSuccess && !rules.isError && runningCount > 0;
  const filtered = filteredRules(rules.data ?? []);
  const visibleRules = filtered.slice(page * 6, page * 6 + 6);
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
  const [excluded, setExcluded] = useState<string[]>([]);
  const [previewGeneration, setPreviewGeneration] = useState(0);
  const preview = useQuery({
    queryKey: [
      'autopilot-sender-rule-preview',
      mailboxId,
      selected?.id,
      selected?.version,
      excluded,
      previewGeneration,
    ],
    queryFn: ({ signal }) => previewSenderRule(selected!, excluded, signal, mailboxId),
    enabled: previewOpen && selected !== null,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
  });
  const previewChecking =
    preview.isFetching || preview.isPlaceholderData || preview.fetchStatus === 'paused';
  const trackedPreview = useRef<string | null>(null);
  useEffect(() => {
    if (
      !previewOpen ||
      !preview.data ||
      preview.isFetching ||
      trackedPreview.current === preview.data.previewId
    )
      return;
    trackedPreview.current = preview.data.previewId;
    void track('autopilot_sender_rule_changed', {
      operation: 'preview',
      action: preview.data.action,
      reach: preview.data.reach,
      sender_count: preview.data.senders.length,
      message_count: preview.data.messageCount,
    });
  }, [previewOpen, preview.data, preview.isFetching]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!previewOpen) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [previewOpen]);
  const expired = preview.data ? Date.parse(preview.data.expiresAt) <= now : false;
  const idempotency = useRef('');
  const execute = useMutation({
    mutationFn: () =>
      executeSenderRule(selected!, preview.data!.previewId, idempotency.current, mailboxId),
    onSuccess: (result) => {
      setReceipt({ ...result, ruleName: selected!.name });
      setPreviewOpen(false);
      invalidate();
      void track('autopilot_sender_rule_changed', {
        operation: 'confirm',
        action: selected!.action,
        reach: selected!.reach,
        sender_count: preview.data?.senders.length ?? 0,
        message_count: result.requestedCount,
      });
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      const senders =
        preview.data?.senders.filter(
          (s) => !s.protected && !excluded.includes(s.senderKey) && s.messageCount > 0,
        ) ?? [];
      if (result.actionIds.length > 0)
        acceptActionFeedback(mailboxId, {
          groupId: result.batchId,
          verb: selected!.action,
          mixedVerbs: false,
          senderCount: senders.length,
          senderIds: senders.map((s) => s.id),
          senderKeys: senders.map((s) => s.senderKey),
          startedAt: new Date().toISOString(),
        });
    },
  });
  const busy =
    save.isPending || retire.isPending || mode.isPending || execute.isPending || pauseAll.isPending;
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
    createKey.current = newIdempotencyKey();
    setEditing('create');
    setDetailOpen(true);
    save.reset();
    setNotice('');
  };
  const refreshPreview = () => {
    execute.reset();
    idempotency.current = newIdempotencyKey();
    setPreviewGeneration((value) => value + 1);
  };
  const refreshStalePreview = async () => {
    const result = await rules.refetch();
    if (result.isError) return;
    const current = result.data?.find((rule) => rule.id === selected?.id);
    if (!current) {
      setPreviewOpen(false);
      setSelected(result.data?.[0] ?? null);
      setNotice('This rule was retired. Choose another rule or create a new one.');
      setFocusReview((value) => value + 1);
      return;
    }
    setSelected(current);
    refreshPreview();
  };
  const canConfirm =
    !!preview.data &&
    !previewChecking &&
    !preview.isError &&
    !expired &&
    preview.data.messageCount > 0 &&
    preview.data.version === selected?.version &&
    !execute.isPending &&
    rules.isSuccess &&
    !rules.isError &&
    selected?.enabled === true &&
    selected.mode === 'observe' &&
    !planLocked;
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
          <h1>Autopilot</h1>
          <p>Good rules. A lighter inbox.</p>
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
      {!planLocked && rules.isSuccess && !rules.isError && presetsAvailable && (
        <QuietWatch
          watching={
            runningCustom.length + runningPresets.filter((rule) => rule.mode === 'observe').length
          }
          automatic={runningPresets.filter((rule) => rule.mode === 'active').length}
          paused={pausableCount < (rules.data?.length ?? 0) + presetRules.length}
          onReview={() => {
            libraryHeading.current?.scrollIntoView({ block: 'start' });
            libraryHeading.current?.focus({ preventScroll: true });
          }}
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
        <div className={styles.split}>
          <aside className={styles.library} aria-label="Sender rule library">
            <div id="sender-rule-library-content" className={styles.libraryContent}>
              <div className={styles.libraryHead}>
                <h2 ref={libraryHeading} tabIndex={-1}>
                  Your rules
                </h2>
                <span className={styles.count}>{rules.data?.length ?? '—'}</span>
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
              <div className={styles.filters} role="group" aria-label="Filter sender rules">
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
                    {value === 'all' ? 'All rules' : value === 'ready' ? 'Ready' : 'Paused'}
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
              {visibleRules.map((rule) => (
                <div key={rule.id} className={styles.row}>
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
                        setExcluded([]);
                        setPreviewOpen(true);
                        refreshPreview();
                      }}
                    >
                      {rule.mode === 'paused' ? 'Resume rule' : 'Preview batch'}
                    </Button>
                  </div>
                </div>
              ))}
              {!rules.isPending && rules.data !== undefined && filtered.length === 0 && (
                <p className={styles.empty}>
                  {query ? 'No rules match your search.' : 'Your rules will appear here.'}
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
              rules.data?.length === 0) && (
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
                          setExcluded([]);
                          setPreviewOpen(true);
                          refreshPreview();
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
      {!planLocked && mailboxId && <ApprovedBatches mailboxId={mailboxId} receipt={receipt} />}
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
        <ConfirmModalFrame
          title={
            preview.data && !previewChecking && !preview.isError
              ? `${verb(preview.data.action)} ${num(preview.data.messageCount)} emails?`
              : 'Check this batch'
          }
          subtitle={
            selected.action === 'delete'
              ? 'Move this batch to Trash. Future email is unchanged.'
              : 'Move this batch out of Inbox.'
          }
          note={`Approving queues this batch. During a Schedule pause, it waits until the window ends. Undo from Activity within ${undoWindowDaysFor(auth?.me.tier ?? 'free')} days.`}
          mailboxEmail={email ?? undefined}
          confirmLabel={verb(selected.action)}
          confirmBusyLabel="Queueing…"
          confirmTone={selected.action === 'delete' ? 'danger' : 'primary'}
          canConfirm={canConfirm}
          isBusy={execute.isPending}
          error={execute.isError ? ruleError(execute.error, 'execute') : null}
          onCancel={() => {
            if (!execute.isPending) setPreviewOpen(false);
          }}
          onConfirm={() => {
            if (canConfirm) execute.mutate();
          }}
          footer={
            expired || preview.isError || execute.isError ? (
              <Button
                tone="ghost"
                disabled={execute.isPending || preview.isFetching}
                onClick={() => void refreshStalePreview()}
              >
                Refresh preview
              </Button>
            ) : undefined
          }
        >
          {preview.isFetching && !preview.data ? (
            <p role="status" className={styles.muted}>
              Checking current email…
            </p>
          ) : preview.isError ? (
            <p role="alert" className={styles.error}>
              {ruleError(preview.error, 'preview')}
            </p>
          ) : preview.data ? (
            <>
              {previewChecking && (
                <p role="status" className={styles.muted}>
                  {preview.fetchStatus === 'paused'
                    ? 'Waiting for connection…'
                    : 'Refreshing preview…'}
                </p>
              )}
              <p className={styles.summary}>{senderRuleSummary(preview.data)}</p>
              {expired && (
                <p role="alert" className={styles.error}>
                  This preview expired. Refresh to continue.
                </p>
              )}
              {!previewChecking && preview.data.hasMore && (
                <p className={styles.muted}>
                  This batch includes {num(preview.data.messageCount)} of{' '}
                  {num(preview.data.totalEligibleCount)} eligible emails. Preview again after it
                  finishes for the next batch.
                </p>
              )}
              {preview.data.messageCount === 0 && (
                <p className={styles.empty}>No matching email in this batch.</p>
              )}
              {preview.data.protectedSenderCount > 0 && (
                <p className={styles.muted}>
                  {num(preview.data.protectedSenderCount)} Protected senders excluded.
                </p>
              )}
            </>
          ) : null}
          <p className={styles.muted}>Choose which senders to include this time.</p>
          {selected.senders.map((sender) => {
            const match = preview.data?.senders.find((item) => item.senderKey === sender.senderKey);
            const protectedSender = sender.protected || match?.protected;
            return (
              <label className={styles.sender} key={sender.senderKey}>
                <input
                  type="checkbox"
                  checked={!excluded.includes(sender.senderKey) && !protectedSender}
                  disabled={protectedSender || execute.isPending}
                  onChange={(e) => {
                    execute.reset();
                    idempotency.current = newIdempotencyKey();
                    setExcluded((current) =>
                      e.target.checked
                        ? current.filter((key) => key !== sender.senderKey)
                        : [...current, sender.senderKey],
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
                    {previewChecking ? 'Checking…' : match ? num(match.messageCount) : '—'}
                  </span>
                )}
              </label>
            );
          })}
        </ConfirmModalFrame>
      )}
    </div>
  );
}
