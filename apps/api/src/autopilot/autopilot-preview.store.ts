import { randomUUID } from 'node:crypto';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AUTOPILOT_PREVIEW_PAGE_SIZE } from '@declutrmail/shared/contracts';
import type { Redis } from 'ioredis';

export const AUTOPILOT_PREVIEW_STORE = 'AUTOPILOT_PREVIEW_STORE';
export const AUTOPILOT_PREVIEW_TTL_MS = 5 * 60 * 1000;

/** Only pseudonymous sender keys and match facts are cached; identities stay in the DB. */
export type PreviewTarget = { senderKey: string; reason: string; inboxCount: number };
export type StoredPreviewPage = {
  previewId: string;
  expiresAt: string;
  page: number;
  pageSize: 25;
  total: number;
  targets: PreviewTarget[];
};

export interface AutopilotPreviewStore {
  create(mailboxId: string, ruleId: string, targets: PreviewTarget[]): Promise<StoredPreviewPage>;
  read(
    mailboxId: string,
    ruleId: string,
    previewId: string,
    page: number,
  ): Promise<StoredPreviewPage | null>;
}

function previewKey(mailboxId: string, ruleId: string, previewId: string): string {
  return `declutr:autopilot-preview:${mailboxId}:${ruleId}:${previewId}`;
}

function assertPage(page: number, total: number): void {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > Math.max(1, Math.ceil(total / AUTOPILOT_PREVIEW_PAGE_SIZE))
  ) {
    throw new BadRequestException('Page is outside this preview.');
  }
}

/** Bounded, expiring local-dev store. Production uses the shared Redis store. */
export class MemoryAutopilotPreviewStore implements AutopilotPreviewStore {
  private readonly snapshots = new Map<
    string,
    {
      previewId: string;
      expiresAt: number;
      targets: PreviewTarget[];
      bytes: number;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private bytes = 0;

  async create(
    mailboxId: string,
    ruleId: string,
    targets: PreviewTarget[],
  ): Promise<StoredPreviewPage> {
    const bytes = Buffer.byteLength(JSON.stringify(targets));
    const maxBytes = 16 * 1024 * 1024;
    if (bytes > maxBytes)
      throw new ServiceUnavailableException('Preview exceeds local cache capacity.');
    while (this.snapshots.size >= 64 || this.bytes + bytes > maxBytes) {
      this.remove(this.snapshots.keys().next().value!);
    }
    const previewId = randomUUID();
    const key = previewKey(mailboxId, ruleId, previewId);
    const expiresAt = Date.now() + AUTOPILOT_PREVIEW_TTL_MS;
    const timer = setTimeout(() => this.remove(key), AUTOPILOT_PREVIEW_TTL_MS);
    timer.unref?.();
    this.snapshots.set(key, { previewId, expiresAt, targets, bytes, timer });
    this.bytes += bytes;
    return (await this.read(mailboxId, ruleId, previewId, 1))!;
  }

  async read(
    mailboxId: string,
    ruleId: string,
    previewId: string,
    page: number,
  ): Promise<StoredPreviewPage | null> {
    const key = previewKey(mailboxId, ruleId, previewId);
    const snapshot = this.snapshots.get(key);
    if (!snapshot) return null;
    if (snapshot.expiresAt <= Date.now()) {
      this.remove(key);
      return null;
    }
    assertPage(page, snapshot.targets.length);
    return {
      previewId,
      expiresAt: new Date(snapshot.expiresAt).toISOString(),
      page,
      pageSize: AUTOPILOT_PREVIEW_PAGE_SIZE,
      total: snapshot.targets.length,
      targets: snapshot.targets.slice(
        (page - 1) * AUTOPILOT_PREVIEW_PAGE_SIZE,
        page * AUTOPILOT_PREVIEW_PAGE_SIZE,
      ),
    };
  }

  private remove(key: string): void {
    const snapshot = this.snapshots.get(key);
    if (!snapshot) return;
    clearTimeout(snapshot.timer);
    this.bytes -= snapshot.bytes;
    this.snapshots.delete(key);
  }
}

/** One expiring hash per preview. Each read transfers only its 25-row page. */
export class RedisAutopilotPreviewStore implements AutopilotPreviewStore {
  constructor(private readonly redis: Redis) {}

  async create(
    mailboxId: string,
    ruleId: string,
    targets: PreviewTarget[],
  ): Promise<StoredPreviewPage> {
    const previewId = randomUUID();
    const expiresAt = new Date(Date.now() + AUTOPILOT_PREVIEW_TTL_MS).toISOString();
    const manifest: Omit<StoredPreviewPage, 'targets' | 'page'> = {
      previewId,
      expiresAt,
      pageSize: AUTOPILOT_PREVIEW_PAGE_SIZE,
      total: targets.length,
    };
    const fields: Record<string, string> = { manifest: JSON.stringify(manifest) };
    for (
      let start = 0, page = 1;
      start < targets.length || page === 1;
      start += AUTOPILOT_PREVIEW_PAGE_SIZE, page++
    ) {
      fields[String(page)] = JSON.stringify(
        targets.slice(start, start + AUTOPILOT_PREVIEW_PAGE_SIZE),
      );
    }
    try {
      // MULTI makes storing the hash and its expiry atomic, including on disconnect.
      const result = await this.redis
        .multi()
        .hset(previewKey(mailboxId, ruleId, previewId), fields)
        .pexpireat(previewKey(mailboxId, ruleId, previewId), Date.parse(expiresAt))
        .exec();
      if (!result || result.some(([error]) => error != null))
        throw new Error('Preview cache write failed');
    } catch {
      throw new ServiceUnavailableException('Could not save the sender preview. Please retry.');
    }
    return { ...manifest, page: 1, targets: targets.slice(0, AUTOPILOT_PREVIEW_PAGE_SIZE) };
  }

  async read(
    mailboxId: string,
    ruleId: string,
    previewId: string,
    page: number,
  ): Promise<StoredPreviewPage | null> {
    let values: Array<string | null>;
    try {
      values = await this.redis.hmget(
        previewKey(mailboxId, ruleId, previewId),
        'manifest',
        String(page),
      );
    } catch {
      throw new ServiceUnavailableException('Could not load the sender preview. Please retry.');
    }
    if (!values[0]) return null;
    const manifest = JSON.parse(values[0]) as Omit<StoredPreviewPage, 'targets' | 'page'>;
    if (Date.parse(manifest.expiresAt) <= Date.now()) return null;
    assertPage(page, manifest.total);
    if (!values[1]) return null;
    return { ...manifest, page, targets: JSON.parse(values[1]) as PreviewTarget[] };
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
