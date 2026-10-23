import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  automationRules,
  mailMessages,
  mailboxAccounts,
  senderActionWhere,
  senderPolicies,
  senders,
  type AutomationRule,
} from '@declutrmail/db';
import {
  decodeCursor,
  encodeCursor,
  type AutopilotSenderRule,
  type AutopilotSenderRulePreview,
  type AutopilotSenderRuleExecuteResult,
  type AutopilotSenderSearchResult,
} from '@declutrmail/shared/contracts';
import { ActionsService } from '../actions/actions.service.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import {
  MemorySenderRulePreviewStore,
  SENDER_RULE_MAX_MESSAGES,
  SENDER_RULE_PREVIEW_STORE,
  type SenderRulePreviewStore,
} from './sender-rules.store.js';

type Definition = {
  name: string;
  senderKeys: string[];
  action: 'archive' | 'delete';
  reach: 'inbox_only' | 'all_mail';
  olderThanDays: 30 | 90 | 180 | null;
  enabled?: boolean;
  mode?: 'observe' | 'paused' | undefined;
};
type RulePatch = Partial<Definition> & { version: number };
type PreviewRequest = {
  version: number;
  action?: 'archive' | 'delete' | undefined;
  reach?: 'inbox_only' | 'all_mail' | undefined;
  olderThanDays?: 30 | 90 | 180 | null | undefined;
  excludedSenderKeys?: string[] | undefined;
};
type CountScope = Pick<Definition, 'reach' | 'olderThanDays'>;
type SenderMetadata = {
  id: string;
  senderKey: string;
  name: string;
  email: string;
  protected: boolean;
  inbox0: number;
  inbox30: number;
  inbox90: number;
  inbox180: number;
  all0: number;
  all30: number;
  all90: number;
  all180: number;
};
type SenderRule = AutomationRule & {
  conditions: { kind: 'sender_list'; senderKeys: string[]; olderThanDays: 30 | 90 | 180 | null };
  actionKind: 'archive' | 'delete';
  actionPayload: { reach: 'inbox_only' | 'all_mail' };
};

@Injectable()
export class SenderRulesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly actions: ActionsService,
    @Inject(SENDER_RULE_PREVIEW_STORE)
    private readonly previews: SenderRulePreviewStore = new MemorySenderRulePreviewStore(),
  ) {}

  async list(mailboxId: string): Promise<AutopilotSenderRule[]> {
    const rows = (
      await this.db
        .select()
        .from(automationRules)
        .where(
          and(
            eq(automationRules.mailboxAccountId, mailboxId),
            eq(automationRules.isPreset, false),
            isNull(automationRules.retiredAt),
          ),
        )
        .orderBy(asc(automationRules.createdAt), asc(automationRules.id))
        .limit(50)
    ).filter(isSenderRule);
    const checkedAt = new Date().toISOString();
    const metadata = await this.metadata(
      mailboxId,
      [...new Set(rows.flatMap((r) => r.conditions.senderKeys))],
      checkedAt,
      rows.map((row) => ({
        reach: row.actionPayload.reach,
        olderThanDays: row.conditions.olderThanDays,
      })),
    );
    const metadataByKey = new Map(metadata.map((sender) => [sender.senderKey, sender]));
    return rows.map((row) => this.dto(row, metadataByKey, checkedAt));
  }

  async create(
    mailboxId: string,
    input: Definition,
    idempotencyKey: string = randomUUID(),
  ): Promise<AutopilotSenderRule> {
    assertReach(input.action, input.reach);
    await this.assertOwnedSenders(mailboxId, input.senderKeys);
    const row = await this.db.transaction(async (tx) => {
      const [mailbox] = await tx
        .select({ id: mailboxAccounts.id })
        .from(mailboxAccounts)
        .where(eq(mailboxAccounts.id, mailboxId))
        .for('update')
        .limit(1);
      if (!mailbox) throw new NotFoundException('Mailbox not found.');
      const id = createRuleId(mailboxId, idempotencyKey);
      const [existing] = await tx
        .select()
        .from(automationRules)
        .where(eq(automationRules.id, id))
        .limit(1);
      if (existing) {
        if (
          existing.mailboxAccountId !== mailboxId ||
          !isSenderRule(existing) ||
          existing.retiredAt
        )
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'This Save request was already used. Refresh the saved rules.',
          });
        // Lost Save responses return the authoritative saved rule, including
        // when the user edited the draft while the original request landed.
        return existing;
      }
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(automationRules)
        .where(
          and(
            eq(automationRules.mailboxAccountId, mailboxId),
            eq(automationRules.isPreset, false),
            isNull(automationRules.retiredAt),
          ),
        );
      if (Number(count?.n ?? 0) >= 50)
        throw new ConflictException({
          code: 'AUTOPILOT_RULE_LIMIT',
          message: 'You can save up to 50 sender rules per Gmail account.',
        });
      const [created] = await tx
        .insert(automationRules)
        .values({
          id,
          mailboxAccountId: mailboxId,
          isPreset: false,
          presetKey: null,
          name: input.name,
          enabled: input.enabled ?? true,
          mode: input.mode ?? 'observe',
          scope: 'account',
          conditions: {
            kind: 'sender_list',
            senderKeys: [...new Set(input.senderKeys)],
            olderThanDays: input.olderThanDays,
          },
          actionKind: input.action,
          actionPayload: { reach: input.reach },
        })
        .returning();
      return created!;
    });
    return this.readDto(mailboxId, row.id);
  }

  async patch(mailboxId: string, ruleId: string, input: RulePatch): Promise<AutopilotSenderRule> {
    const current = await this.rule(mailboxId, ruleId);
    this.assertVersion(current, input.version);
    const senderKeys = input.senderKeys ?? current.conditions.senderKeys;
    await this.assertOwnedSenders(mailboxId, senderKeys);
    const action = input.action ?? current.actionKind;
    const reach = input.reach ?? current.actionPayload.reach;
    assertReach(action, reach);
    const [updated] = await this.db
      .update(automationRules)
      .set({
        name: input.name ?? current.name,
        enabled: input.enabled ?? current.enabled,
        mode: input.mode ?? current.mode,
        ...(input.mode !== undefined && input.mode !== current.mode
          ? { modeChangedAt: sql`now()` }
          : {}),
        actionKind: action,
        actionPayload: { reach },
        conditions: {
          kind: 'sender_list',
          senderKeys: [...new Set(senderKeys)],
          olderThanDays:
            input.olderThanDays === undefined
              ? current.conditions.olderThanDays
              : input.olderThanDays,
        },
        version: sql`${automationRules.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(automationRules.id, ruleId),
          eq(automationRules.mailboxAccountId, mailboxId),
          eq(automationRules.version, input.version),
          eq(automationRules.isPreset, false),
          isNull(automationRules.retiredAt),
        ),
      )
      .returning();
    if (!updated) throw changed();
    return this.readDto(mailboxId, updated.id);
  }

  async retire(
    mailboxId: string,
    ruleId: string,
    version: number,
  ): Promise<{ id: string; version: number; retired: true }> {
    const current = await this.rule(mailboxId, ruleId);
    this.assertVersion(current, version);
    const [retired] = await this.db
      .update(automationRules)
      .set({
        enabled: false,
        mode: 'paused',
        retiredAt: sql`now()`,
        version: sql`${automationRules.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(automationRules.id, ruleId),
          eq(automationRules.mailboxAccountId, mailboxId),
          eq(automationRules.version, version),
          isNull(automationRules.retiredAt),
        ),
      )
      .returning({ id: automationRules.id, version: automationRules.version });
    if (!retired) throw changed();
    return { ...retired, retired: true };
  }

  async search(
    mailboxId: string,
    query: string,
    rawCursor?: string,
  ): Promise<AutopilotSenderSearchResult> {
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && (!cursor || !/^[0-9a-f]{64}$/.test(cursor.key) || cursor.id !== cursor.key))
      throw new BadRequestException('Invalid sender search cursor.');
    const escaped = query.replace(/[\\%_]/g, '\\$&');
    const rows = await this.db
      .select({
        id: senders.id,
        senderKey: senders.senderKey,
        name: senders.displayName,
        email: senders.email,
        protected: sql<boolean>`coalesce(${senderPolicies.isProtected}, false)`,
      })
      .from(senders)
      .leftJoin(
        senderPolicies,
        and(
          eq(senderPolicies.mailboxAccountId, senders.mailboxAccountId),
          eq(senderPolicies.senderKey, senders.senderKey),
        ),
      )
      .where(
        and(
          eq(senders.mailboxAccountId, mailboxId),
          query
            ? or(ilike(senders.displayName, `%${escaped}%`), ilike(senders.email, `%${escaped}%`))
            : undefined,
          cursor ? gt(senders.senderKey, cursor.key) : undefined,
        ),
      )
      .orderBy(asc(senders.senderKey))
      .limit(26);
    const page = rows.slice(0, 25);
    const last = page.at(-1);
    return {
      senders: page,
      nextCursor:
        rows.length > 25 && last ? encodeCursor({ key: last.senderKey, id: last.senderKey }) : null,
    };
  }

  async preview(
    mailboxId: string,
    ruleId: string,
    input: PreviewRequest,
  ): Promise<AutopilotSenderRulePreview> {
    const rule = await this.rule(mailboxId, ruleId);
    this.assertVersion(rule, input.version);
    const action = input.action ?? rule.actionKind;
    const reach = input.reach ?? rule.actionPayload.reach;
    const olderThanDays =
      input.olderThanDays === undefined ? rule.conditions.olderThanDays : input.olderThanDays;
    assertReach(action, reach);
    const excluded = [...new Set(input.excludedSenderKeys ?? [])];
    if (excluded.some((k) => !rule.conditions.senderKeys.includes(k)))
      throw new BadRequestException('Excluded senders must belong to this rule.');
    const checkedAt = new Date().toISOString();
    const metadata = await this.metadata(mailboxId, rule.conditions.senderKeys, checkedAt, [
      { reach, olderThanDays },
    ]);
    const candidates = metadata.filter((s) => !s.protected && !excluded.includes(s.senderKey));
    const keys = candidates.map((s) => s.senderKey);
    const messages = keys.length
      ? await this.db
          .select({
            senderKey: mailMessages.senderKey,
            id: mailMessages.providerMessageId,
            total: sql<number>`count(*) over()::int`,
          })
          .from(mailMessages)
          .where(
            and(
              senderActionWhere({
                mailboxAccountId: mailboxId,
                senderKeys: keys,
                reach,
                olderThanDays,
              }),
              sql`not (${mailMessages.labelIds} && ARRAY['TRASH', 'SPAM', 'DRAFT', 'CHAT']::text[])`,
            ),
          )
          .orderBy(
            asc(mailMessages.senderKey),
            asc(mailMessages.internalDate),
            asc(mailMessages.providerMessageId),
          )
          .limit(SENDER_RULE_MAX_MESSAGES + 1)
      : [];
    const frozen = messages.slice(0, SENDER_RULE_MAX_MESSAGES);
    const targets = candidates.flatMap((s) => {
      const messageIds = frozen.filter((m) => m.senderKey === s.senderKey).map((m) => m.id);
      return messageIds.length ? [{ senderId: s.id, senderKey: s.senderKey, messageIds }] : [];
    });
    const saved = await this.previews.create({
      mailboxId,
      ruleId,
      ruleVersion: rule.version,
      action,
      reach,
      olderThanDays,
      targets,
    });
    return {
      previewId: saved.previewId,
      ruleId,
      version: rule.version,
      expiresAt: saved.expiresAt,
      checkedAt,
      action,
      reach,
      olderThanDays,
      messageCount: frozen.length,
      totalEligibleCount: Number(messages[0]?.total ?? 0),
      hasMore: messages.length > SENDER_RULE_MAX_MESSAGES,
      protectedSenderCount: metadata.filter(
        (s) =>
          s.protected &&
          matchingCount(s, reach, olderThanDays) > 0 &&
          !excluded.includes(s.senderKey),
      ).length,
      senders: targets.map((t) => ({
        ...identity(metadata.find((s) => s.senderKey === t.senderKey)!),
        messageCount: t.messageIds.length,
      })),
      excludedSenderKeys: excluded,
    };
  }

  async execute(
    mailboxId: string,
    ruleId: string,
    previewId: string,
  ): Promise<AutopilotSenderRuleExecuteResult> {
    const replay = await this.actions.replayAutopilotFrozen(mailboxId, ruleId, previewId);
    if (replay) return { previewId, ...replay };
    const rule = await this.rule(mailboxId, ruleId);
    const saved = await this.previews.read(mailboxId, ruleId, previewId);
    if (!saved)
      throw new GoneException({
        code: 'AUTOPILOT_PREVIEW_EXPIRED',
        message: 'This preview expired. Refresh to see current matches.',
      });
    this.assertVersion(rule, saved.ruleVersion);
    if (!rule.enabled || rule.mode !== 'observe')
      throw new ConflictException({
        code: 'AUTOPILOT_RULE_PAUSED',
        message: 'Enable this rule before approving its preview.',
      });
    const result = await this.actions.enqueueAutopilotFrozen({
      mailboxAccountId: mailboxId,
      ruleId,
      ruleVersion: saved.ruleVersion,
      previewId,
      action: saved.action,
      reach: saved.reach,
      olderThanDays: saved.olderThanDays,
      targets: saved.targets,
    });
    return { previewId, ...result };
  }

  private async rule(mailboxId: string, id: string): Promise<SenderRule> {
    const [row] = await this.db
      .select()
      .from(automationRules)
      .where(
        and(
          eq(automationRules.id, id),
          eq(automationRules.mailboxAccountId, mailboxId),
          eq(automationRules.isPreset, false),
          isNull(automationRules.retiredAt),
        ),
      )
      .limit(1);
    if (!row || !isSenderRule(row)) throw new NotFoundException('Rule not found.');
    return row;
  }

  private async readDto(mailboxId: string, id: string): Promise<AutopilotSenderRule> {
    const row = await this.rule(mailboxId, id);
    const checkedAt = new Date().toISOString();
    return this.dto(
      row,
      new Map(
        (
          await this.metadata(mailboxId, row.conditions.senderKeys, checkedAt, [
            { reach: row.actionPayload.reach, olderThanDays: row.conditions.olderThanDays },
          ])
        ).map((sender) => [sender.senderKey, sender]),
      ),
      checkedAt,
    );
  }

  private assertVersion(rule: SenderRule, version: number): void {
    if (rule.version !== version) throw changed();
  }

  private async assertOwnedSenders(mailboxId: string, keys: string[]): Promise<void> {
    if (!keys.length || keys.length > 100)
      throw new BadRequestException('Choose between 1 and 100 known senders.');
    const owned = await this.db
      .select({ senderKey: senders.senderKey })
      .from(senders)
      .where(and(eq(senders.mailboxAccountId, mailboxId), inArray(senders.senderKey, keys)));
    if (owned.length !== new Set(keys).size)
      throw new BadRequestException('Choose senders from the selected Gmail account.');
  }

  private dto(
    row: SenderRule,
    metadata: ReadonlyMap<string, SenderMetadata>,
    checkedAt: string,
  ): AutopilotSenderRule {
    const selected = [...new Set(row.conditions.senderKeys)].flatMap((key) => {
      const sender = metadata.get(key);
      return sender ? [sender] : [];
    });
    const matching = selected.filter(
      (s) =>
        !s.protected && matchingCount(s, row.actionPayload.reach, row.conditions.olderThanDays) > 0,
    );
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      enabled: row.enabled,
      mode: row.mode === 'paused' ? 'paused' : 'observe',
      action: row.actionKind,
      reach: row.actionPayload.reach,
      olderThanDays: row.conditions.olderThanDays,
      senderKeys: row.conditions.senderKeys,
      senders: selected.map(identity),
      matchingMessageCount: matching.reduce(
        (n, s) => n + matchingCount(s, row.actionPayload.reach, row.conditions.olderThanDays),
        0,
      ),
      matchingSenderCount: matching.length,
      protectedSenderCount: selected.filter(
        (s) =>
          s.protected &&
          matchingCount(s, row.actionPayload.reach, row.conditions.olderThanDays) > 0,
      ).length,
      checkedAt,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Aggregate only requested buckets before joining the bounded sender identities. */
  private async metadata(
    mailboxId: string,
    keys: string[],
    checkedAt: string,
    scopes: CountScope[],
  ): Promise<SenderMetadata[]> {
    if (keys.length === 0 || scopes.length === 0) return [];
    const required = new Set(
      scopes.map(
        (scope) => `${scope.reach === 'inbox_only' ? 'inbox' : 'all'}${scope.olderThanDays ?? 0}`,
      ),
    );
    // These predicates are a union of the requested scopes, so they cannot
    // discard a match. Restricting an inbox-only library also lets PostgreSQL
    // use the existing partial inbox index instead of visiting archived mail.
    const inboxOnly = scopes.every((scope) => scope.reach === 'inbox_only');
    const minimumAge = Math.min(...scopes.map((scope) => scope.olderThanDays ?? 0));
    const bucket = (inbox: boolean, days: number) => {
      if (!required.has(`${inbox ? 'inbox' : 'all'}${days}`)) return sql<number>`0::int`;
      const filters = and(
        inbox && !inboxOnly ? sql`'INBOX' = any(${mailMessages.labelIds})` : undefined,
        days > minimumAge
          ? sql`${mailMessages.internalDate} <= ${checkedAt}::timestamptz - (${days} || ' days')::interval`
          : undefined,
      );
      return filters
        ? sql<number>`count(*) filter (where ${filters})::int`
        : sql<number>`count(*)::int`;
    };
    const counts = this.db
      .select({
        senderKey: mailMessages.senderKey,
        inbox0: bucket(true, 0).as('inbox0'),
        inbox30: bucket(true, 30).as('inbox30'),
        inbox90: bucket(true, 90).as('inbox90'),
        inbox180: bucket(true, 180).as('inbox180'),
        all0: bucket(false, 0).as('all0'),
        all30: bucket(false, 30).as('all30'),
        all90: bucket(false, 90).as('all90'),
        all180: bucket(false, 180).as('all180'),
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.mailboxAccountId, mailboxId),
          inArray(mailMessages.senderKey, keys),
          eq(mailMessages.isOutbound, false),
          sql`not (${mailMessages.labelIds} && ARRAY['TRASH', 'SPAM', 'DRAFT', 'CHAT']::text[])`,
          inboxOnly ? sql`'INBOX' = any(${mailMessages.labelIds})` : undefined,
          minimumAge
            ? sql`${mailMessages.internalDate} <= ${checkedAt}::timestamptz - (${minimumAge} || ' days')::interval`
            : undefined,
        ),
      )
      .groupBy(mailMessages.senderKey)
      .as('sender_rule_counts');
    return this.db
      .select({
        id: senders.id,
        senderKey: senders.senderKey,
        name: senders.displayName,
        email: senders.email,
        protected: sql<boolean>`coalesce(${senderPolicies.isProtected}, false)`,
        inbox0: sql<number>`coalesce(${counts.inbox0}, 0)`,
        inbox30: sql<number>`coalesce(${counts.inbox30}, 0)`,
        inbox90: sql<number>`coalesce(${counts.inbox90}, 0)`,
        inbox180: sql<number>`coalesce(${counts.inbox180}, 0)`,
        all0: sql<number>`coalesce(${counts.all0}, 0)`,
        all30: sql<number>`coalesce(${counts.all30}, 0)`,
        all90: sql<number>`coalesce(${counts.all90}, 0)`,
        all180: sql<number>`coalesce(${counts.all180}, 0)`,
      })
      .from(senders)
      .leftJoin(
        senderPolicies,
        and(
          eq(senderPolicies.mailboxAccountId, senders.mailboxAccountId),
          eq(senderPolicies.senderKey, senders.senderKey),
        ),
      )
      .leftJoin(counts, eq(counts.senderKey, senders.senderKey))
      .where(and(eq(senders.mailboxAccountId, mailboxId), inArray(senders.senderKey, keys)));
  }
}

function identity(s: SenderMetadata) {
  return { id: s.id, senderKey: s.senderKey, name: s.name, email: s.email, protected: s.protected };
}

/** Durable mailbox-scoped request identity, RFC9562 vendor UUIDv8. */
function createRuleId(mailboxId: string, idempotencyKey: string): string {
  const bytes = createHash('sha256')
    .update(`declutrmail.sender-rule-create.v1|${mailboxId}|${idempotencyKey}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
function matchingCount(
  s: SenderMetadata,
  reach: 'inbox_only' | 'all_mail',
  days: number | null,
): number {
  return Number(
    s[`${reach === 'inbox_only' ? 'inbox' : 'all'}${days ?? 0}` as keyof SenderMetadata] ?? 0,
  );
}
function changed() {
  return new ConflictException({
    code: 'AUTOPILOT_RULE_CHANGED',
    message: 'This rule changed. Refresh its preview.',
  });
}
function assertReach(action: string, reach: string): void {
  if (action !== 'delete' && reach === 'all_mail')
    throw new BadRequestException('Only Delete may reach past the inbox.');
}
function isSenderRule(row: AutomationRule): row is SenderRule {
  const c = row.conditions as Partial<SenderRule['conditions']> | null;
  const p = row.actionPayload as Partial<SenderRule['actionPayload']> | null;
  return (
    !row.isPreset &&
    row.scope === 'account' &&
    c?.kind === 'sender_list' &&
    Array.isArray(c.senderKeys) &&
    c.senderKeys.length > 0 &&
    c.senderKeys.length <= 100 &&
    c.senderKeys.every((k) => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k)) &&
    [null, 30, 90, 180].includes(c.olderThanDays as number | null) &&
    (row.actionKind === 'archive' || row.actionKind === 'delete') &&
    (p?.reach === 'inbox_only' || (p?.reach === 'all_mail' && row.actionKind === 'delete')) &&
    (row.mode === 'observe' || row.mode === 'paused')
  );
}
