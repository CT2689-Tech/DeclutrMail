import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { verifySealedAdoptionWitness } from './email-runtime-adoption.js';
import type { EmailRuntimeAdoptionWitness } from './email-runtime-adoption.js';

export const EMAIL_RUNTIME_DELIVERY_FIELD = 'emailRuntimeDeliveryV1';
export const EMAIL_RUNTIME_LEASE_PROTOCOL = 'email-outbox-lease-v1';
export const EMAIL_RUNTIME_REGISTRY_PREFIX = 'declutrmail:email-runtime:v1';
const MAX_ACTORS = 100;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SOURCE = /^[a-f0-9]{40}$/;
export const EMAIL_RUNTIME_WORKER_REVISION = /^declutrmail-worker-[a-z0-9-]{1,80}$/;

export type EmailRuntimeRefusal =
  | 'runtime_adoption_unverified'
  | 'runtime_registry_malformed'
  | 'no_workers'
  | 'incompatible_workers'
  | 'lease_lost'
  | 'runtime_settlement_unverified';
export class EmailRuntimeLeaseError extends Error {
  constructor(
    readonly reason: EmailRuntimeRefusal,
    readonly detail?: string,
  ) {
    super('Email runtime compatibility unverified');
  }
}

export type { EmailRuntimeAdoptionWitness };

interface Actor {
  protocol: string;
  revision: string;
  source: string;
  expiresAt: number;
  billingConsumer: boolean;
  ready: boolean;
}

/** Dedicated admission connection: outages must reject, never replay enrollment. */
export function createEmailRuntimeConnection(url: string): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    autoResendUnfulfilledCommands: false,
    commandTimeout: 5_000,
    connectTimeout: 5_000,
  });
  client.on('error', () => undefined);
  return client;
}

function registryKey(prefix: string): string {
  if (!/^[a-zA-Z0-9:_-]{1,120}$/.test(prefix))
    throw new EmailRuntimeLeaseError('runtime_registry_malformed');
  return `${prefix}:actors`;
}

/** Shared by actual claims and the final atomic delivery boundary. Validating
 * protocol/expiry alone would admit a malformed record the reader refuses. */
export const EMAIL_RUNTIME_ACTOR_VALIDATION_LUA = `
local function validEmailRuntimeActor(id,a,protocol,now)
 if type(a)~='table' or type(a.revision)~='string' or type(a.source)~='string' or type(a.ready)~='boolean' or type(a.billingConsumer)~='boolean' or type(a.expiresAt)~='number' or a.protocol~=protocol then return false end
 if #id~=36 or string.sub(id,9,9)~='-' or string.sub(id,14,14)~='-' or string.sub(id,19,19)~='-' or string.sub(id,24,24)~='-' then return false end
 local hex=string.gsub(id,'%-','');if #hex~=32 or not string.match(hex,'^[a-f0-9]+$') then return false end
 local suffix=string.match(a.revision,'^declutrmail%-worker%-([a-z0-9%-]+)$')
 if not suffix or #suffix>80 or #a.source~=40 or not string.match(a.source,'^[a-f0-9]+$') then return false end
 if a.expiresAt~=math.floor(a.expiresAt) or a.expiresAt<=now or a.expiresAt>now+120000 then return false end
 local fields=0;for _ in pairs(a) do fields=fields+1 end;return fields==6
end
local function validEmailRuntimeActors(key,protocol,now)
 if redis.call('HLEN',key)>100 then return false end
 local rows=redis.call('HGETALL',key)
 for i=1,#rows,2 do
  local ok,a=pcall(cjson.decode,rows[i+1])
  if not ok or not validEmailRuntimeActor(rows[i],a,protocol,now) then return false end
 end
 return true
end`;

// Immutable identity is compared on admission/renewal. Missing or expired leases
// cannot be resurrected by a delayed reconnect command or the same boot ID.
const MUTATE = `${EMAIL_RUNTIME_ACTOR_VALIDATION_LUA}
local t=redis.call('TIME');local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local old=redis.call('HGET',KEYS[1],ARGV[1]);local wasReady=false
if ARGV[2]=='register' then
 if old or redis.call('HLEN',KEYS[1])>=100 then return 0 end
else
 if not old then return 0 end
 local ok,d=pcall(cjson.decode,old)
 if not ok or not validEmailRuntimeActor(ARGV[1],d,ARGV[3],now) or d.revision~=ARGV[4] or d.source~=ARGV[5] or d.billingConsumer~=(ARGV[7]=='1') then return 0 end
 wasReady=(d.ready==true)
 if ARGV[2]=='publish' then wasReady=true end
 if ARGV[2]=='admit' then
  if not validEmailRuntimeActors(KEYS[1],ARGV[3],now) then return 0 end
  return d.expiresAt
 end
end
local expires=now+tonumber(ARGV[6])
redis.call('HSET',KEYS[1],ARGV[1],cjson.encode({protocol=ARGV[3],revision=ARGV[4],source=ARGV[5],expiresAt=expires,billingConsumer=(ARGV[7]=='1'),ready=wasReady}))
return expires`;

const READ = `
local t=redis.call('TIME');local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
if redis.call('HLEN',KEYS[1])>tonumber(ARGV[1]) then return {now,false} end
return {now,redis.call('HGETALL',KEYS[1])}`;

export class EmailRuntimeLease {
  readonly bootId = randomUUID();
  readonly key: string;
  private active = false;
  private revoked = false;
  private registrationAttempted = false;
  private readonly ttl: number;
  readonly billingConsumer: boolean;
  private renewTimer: ReturnType<typeof setInterval> | undefined;
  private renewInFlight: Promise<void> | undefined;

  constructor(
    readonly connection: Redis,
    readonly identity: { source: string; revision: string },
    options: { prefix?: string; ttlMs?: number; billingConsumer?: boolean } = {},
  ) {
    if (!SOURCE.test(identity.source) || !EMAIL_RUNTIME_WORKER_REVISION.test(identity.revision))
      throw new EmailRuntimeLeaseError('runtime_registry_malformed');
    this.key = registryKey(options.prefix ?? EMAIL_RUNTIME_REGISTRY_PREFIX);
    this.ttl = options.ttlMs ?? 60_000;
    this.billingConsumer = options.billingConsumer ?? false;
    if (typeof this.billingConsumer !== 'boolean')
      throw new EmailRuntimeLeaseError('runtime_registry_malformed');
    if (!Number.isInteger(this.ttl) || this.ttl < 1_000 || this.ttl > 120_000)
      throw new EmailRuntimeLeaseError('runtime_registry_malformed');
  }

  get isActive(): boolean {
    return this.active;
  }

  private async mutate(operation: 'register' | 'renew' | 'admit' | 'publish'): Promise<void> {
    if (operation === 'register') {
      if (this.registrationAttempted) throw new EmailRuntimeLeaseError('lease_lost');
      this.registrationAttempted = true;
    }
    if (this.revoked || (operation !== 'register' && !this.active))
      throw new EmailRuntimeLeaseError('lease_lost');
    try {
      const result = await this.connection.eval(
        MUTATE,
        1,
        this.key,
        this.bootId,
        operation,
        EMAIL_RUNTIME_LEASE_PROTOCOL,
        this.identity.revision,
        this.identity.source,
        this.ttl,
        this.billingConsumer ? '1' : '0',
      );
      if (this.revoked || typeof result !== 'number' || result <= 0)
        throw new EmailRuntimeLeaseError('lease_lost');
      this.active = true;
    } catch {
      this.active = false;
      this.revoked = true;
      throw new EmailRuntimeLeaseError('lease_lost');
    }
  }

  /** Composition root calls this after actual consumer connections and LISTEN are ready. */
  register(): Promise<void> {
    return this.mutate('register');
  }
  /** Publish only after actual first poll rounds and initial outbox tick. */
  publish(): Promise<void> {
    return this.mutate('publish');
  }
  renew(): Promise<void> {
    return this.mutate('renew');
  }
  assertAdmission(): Promise<void> {
    return this.mutate('admit');
  }

  startRenewing(onLost: () => Promise<void>): void {
    if (!this.active || this.renewTimer) throw new EmailRuntimeLeaseError('lease_lost');
    this.renewTimer = setInterval(
      () => {
        if (this.renewInFlight) return;
        this.renewInFlight = this.renew()
          .catch(async () => {
            this.stopRenewing();
            await onLost();
          })
          .finally(() => {
            this.renewInFlight = undefined;
          });
        // A failed stop callback must not become an unhandled rejection. Admission
        // is already false; the next actual claim/delivery will still refuse.
        void this.renewInFlight.catch(() => undefined);
      },
      Math.floor(this.ttl / 3),
    );
    this.renewTimer.unref();
  }

  stopRenewing(): void {
    clearInterval(this.renewTimer);
    this.renewTimer = undefined;
  }

  /** A dead poller cannot keep refreshing an advertised consumer capability. */
  async invalidate(): Promise<void> {
    this.revoked = true;
    this.active = false;
    this.stopRenewing();
    const revoked = await this.connection.eval(
      `
local old=redis.call('HGET',KEYS[1],ARGV[1]);if not old then return 1 end
local ok,d=pcall(cjson.decode,old)
if not ok or type(d)~='table' or d.protocol~=ARGV[2] or d.revision~=ARGV[3] or d.source~=ARGV[4] or d.billingConsumer~=(ARGV[5]=='1') then return 0 end
d.expiresAt=0;redis.call('HSET',KEYS[1],ARGV[1],cjson.encode(d));return 1`,
      1,
      this.key,
      this.bootId,
      EMAIL_RUNTIME_LEASE_PROTOCOL,
      this.identity.revision,
      this.identity.source,
      this.billingConsumer ? '1' : '0',
    );
    await this.renewInFlight?.catch(() => undefined);
    this.active = false;
    if (revoked !== 1) throw new EmailRuntimeLeaseError('lease_lost');
  }

  /** Connect the actual polling lifetime, including unexpected normal exit. */
  observePolling(polling: Promise<void>, onStopped: () => Promise<void>): void {
    const stopped = async () => {
      await this.invalidate().catch(() => undefined);
      await onStopped();
    };
    void polling.then(stopped, stopped).catch(() => undefined);
  }

  /** Only after pollers, deliveries and outbox/orphan I/O have really drained. */
  async release(): Promise<void> {
    this.revoked = true;
    this.stopRenewing();
    await this.renewInFlight;
    this.active = false;
    const removed = await this.connection.eval(
      `
local old=redis.call('HGET',KEYS[1],ARGV[1]);if not old then return 1 end
local ok,d=pcall(cjson.decode,old)
if not ok or type(d)~='table' or d.protocol~=ARGV[2] or d.revision~=ARGV[3] or d.source~=ARGV[4] or d.billingConsumer~=(ARGV[5]=='1') then return 0 end
redis.call('HDEL',KEYS[1],ARGV[1]);return 1`,
      1,
      this.key,
      this.bootId,
      EMAIL_RUNTIME_LEASE_PROTOCOL,
      this.identity.revision,
      this.identity.source,
      this.billingConsumer ? '1' : '0',
    );
    if (removed !== 1) throw new EmailRuntimeLeaseError('runtime_registry_malformed');
  }
}

function actor(value: string): Actor {
  try {
    const raw: unknown = JSON.parse(value);
    if (!raw || typeof raw !== 'object') throw new Error();
    const a = raw as Partial<Actor>;
    if (
      Object.keys(a).sort().join(',') !==
        'billingConsumer,expiresAt,protocol,ready,revision,source' ||
      typeof a.protocol !== 'string' ||
      typeof a.revision !== 'string' ||
      typeof a.source !== 'string' ||
      typeof a.billingConsumer !== 'boolean' ||
      typeof a.ready !== 'boolean' ||
      !Number.isSafeInteger(a.expiresAt)
    )
      throw new Error();
    return a as Actor;
  } catch {
    throw new EmailRuntimeLeaseError('runtime_registry_malformed');
  }
}

/** Global broker-key read. The witness seal is recomputed from evidence;
 * caller booleans and CLIENT LIST are not admission proof. Registry absence
 * never excludes an unregistered legacy actor.
 */
export async function invalidateEmailRuntimeAdoption(
  connection: Redis,
  witness: EmailRuntimeAdoptionWitness,
  prefix = EMAIL_RUNTIME_REGISTRY_PREFIX,
): Promise<void> {
  const sealed = verifySealedAdoptionWitness(witness, Date.now());
  registryKey(prefix);
  await connection.hset(`${prefix}:invalidated`, sealed.evidenceDigest, '1');
}

export async function readEmailRuntimeLeases(
  connection: Redis,
  witness: EmailRuntimeAdoptionWitness | undefined,
  prefix = EMAIL_RUNTIME_REGISTRY_PREFIX,
): Promise<{ workers: number }> {
  const sealed = verifySealedAdoptionWitness(witness, Date.now());
  const invalidated = await connection.hget(`${prefix}:invalidated`, sealed.evidenceDigest);
  if (invalidated)
    throw new EmailRuntimeLeaseError('runtime_adoption_unverified', 'rollback_invalidated');
  const result: unknown = await connection.eval(READ, 1, registryKey(prefix), MAX_ACTORS);
  if (
    !Array.isArray(result) ||
    result.length !== 2 ||
    typeof result[0] !== 'number' ||
    !Array.isArray(result[1]) ||
    result[1].length % 2
  )
    throw new EmailRuntimeLeaseError('runtime_registry_malformed');
  const [now, rows] = result as [number, unknown[]];
  verifySealedAdoptionWitness(sealed, now);
  let workers = 0;
  let billingWorkers = 0;
  for (let i = 0; i < rows.length; i += 2) {
    if (
      typeof rows[i] !== 'string' ||
      !UUID.test(rows[i] as string) ||
      typeof rows[i + 1] !== 'string'
    )
      throw new EmailRuntimeLeaseError('runtime_registry_malformed');
    const a = actor(rows[i + 1] as string);
    if (a.expiresAt > now + 120_000) throw new EmailRuntimeLeaseError('runtime_registry_malformed');
    if (
      a.protocol !== EMAIL_RUNTIME_LEASE_PROTOCOL ||
      !sealed.revisions.some((r) => r.revision === a.revision && r.source === a.source)
    )
      throw new EmailRuntimeLeaseError('incompatible_workers');
    // A crashed/expired actor may own unsettled external I/O. Never erase or
    // ignore its tombstone through TTL, source ancestry or fresh enrollment.
    if (a.expiresAt <= now) throw new EmailRuntimeLeaseError('runtime_settlement_unverified');
    if (!a.ready) continue;
    workers++;
    if (a.billingConsumer) billingWorkers++;
  }
  if (!workers || (sealed.billingConsumerRequired && !billingWorkers))
    throw new EmailRuntimeLeaseError('no_workers');
  return { workers };
}
