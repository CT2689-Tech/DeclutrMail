'use client';

import { useId, useState } from 'react';
import { CleanupSelect } from '@/components/cleanup-select';
import { Button } from '@declutrmail/shared';
import {
  AutopilotRuleConfigurationSchema,
  defaultAutopilotConditions,
  type AutopilotRuleConditions,
  type AutopilotRuleConfiguration,
} from '@declutrmail/shared/contracts';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { presetDisplayName } from './preset-labels';
import styles from './sender-rule-library.module.css';

export function PresetRuleEditor({
  rule,
  saving,
  disabled = false,
  onSave,
  onCancel,
}: {
  rule: AutopilotRuleDto;
  saving: boolean;
  disabled?: boolean;
  onSave: (configuration: AutopilotRuleConfiguration) => Promise<string | null>;
  onCancel: () => void;
}) {
  const id = useId();
  // A draft retains the revision it opened with; background refetches never rebase it silently.
  const [version] = useState(rule.version);
  const [name, setName] = useState(presetDisplayName(rule.presetKey, rule.name));
  const [conditions, setConditions] = useState<AutopilotRuleConditions>(() => {
    const c =
      rule.conditions ?? defaultAutopilotConditions(rule.presetKey, rule.confidenceThreshold);
    return c.kind === 'recommendation'
      ? { ...c, confidence: rule.confidenceThreshold ?? c.confidence }
      : c;
  });
  const [actionKind, setAction] = useState<AutopilotRuleConfiguration['actionKind']>(
    rule.actionKind,
  );
  const [reach, setReach] = useState<'inbox_only' | 'all_mail'>(
    rule.actionKind === 'delete' && rule.actionPayload.reach === 'all_mail'
      ? 'all_mail'
      : 'inbox_only',
  );
  const [error, setError] = useState<string | null>(null);
  const numberField = (
    label: string,
    value: number,
    update: (n: number) => void,
    min: number,
    max: number,
  ) => (
    <label className={styles.field}>
      {label}
      <input
        className={styles.input}
        type="number"
        required
        value={Number.isNaN(value) ? '' : value}
        min={min}
        max={max}
        step={1}
        disabled={saving || disabled}
        onChange={(e) => update(e.target.valueAsNumber)}
      />
    </label>
  );
  return (
    <form
      className={styles.editor}
      aria-label={`Customize ${presetDisplayName(rule.presetKey, rule.name)}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (saving || disabled) return;
        const parsed = AutopilotRuleConfigurationSchema.safeParse({
          version,
          name,
          conditions,
          actionKind,
          reach,
        });
        if (!parsed.success) {
          setError('Check the conditions and rule name, then save again.');
          return;
        }
        setError(null);
        setError(await onSave(parsed.data));
      }}
    >
      <label className={styles.field} htmlFor={`${id}-name`}>
        Rule name
        <input
          id={`${id}-name`}
          className={styles.input}
          value={name}
          required
          maxLength={80}
          disabled={saving || disabled}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </label>
      <fieldset className={styles.fieldset} disabled={saving || disabled}>
        <legend>Conditions</legend>
        {conditions.kind === 'recommendation' && (
          <>
            <p className={styles.muted}>
              Recommendation:{' '}
              {conditions.verdict === 'archive'
                ? 'Archive'
                : conditions.verdict === 'later'
                  ? 'Later'
                  : 'Unsubscribe'}
            </p>
            {numberField(
              'Confidence above (%)',
              conditions.confidence * 100,
              (n) => setConditions({ ...conditions, confidence: n / 100 }),
              0,
              100,
            )}
          </>
        )}
        {conditions.kind === 'new_sender' && (
          <>
            {numberField(
              'First seen fewer than (days)',
              conditions.firstSeenWithinDays,
              (n) => setConditions({ ...conditions, firstSeenWithinDays: n }),
              1,
              365,
            )}
            <p className={styles.muted}>Or</p>
            {numberField(
              'Fewer than (emails)',
              conditions.fewerThanMessages,
              (n) => setConditions({ ...conditions, fewerThanMessages: n }),
              1,
              1000,
            )}
          </>
        )}
        {conditions.kind === 'dormant' && (
          <div className={styles.conditionGrid}>
            {numberField(
              'Last email more than (days ago)',
              conditions.lastSeenAfterDays,
              (n) => setConditions({ ...conditions, lastSeenAfterDays: n }),
              0,
              3650,
            )}
            <label className={styles.field}>
              Last email at most (days ago)
              <input
                className={styles.input}
                type="number"
                min={1}
                max={3650}
                step={1}
                value={
                  conditions.lastSeenWithinDays === null ||
                  Number.isNaN(conditions.lastSeenWithinDays)
                    ? ''
                    : conditions.lastSeenWithinDays
                }
                placeholder="No upper limit"
                onChange={(e) =>
                  setConditions({
                    ...conditions,
                    lastSeenWithinDays: e.target.value === '' ? null : e.target.valueAsNumber,
                  })
                }
              />
            </label>
            {numberField(
              'Lifetime read rate below (%)',
              conditions.readRateBelow * 100,
              (n) => setConditions({ ...conditions, readRateBelow: n / 100 }),
              1,
              100,
            )}
            {numberField(
              'At least (emails)',
              conditions.minMessages,
              (n) => setConditions({ ...conditions, minMessages: n }),
              5,
              10000,
            )}
          </div>
        )}
        <p className={styles.muted}>
          {conditions.kind === 'new_sender'
            ? 'Either condition can match.'
            : 'All conditions must match.'}
        </p>
      </fieldset>
      <label className={styles.field} htmlFor={`${id}-action`}>
        Action
        <CleanupSelect
          id={`${id}-action`}
          className={styles.input}
          value={actionKind}
          disabled={saving || disabled}
          onChange={(e) => {
            setAction(e.target.value as typeof actionKind);
            setReach('inbox_only');
          }}
        >
          <option value="archive">Archive</option>
          <option value="delete">Delete</option>
          <option value="later">Later</option>
          <option value="unsubscribe">Unsubscribe</option>
        </CleanupSelect>
      </label>
      {actionKind !== 'unsubscribe' && (
        <label className={styles.field} htmlFor={`${id}-reach`}>
          Include
          <CleanupSelect
            id={`${id}-reach`}
            className={styles.input}
            value={reach}
            disabled={saving || disabled || actionKind !== 'delete'}
            onChange={(e) => setReach(e.target.value as typeof reach)}
          >
            <option value="inbox_only">Inbox only</option>
            {actionKind === 'delete' && <option value="all_mail">Inbox + archived</option>}
          </CleanupSelect>
        </label>
      )}
      <p className={styles.muted}>
        {actionKind === 'delete'
          ? 'Moves matching email to Trash after you approve a preview. Future email is unchanged. Undo is available in Activity.'
          : actionKind === 'unsubscribe'
            ? 'Requests Unsubscribe from matching senders. Unsubscribe cannot be undone.'
            : actionKind === 'later'
              ? 'Moves matching Inbox emails to Later for 7 days. Undo is available in Activity.'
              : 'Archives matching Inbox emails. Undo is available in Activity.'}
      </p>
      <p className={styles.muted}>
        {rule.mode === 'paused' || !rule.enabled
          ? 'Saving keeps this rule stopped. Preview before starting it.'
          : 'Saving returns this rule to Watch first. Preview and approve matches before mail changes.'}
      </p>
      {disabled && (
        <p role="status">
          Rule settings are unavailable. Retry loading Autopilot to continue editing.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {version === undefined && (
        <p role="alert">Rule editing is unavailable. Reload the page and try again.</p>
      )}
      <div className={styles.actions}>
        <Button type="submit" disabled={saving || disabled || version === undefined}>
          {saving ? 'Saving…' : 'Save rule'}
        </Button>
        <Button type="button" tone="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
