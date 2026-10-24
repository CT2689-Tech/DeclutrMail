import { apiGet, apiPatch, apiPost } from './client';

import type {
  AutopilotRuleSender,
  AutopilotSenderRule,
  AutopilotSenderRuleCreate,
  AutopilotSenderSearchPage,
  AutopilotSenderRulePreview,
  AutopilotSenderRuleExecuteResult,
} from '@declutrmail/shared/contracts';
export type RuleSender = AutopilotRuleSender;
export type SenderRule = AutopilotSenderRule;
export type SenderRuleConfig = AutopilotSenderRuleCreate;
export type SenderRulePreview = AutopilotSenderRulePreview;
export type SenderRuleExecution = AutopilotSenderRuleExecuteResult;
const base = '/api/autopilot/sender-rules';
export const fetchSenderRules = (signal: AbortSignal, mailboxId?: string) =>
  apiGet<SenderRule[]>(base, { signal, mailboxId }).then((e) => e.data);
export const fetchRuleSenders = (
  query: string,
  cursor: string | undefined,
  signal: AbortSignal,
  mailboxId?: string,
) =>
  apiGet<AutopilotSenderSearchPage>('/api/autopilot/senders', {
    query: { q: query, cursor },
    signal,
    mailboxId,
  }).then((e) => e.data);
export const saveSenderRule = (
  config: SenderRuleConfig,
  mailboxId?: string,
  rule?: SenderRule,
  idempotencyKey?: string,
) =>
  (rule
    ? apiPatch<SenderRule>(
        `${base}/${encodeURIComponent(rule.id)}`,
        { ...config, version: rule.version },
        { mailboxId },
      )
    : apiPost<SenderRule>(base, config, {
        mailboxId,
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      })
  ).then((e) => e.data);
export const retireSenderRule = (rule: SenderRule, mailboxId?: string) =>
  apiPost<SenderRule>(
    `${base}/${encodeURIComponent(rule.id)}/retire`,
    { version: rule.version },
    { mailboxId },
  ).then((e) => e.data);
export const previewSenderRule = (
  rule: SenderRule,
  excludedSenderKeys: string[],
  signal: AbortSignal,
  mailboxId?: string,
) =>
  apiPost<SenderRulePreview>(
    `${base}/${encodeURIComponent(rule.id)}/preview`,
    { version: rule.version, excludedSenderKeys },
    { signal, mailboxId },
  ).then((e) => e.data);
export const executeSenderRule = (
  rule: SenderRule,
  previewId: string,
  idempotencyKey: string,
  mailboxId?: string,
) =>
  apiPost<SenderRuleExecution>(
    `${base}/${encodeURIComponent(rule.id)}/execute`,
    { previewId },
    { headers: { 'Idempotency-Key': idempotencyKey }, mailboxId },
  ).then((e) => e.data);

export const setSenderRuleMode = (
  rule: SenderRule,
  mode: 'observe' | 'paused',
  mailboxId?: string,
) =>
  apiPatch<SenderRule>(
    `${base}/${encodeURIComponent(rule.id)}`,
    { version: rule.version, mode },
    { mailboxId },
  ).then((e) => e.data);
