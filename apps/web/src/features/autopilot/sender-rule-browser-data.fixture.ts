/** Synthetic browser/Storybook data. Never imported by the application route. */
import type {
  RuleSender,
  SenderRule,
  SenderRuleConfig,
  SenderRuleExecution,
  SenderRulePreview,
} from '@/lib/api/autopilot-sender-rules';
const sender = (
  id: string,
  key: string,
  name: string,
  email: string,
  protectedSender = false,
): RuleSender => ({ id, senderKey: key.repeat(64), name, email, protected: protectedSender });
export const FIXTURE_SENDERS = [
  sender('studio', 'a', 'Studio Weekly', 'weekly@studio.example.invalid'),
  sender('market', 'b', 'Market Notes', 'digest@market.example.invalid'),
  sender('field', 'c', 'Field Journal', 'letters@field.example.invalid'),
  sender('family', 'd', 'Family Book Club', 'family@example.invalid', true),
];
export const FIXTURE_RULES: SenderRule[] = [
  'Newsletter cleanup',
  'Older promotions',
  'Past delivery updates',
  'Store promotions',
  'Job alerts',
  'Community updates',
  'Product announcements',
  'Travel offers',
].map((name, i) => ({
  id: `rule-${i}`,
  name,
  version: 1,
  enabled: true,
  mode: i === 4 ? 'paused' : 'observe',
  action: i % 3 === 0 ? 'delete' : 'archive',
  reach: 'inbox_only',
  olderThanDays: i === 0 ? null : 90,
  senderKeys: FIXTURE_SENDERS.map((s) => s.senderKey),
  senders: FIXTURE_SENDERS,
  matchingMessageCount: i === 0 ? 12 : i % 3 === 0 ? 0 : i + 2,
  matchingSenderCount: 3,
  protectedSenderCount: 1,
  checkedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}));
const scenario = () =>
  typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('scenario');
let rules = structuredClone(FIXTURE_RULES);
let counter = 0;
let started = 0;
const delay = async (signal?: AbortSignal) => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
};
export async function fetchSenderRules(signal: AbortSignal) {
  await delay(signal);
  if (scenario() === 'error') throw new Error('Synthetic read unavailable');
  return scenario() === 'empty' ? [] : rules;
}
export async function fetchRuleSenders(
  query: string,
  _cursor: string | undefined,
  signal: AbortSignal,
) {
  await delay(signal);
  return {
    senders: FIXTURE_SENDERS.filter((s) =>
      `${s.name} ${s.email}`.toLowerCase().includes(query.toLowerCase()),
    ),
    nextCursor: null,
  };
}
export async function saveSenderRule(
  config: SenderRuleConfig,
  _mailboxId?: string,
  rule?: SenderRule,
) {
  await delay();
  const saved: SenderRule = {
    ...FIXTURE_RULES[0]!,
    ...config,
    id: rule?.id ?? `created-${++counter}`,
    version: rule ? rule.version + 1 : 1,
    senders: FIXTURE_SENDERS.filter((s) => config.senderKeys.includes(s.senderKey)),
  };
  rules = [saved, ...rules.filter((r) => r.id !== saved.id)];
  return saved;
}
export async function retireSenderRule(rule: SenderRule) {
  await delay();
  rules = rules.filter((r) => r.id !== rule.id);
  return { ...rule, enabled: false, mode: 'paused' as const };
}
export async function setSenderRuleMode(rule: SenderRule, mode: 'observe' | 'paused') {
  await delay();
  const updated = { ...rule, mode, version: rule.version + 1 };
  rules = rules.map((r) => (r.id === rule.id ? updated : r));
  return updated;
}
export async function previewSenderRule(
  rule: SenderRule,
  excludedSenderKeys: string[],
  signal: AbortSignal,
): Promise<SenderRulePreview> {
  await delay(signal);
  const senders = rule.senders
    .map((s, i) => ({ ...s, messageCount: s.protected ? 0 : ([7, 3, 2][i] ?? 0) }))
    .filter((s) => !excludedSenderKeys.includes(s.senderKey));
  const messageCount = senders.reduce((n, s) => n + s.messageCount, 0);
  return {
    previewId: `fixture-preview-${++counter}`,
    ruleId: rule.id,
    version: rule.version,
    expiresAt: new Date(Date.now() + (scenario() === 'expired' ? -1000 : 300000)).toISOString(),
    checkedAt: new Date().toISOString(),
    action: rule.action,
    reach: rule.reach,
    olderThanDays: rule.olderThanDays,
    messageCount: scenario() === 'no-matches' ? 0 : messageCount,
    totalEligibleCount: messageCount,
    hasMore: false,
    senders,
    protectedSenderCount: rule.senders.filter((sender) => sender.protected).length,
    excludedSenderKeys,
  };
}
export async function executeSenderRule(
  _rule: SenderRule,
  previewId: string,
): Promise<SenderRuleExecution> {
  await delay();
  started = Date.now();
  return {
    previewId,
    batchId: 'fixture-batch',
    actionIds: ['fixture-action'],
    requestedCount: 12,
    enqueueFailedCount: 0,
  };
}
export function fixtureBatchStatus(batchId: string | null) {
  const status =
    scenario() === 'failed' ? 'failed' : Date.now() - started > 1500 ? 'done' : 'executing';
  return batchId
    ? {
        status,
        affectedCount: status === 'done' ? 12 : 0,
        done: status === 'done' ? 3 : 0,
        total: 3,
      }
    : undefined;
}
