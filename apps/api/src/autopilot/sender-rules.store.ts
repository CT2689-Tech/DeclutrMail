import { randomUUID } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';

export const SENDER_RULE_PREVIEW_STORE = 'SENDER_RULE_PREVIEW_STORE';
export const SENDER_RULE_PREVIEW_TTL_MS = 5 * 60 * 1000;
export const SENDER_RULE_MAX_MESSAGES = 5000;
export const SENDER_RULE_MAX_SENDERS = 100;
export const SENDER_RULE_PREVIEWS_PER_MAILBOX = 16;

/** IDs only. Sender identities and message contents never enter Redis. */
export interface FrozenSenderRulePreview {
  previewId: string;
  mailboxId: string;
  ruleId: string;
  ruleVersion: number;
  action: 'archive' | 'delete';
  reach: 'inbox_only' | 'all_mail';
  olderThanDays: number | null;
  expiresAt: string;
  targets: Array<{ senderId: string; senderKey: string; messageIds: string[] }>;
}

export interface SenderRulePreviewStore {
  create(
    input: Omit<FrozenSenderRulePreview, 'previewId' | 'expiresAt'>,
  ): Promise<FrozenSenderRulePreview>;
  read(
    mailboxId: string,
    ruleId: string,
    previewId: string,
  ): Promise<FrozenSenderRulePreview | null>;
}

function key(mailboxId: string, ruleId: string, previewId: string): string {
  return `declutr:autopilot-sender-preview:${mailboxId}:${ruleId}:${previewId}`;
}

function snapshot(
  input: Omit<FrozenSenderRulePreview, 'previewId' | 'expiresAt'>,
): FrozenSenderRulePreview {
  if (
    input.targets.length > SENDER_RULE_MAX_SENDERS ||
    input.targets.reduce((n, t) => n + t.messageIds.length, 0) > SENDER_RULE_MAX_MESSAGES
  ) {
    throw new ServiceUnavailableException('Preview exceeds its execution limit.');
  }
  const value = {
    ...structuredClone(input),
    previewId: randomUUID(),
    expiresAt: new Date(Date.now() + SENDER_RULE_PREVIEW_TTL_MS).toISOString(),
  };
  if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024)
    throw new ServiceUnavailableException('Preview exceeds cache capacity.');
  return value;
}

/** Development fallback; bounded in both entries and bytes. */
export class MemorySenderRulePreviewStore implements SenderRulePreviewStore {
  private readonly entries = new Map<
    string,
    { value: FrozenSenderRulePreview; bytes: number; timer: ReturnType<typeof setTimeout> }
  >();
  private bytes = 0;

  async create(
    input: Omit<FrozenSenderRulePreview, 'previewId' | 'expiresAt'>,
  ): Promise<FrozenSenderRulePreview> {
    const value = snapshot(input);
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > 2 * 1024 * 1024)
      throw new ServiceUnavailableException('Preview exceeds local cache capacity.');
    while (this.entries.size >= 64 || this.bytes + bytes > 16 * 1024 * 1024)
      this.remove(this.entries.keys().next().value!);
    const mailboxEntries = [...this.entries].filter(
      ([, entry]) => entry.value.mailboxId === input.mailboxId,
    );
    while (mailboxEntries.length >= SENDER_RULE_PREVIEWS_PER_MAILBOX)
      this.remove(mailboxEntries.shift()![0]);
    const id = key(value.mailboxId, value.ruleId, value.previewId);
    const timer = setTimeout(() => this.remove(id), SENDER_RULE_PREVIEW_TTL_MS);
    timer.unref?.();
    this.entries.set(id, { value, bytes, timer });
    this.bytes += bytes;
    return structuredClone(value);
  }

  async read(
    mailboxId: string,
    ruleId: string,
    previewId: string,
  ): Promise<FrozenSenderRulePreview | null> {
    const id = key(mailboxId, ruleId, previewId);
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (Date.parse(entry.value.expiresAt) <= Date.now()) {
      this.remove(id);
      return null;
    }
    return structuredClone(entry.value);
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.bytes -= entry.bytes;
    this.entries.delete(id);
  }
}

/** Shared across API instances; SET PX is atomic with its expiration. */
export class RedisSenderRulePreviewStore implements SenderRulePreviewStore {
  constructor(private readonly redis: Redis) {}
  async create(
    input: Omit<FrozenSenderRulePreview, 'previewId' | 'expiresAt'>,
  ): Promise<FrozenSenderRulePreview> {
    const value = snapshot(input);
    try {
      await this.redis.eval(
        `
        redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
        redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
        redis.call('ZADD', KEYS[1], ARGV[4], KEYS[2])
        local excess = redis.call('ZCARD', KEYS[1]) - tonumber(ARGV[5])
        if excess > 0 then
          local old = redis.call('ZRANGE', KEYS[1], 0, excess - 1)
          for _, id in ipairs(old) do redis.call('DEL', id); redis.call('ZREM', KEYS[1], id) end
        end
        redis.call('PEXPIRE', KEYS[1], ARGV[3])
        return 1
      `,
        2,
        `declutr:autopilot-sender-preview-index:${value.mailboxId}`,
        key(value.mailboxId, value.ruleId, value.previewId),
        String(Date.now()),
        JSON.stringify(value),
        String(SENDER_RULE_PREVIEW_TTL_MS),
        String(Date.parse(value.expiresAt)),
        String(SENDER_RULE_PREVIEWS_PER_MAILBOX),
      );
    } catch {
      throw new ServiceUnavailableException('Could not save the preview. Please retry.');
    }
    return value;
  }
  async read(
    mailboxId: string,
    ruleId: string,
    previewId: string,
  ): Promise<FrozenSenderRulePreview | null> {
    let raw: string | null;
    try {
      raw = await this.redis.get(key(mailboxId, ruleId, previewId));
    } catch {
      throw new ServiceUnavailableException('Could not load the preview. Please retry.');
    }
    if (!raw) return null;
    const value = JSON.parse(raw) as FrozenSenderRulePreview;
    if (
      value.mailboxId !== mailboxId ||
      value.ruleId !== ruleId ||
      value.previewId !== previewId ||
      Date.parse(value.expiresAt) <= Date.now()
    )
      return null;
    return value;
  }
  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
