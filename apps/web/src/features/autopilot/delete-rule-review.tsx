'use client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@declutrmail/shared';
import { postRulePreview, type AutopilotRuleDto } from '@/lib/api/autopilot';
import { RulePreviewExclusions } from './rule-preview-panel';
import { presetDisplayName } from './preset-labels';
import styles from './review-queue.module.css';

export const deleteRuleMatchOptions = (rule: AutopilotRuleDto, mailboxId: string | undefined) => ({
  queryKey: ['autopilot', 'delete-review', mailboxId, rule.id, rule.version],
  queryFn: () => postRulePreview(rule.id, false, mailboxId).then((r) => r.data),
  retry: false as const,
});

export function DeleteRuleReview({
  rule,
  mailboxId,
  onPreview,
}: {
  rule: AutopilotRuleDto;
  mailboxId: string | undefined;
  onPreview: () => void;
}) {
  const preview = useQuery(deleteRuleMatchOptions(rule, mailboxId));
  const name = presetDisplayName(rule.presetKey, rule.name);
  return (
    <section aria-label={`Delete batch from ${name}`} className={styles.group}>
      <div className={styles.groupHeader}>
        <div>
          <h3>{name}</h3>
          <p>
            Delete · {rule.actionPayload.reach === 'all_mail' ? 'Inbox + archived' : 'Inbox only'} ·
            Approval first
          </p>
        </div>
        <Button
          tone="primary"
          onClick={onPreview}
          disabled={preview.isPending || preview.isError || !preview.data?.actionableMessageCount}
        >
          Preview batch
        </Button>
      </div>
      {preview.isPending ? (
        <p role="status">Checking current matches…</p>
      ) : preview.isError ? (
        <div role="alert">
          Current matches couldn’t be checked.{' '}
          <Button tone="ghost" onClick={() => void preview.refetch()}>
            Check again
          </Button>
        </div>
      ) : (
        <div>
          <p>
            {preview.data?.actionableMessageCount.toLocaleString('en-US') ?? '—'} email
            {preview.data?.actionableMessageCount === 1 ? '' : 's'} available to Delete ·{' '}
            {preview.data?.actionableSenderCount.toLocaleString('en-US') ?? '—'} sender
            {preview.data?.actionableSenderCount === 1 ? '' : 's'}. Preview before moving anything
            to Trash.
          </p>
          {preview.data && <RulePreviewExclusions result={preview.data} actionKind="delete" />}
        </div>
      )}
    </section>
  );
}
