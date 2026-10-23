import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AutopilotSenderRuleCreateSchema,
  AutopilotSenderRulePatchSchema,
  AutopilotSenderRulePreviewRequestSchema,
  AutopilotSenderRuleExecuteRequestSchema,
  AutopilotSenderRuleRetireRequestSchema,
  ok,
} from '@declutrmail/shared/contracts';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { CapabilityGuard, RequiresCapability } from '../common/entitlements/capability.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { SenderRulesService } from './sender-rules.service.js';

/** Custom sender rules are approval-only. Preset routes retain their existing policy. */
@Controller('autopilot')
@UseGuards(JwtGuard, CurrentMailboxGuard, CsrfGuard, CapabilityGuard)
@RequiresCapability('autopilot')
export class SenderRulesController {
  constructor(private readonly rules: SenderRulesService) {}

  @Get('sender-rules')
  @RateLimit('triage-load')
  async list(@CurrentMailbox() mailbox: { id: string }) {
    return ok(await this.rules.list(mailbox.id));
  }

  @Get('senders')
  @RateLimit('triage-load')
  async search(
    @CurrentMailbox() mailbox: { id: string },
    @Query('q') query?: unknown,
    @Query('cursor') cursor?: unknown,
  ) {
    if (
      (query !== undefined && (typeof query !== 'string' || query.length > 100)) ||
      (cursor !== undefined &&
        (typeof cursor !== 'string' || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)))
    )
      throw new BadRequestException('Invalid sender search.');
    return ok(
      await this.rules.search(
        mailbox.id,
        typeof query === 'string' ? query.trim() : '',
        typeof cursor === 'string' ? cursor : undefined,
      ),
    );
  }

  @Post('sender-rules')
  @RateLimit('triage-load')
  async create(
    @CurrentMailbox() mailbox: { id: string },
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    assertIdempotencyKey(idempotencyKey);
    const parsed = AutopilotSenderRuleCreateSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Choose a name, known senders, action, reach, and email age.');
    return ok(await this.rules.create(mailbox.id, parsed.data, idempotencyKey));
  }

  @Patch('sender-rules/:id')
  @RateLimit('triage-load')
  async patch(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    assertUuid(id);
    const parsed = AutopilotSenderRulePatchSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        'Provide the current rule version and valid sender rule changes.',
      );
    return ok(await this.rules.patch(mailbox.id, id, parsed.data));
  }

  @Post('sender-rules/:id/retire')
  @RateLimit('triage-load')
  async retire(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    assertUuid(id);
    const parsed = AutopilotSenderRuleRetireRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Provide the current rule version.');
    return ok(await this.rules.retire(mailbox.id, id, parsed.data.version));
  }

  @Post('sender-rules/:id/preview')
  @RateLimit('triage-load')
  async preview(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    assertUuid(id);
    const parsed = AutopilotSenderRulePreviewRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Provide the current rule version and valid preview options.');
    return ok(await this.rules.preview(mailbox.id, id, parsed.data));
  }

  @Post('sender-rules/:id/execute')
  @RateLimit('triage-load')
  async execute(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    assertUuid(id);
    assertIdempotencyKey(idempotencyKey);
    const parsed = AutopilotSenderRuleExecuteRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Provide the preview to approve.');
    // Preview identity remains authoritative if a retry generates another header.
    return ok(await this.rules.execute(mailbox.id, id, parsed.data.previewId));
  }
}

function assertUuid(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new BadRequestException('Rule id must be a UUID.');
}

function assertIdempotencyKey(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 200 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw new BadRequestException('An Idempotency-Key header of 8-200 characters is required.');
}
