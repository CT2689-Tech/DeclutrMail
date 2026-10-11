import { createHash } from 'node:crypto';
import { EmailRuntimeLeaseError, EMAIL_RUNTIME_WORKER_REVISION } from './email-runtime-lease.js';

/** Sealed adoption protocol. A caller-supplied boolean bag is not this record. */
export const EMAIL_RUNTIME_ADOPTION_PROTOCOL = 'email-runtime-adoption-v1';

const SOURCE = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const API_REVISION = /^declutrmail-api-[a-z0-9-]{1,80}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HOLDER_ID = /^[a-z0-9:._-]{1,120}$/;
const PROBE_ID = /^[a-z0-9-]{1,63}$/;
const POOL_ENV = ['CLOUD_RUN_WORKER_POOL', 'CLOUD_RUN_REVISION'] as const;

const WORKER_ROLES = ['email-send', 'brief-email', 'outbox'] as const;
const API_ROLE = 'api-preference-writer' as const;
const BILLING_ROLE = 'billing-email' as const;
type WorkloadRole = (typeof WORKER_ROLES)[number] | typeof API_ROLE | typeof BILLING_ROLE;

const GUARDS = ['on', 'off', 'held', 'unset', 'malformed'] as const;
type AdmissionGuard = (typeof GUARDS)[number];

const BOUNDARIES = [
  'positive-process-drain-io',
  'password-reset',
  'revision-metadata',
  'namespace-migration',
  'registry-absence',
] as const;
export type EmailRuntimeRetirementBoundary = (typeof BOUNDARIES)[number];

export interface EmailRuntimeHostingSnapshot {
  kind: 'cloud-run-service';
  project: string;
  workerRegion: string;
  apiRegion: string;
  workerService: string;
  apiService: string;
  workerRevision: string;
  apiRevision: string;
  source: string;
  imageDigest: string;
  workerConfiguredGeneration: number;
  workerObservedGeneration: number;
  apiConfiguredGeneration: number;
  apiObservedGeneration: number;
  workerTrafficPercent: number;
  apiTrafficPercent: number;
  tagRoutes: number;
  workerAdmissionGuard: AdmissionGuard;
  apiAdmissionGuard: AdmissionGuard;
}

export interface EmailRuntimeWorkload {
  role: WorkloadRole;
  revision: string;
  source: string;
  identity: string;
  ready: boolean;
  held: boolean;
  admissionGuard: AdmissionGuard;
}

export interface EmailRuntimeCredentialHolder {
  id: string;
  coverage: 'authoritative' | 'unavailable' | 'denied';
  processRetired: true | 'unverified';
  requestsDrained: true | 'unverified';
  externalIoSettled: true | 'unverified';
  providerRevisionStatus: 'retired' | 'ready' | 'unknown';
}

export interface EmailRuntimeAdoptionEvidence {
  reviewedSource: string;
  imageDigest: string;
  hostingBefore: EmailRuntimeHostingSnapshot;
  hostingAfter: EmailRuntimeHostingSnapshot;
  workloads: EmailRuntimeWorkload[];
  credentialHolders: EmailRuntimeCredentialHolder[];
  outstandingWork: 'settled' | 'pending' | 'unverified';
  retirementBoundary: EmailRuntimeRetirementBoundary;
  probe: {
    id: string;
    imageDigest: string;
    source: string;
    owned: boolean;
    cleanedBefore: boolean;
    cleanedAfter: boolean;
  };
  observation: {
    digestBefore: string;
    digestAfter: string;
    observedAt: number;
  };
  billingConsumerRequired: boolean;
}

export interface EmailRuntimeAdoptionWitness {
  protocol: typeof EMAIL_RUNTIME_ADOPTION_PROTOCOL;
  evidenceDigest: string;
  evidence: EmailRuntimeAdoptionEvidence;
  validUntil: number;
  billingConsumerRequired: boolean;
  revisions: { revision: string; source: string }[];
}

export type EmailRuntimeHostingDecision =
  | { kind: 'cloud-run-service'; service: string; revision: string }
  | { kind: 'unsupported'; reason: 'worker_pool' | 'mixed' | 'missing' | 'malformed' };

/**
 * Cloud Run services identify themselves with K_SERVICE and K_REVISION.
 * Worker pools publish CLOUD_RUN_WORKER_POOL and CLOUD_RUN_REVISION instead.
 * PR #972 is unmerged, so a pool is unsupported: reading the pool revision
 * as if it were K_REVISION would not prove pool admission, drain, or retirement.
 */
export function classifyEmailRuntimeHosting(
  env: Record<string, string | undefined>,
): EmailRuntimeHostingDecision {
  const pool = POOL_ENV.some((key) => {
    const value = env[key];
    return value !== undefined && value !== '';
  });
  const revision = env.K_REVISION;
  const hasRevision = revision !== undefined && revision !== '';
  if (pool && hasRevision) return { kind: 'unsupported', reason: 'mixed' };
  if (pool) return { kind: 'unsupported', reason: 'worker_pool' };
  if (!hasRevision || env.K_SERVICE !== 'declutrmail-worker')
    return { kind: 'unsupported', reason: 'missing' };
  if (!EMAIL_RUNTIME_WORKER_REVISION.test(revision))
    return { kind: 'unsupported', reason: 'malformed' };
  return { kind: 'cloud-run-service', service: 'declutrmail-worker', revision };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function emailRuntimeHostingDigest(hosting: EmailRuntimeHostingSnapshot): string {
  return createHash('sha256').update(canonicalJson(hosting)).digest('hex');
}

export function emailRuntimeEvidenceDigest(evidence: EmailRuntimeAdoptionEvidence): string {
  return createHash('sha256').update(canonicalJson(evidence)).digest('hex');
}

function refuse(detail: string): never {
  throw new EmailRuntimeLeaseError('runtime_adoption_unverified', detail);
}

function keys(value: object, allowed: readonly string[]): void {
  const present = Object.keys(value).sort();
  const expect = [...allowed].sort();
  if (present.length !== expect.length || present.some((key, index) => key !== expect[index]))
    refuse('malformed_evidence');
}

function generation(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) refuse('malformed_evidence');
}

function assertHosting(
  hosting: EmailRuntimeHostingSnapshot,
  evidence: EmailRuntimeAdoptionEvidence,
): void {
  keys(hosting, [
    'kind',
    'project',
    'workerRegion',
    'apiRegion',
    'workerService',
    'apiService',
    'workerRevision',
    'apiRevision',
    'source',
    'imageDigest',
    'workerConfiguredGeneration',
    'workerObservedGeneration',
    'apiConfiguredGeneration',
    'apiObservedGeneration',
    'workerTrafficPercent',
    'apiTrafficPercent',
    'tagRoutes',
    'workerAdmissionGuard',
    'apiAdmissionGuard',
  ]);
  if (hosting.kind !== 'cloud-run-service') refuse('worker_pool_hosting');
  if (
    hosting.project !== 'declutrmail-ai-prod' ||
    hosting.workerRegion !== 'us-west1' ||
    hosting.apiRegion !== 'us-central1' ||
    hosting.workerService !== 'declutrmail-worker' ||
    hosting.apiService !== 'declutrmail-api'
  )
    refuse('malformed_evidence');
  if (
    !EMAIL_RUNTIME_WORKER_REVISION.test(hosting.workerRevision) ||
    !API_REVISION.test(hosting.apiRevision) ||
    hosting.source !== evidence.reviewedSource ||
    hosting.imageDigest !== evidence.imageDigest
  )
    refuse('source_drift');
  generation(hosting.workerConfiguredGeneration);
  generation(hosting.workerObservedGeneration);
  generation(hosting.apiConfiguredGeneration);
  generation(hosting.apiObservedGeneration);
  if (
    hosting.workerConfiguredGeneration !== hosting.workerObservedGeneration ||
    hosting.apiConfiguredGeneration !== hosting.apiObservedGeneration
  )
    refuse('generation_drift');
  if (hosting.workerTrafficPercent !== 100 || hosting.apiTrafficPercent !== 100)
    refuse('traffic_incomplete');
  if (hosting.tagRoutes !== 0) refuse('tag_routes');
  if (!GUARDS.includes(hosting.workerAdmissionGuard) || !GUARDS.includes(hosting.apiAdmissionGuard))
    refuse('malformed_evidence');
  for (const guard of [hosting.workerAdmissionGuard, hosting.apiAdmissionGuard]) {
    if (guard === 'held') refuse('admission_held');
    if (guard !== 'on') refuse('admission_guard_off');
  }
}

function assertWorkloads(evidence: EmailRuntimeAdoptionEvidence): void {
  if (!Array.isArray(evidence.workloads)) refuse('malformed_evidence');
  const required: WorkloadRole[] = [...WORKER_ROLES, API_ROLE];
  if (evidence.billingConsumerRequired) required.push(BILLING_ROLE);
  const roles = evidence.workloads.map((row) => row.role);
  if (new Set(roles).size !== roles.length) refuse('incomplete_inventory');
  for (const role of required) if (!roles.includes(role)) refuse('incomplete_inventory');
  for (const role of roles) if (!required.includes(role)) refuse('malformed_evidence');
  const worker = evidence.hostingBefore.workerRevision;
  const api = evidence.hostingBefore.apiRevision;
  for (const row of evidence.workloads) {
    keys(row, ['role', 'revision', 'source', 'identity', 'ready', 'held', 'admissionGuard']);
    if (row.source !== evidence.reviewedSource) refuse('source_drift');
    if (row.ready !== true || row.held !== false || row.admissionGuard !== 'on') {
      if (row.held === true || row.admissionGuard === 'held') refuse('admission_held');
      if (row.admissionGuard !== 'on') refuse('admission_guard_off');
      refuse('incomplete_inventory');
    }
    if (row.role === API_ROLE) {
      if (row.revision !== api || row.identity !== api) refuse('unmapped_actor');
    } else if (row.revision !== worker || !UUID.test(row.identity)) {
      refuse('unmapped_actor');
    }
  }
}

function assertRetirement(evidence: EmailRuntimeAdoptionEvidence): void {
  if (!BOUNDARIES.includes(evidence.retirementBoundary)) refuse('malformed_evidence');
  // Password reset is not a supported boundary until the Upstash rehearsal
  // records what already-authenticated connections do. Revision metadata,
  // namespace migration, and registry absence cannot exclude a live process.
  if (evidence.retirementBoundary !== 'positive-process-drain-io')
    refuse('retirement_boundary_unsupported');
  if (!Array.isArray(evidence.credentialHolders) || evidence.credentialHolders.length === 0)
    refuse('incomplete_inventory');
  if (evidence.outstandingWork !== 'settled') {
    if (evidence.outstandingWork !== 'pending' && evidence.outstandingWork !== 'unverified')
      refuse('malformed_evidence');
    refuse('outstanding_work_unsettled');
  }
  const seen = new Set<string>();
  for (const holder of evidence.credentialHolders) {
    keys(holder, [
      'id',
      'coverage',
      'processRetired',
      'requestsDrained',
      'externalIoSettled',
      'providerRevisionStatus',
    ]);
    if (!HOLDER_ID.test(holder.id) || seen.has(holder.id)) refuse('malformed_evidence');
    seen.add(holder.id);
    if (
      holder.id === evidence.hostingBefore.workerRevision ||
      holder.id === evidence.hostingBefore.apiRevision
    )
      refuse('retirement_unverified');
    if (holder.coverage === 'denied') refuse('credential_coverage_denied');
    if (holder.coverage === 'unavailable') refuse('credential_coverage_unavailable');
    if (holder.coverage !== 'authoritative') refuse('malformed_evidence');
    if (
      holder.processRetired !== true ||
      holder.requestsDrained !== true ||
      holder.externalIoSettled !== true
    )
      refuse('retirement_unverified');
    if (!['retired', 'ready', 'unknown'].includes(holder.providerRevisionStatus))
      refuse('malformed_evidence');
  }
}

function assertProbe(evidence: EmailRuntimeAdoptionEvidence): void {
  const probe = evidence.probe;
  keys(probe, ['id', 'imageDigest', 'source', 'owned', 'cleanedBefore', 'cleanedAfter']);
  if (
    !PROBE_ID.test(probe.id) ||
    probe.imageDigest !== evidence.imageDigest ||
    probe.source !== evidence.reviewedSource ||
    probe.owned !== true ||
    probe.cleanedBefore !== true ||
    probe.cleanedAfter !== true
  )
    refuse('probe_unverified');
  const before = emailRuntimeHostingDigest(evidence.hostingBefore);
  const after = emailRuntimeHostingDigest(evidence.hostingAfter);
  keys(evidence.observation, ['digestBefore', 'digestAfter', 'observedAt']);
  if (
    !HEX64.test(evidence.observation.digestBefore) ||
    evidence.observation.digestBefore !== before ||
    evidence.observation.digestAfter !== after ||
    before !== after
  )
    refuse('observation_drift');
  if (!Number.isSafeInteger(evidence.observation.observedAt) || evidence.observation.observedAt < 0)
    refuse('malformed_evidence');
}

/** Structural predicates only. Freshness uses the broker clock at read time. */
export function assertEmailRuntimeAdoptionEvidence(evidence: EmailRuntimeAdoptionEvidence): void {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence))
    refuse('malformed_evidence');
  keys(evidence, [
    'reviewedSource',
    'imageDigest',
    'hostingBefore',
    'hostingAfter',
    'workloads',
    'credentialHolders',
    'outstandingWork',
    'retirementBoundary',
    'probe',
    'observation',
    'billingConsumerRequired',
  ]);
  if (!SOURCE.test(evidence.reviewedSource) || !DIGEST.test(evidence.imageDigest))
    refuse('malformed_evidence');
  if (typeof evidence.billingConsumerRequired !== 'boolean') refuse('malformed_evidence');
  assertHosting(evidence.hostingBefore, evidence);
  assertHosting(evidence.hostingAfter, evidence);
  assertWorkloads(evidence);
  assertRetirement(evidence);
  assertProbe(evidence);
}

export function attestEmailRuntimeAdoption(
  evidence: EmailRuntimeAdoptionEvidence,
): EmailRuntimeAdoptionWitness {
  assertEmailRuntimeAdoptionEvidence(evidence);
  return {
    protocol: EMAIL_RUNTIME_ADOPTION_PROTOCOL,
    evidenceDigest: emailRuntimeEvidenceDigest(evidence),
    evidence,
    validUntil: evidence.observation.observedAt + 300_000,
    billingConsumerRequired: evidence.billingConsumerRequired,
    revisions: [
      { revision: evidence.hostingBefore.workerRevision, source: evidence.reviewedSource },
    ],
  };
}

export function verifySealedAdoptionWitness(
  witness: unknown,
  now: number,
): EmailRuntimeAdoptionWitness {
  if (!witness || typeof witness !== 'object' || Array.isArray(witness)) refuse('caller_witness');
  const record = witness as Partial<EmailRuntimeAdoptionWitness>;
  if (
    record.protocol !== EMAIL_RUNTIME_ADOPTION_PROTOCOL ||
    !record.evidence ||
    typeof record.evidenceDigest !== 'string'
  )
    refuse('caller_witness');
  if (emailRuntimeEvidenceDigest(record.evidence) !== record.evidenceDigest) refuse('witness_seal');
  assertEmailRuntimeAdoptionEvidence(record.evidence);
  if (record.billingConsumerRequired !== record.evidence.billingConsumerRequired)
    refuse('witness_seal');
  const validUntil = record.evidence.observation.observedAt + 300_000;
  if (record.validUntil !== validUntil) refuse('witness_seal');
  const revisions = record.revisions;
  if (
    !Array.isArray(revisions) ||
    revisions.length !== 1 ||
    revisions[0]?.revision !== record.evidence.hostingBefore.workerRevision ||
    revisions[0]?.source !== record.evidence.reviewedSource
  )
    refuse('witness_seal');
  const observedAt = record.evidence.observation.observedAt;
  if (
    !Number.isSafeInteger(now) ||
    observedAt > now + 5_000 ||
    now - observedAt > 120_000 ||
    now >= validUntil ||
    validUntil > now + 600_000
  )
    refuse('stale_evidence');
  return record as EmailRuntimeAdoptionWitness;
}

export type EmailRuntimeProcedurePhase =
  'paused' | 'worker-held' | 'worker-ready' | 'api-open' | 'rolled-back';

export type EmailRuntimeProcedureAction = 'install-held' | 'mark-ready' | 'reopen-api' | 'rollback';

export interface EmailRuntimeProcedureState {
  phase: EmailRuntimeProcedurePhase;
  adoptionCertified: boolean;
  activationEnabled: false;
  invalidatedDigest?: string;
}

/**
 * Installation order: pause, held worker (no enrollment), attested worker
 * and outbox, then the attested API. Rollback drops certification and
 * never enables notice activation. Billing notices stay off in every phase.
 */
export function advanceEmailRuntimeAdoption(
  state: EmailRuntimeProcedureState,
  action: EmailRuntimeProcedureAction,
  witness?: EmailRuntimeAdoptionWitness,
): EmailRuntimeProcedureState {
  if (state.activationEnabled !== false) refuse('activation_refused');
  if (action === 'rollback') {
    return {
      phase: 'rolled-back',
      adoptionCertified: false,
      activationEnabled: false,
      ...(witness ? { invalidatedDigest: witness.evidenceDigest } : {}),
    };
  }
  switch (state.phase) {
    case 'paused':
      if (action !== 'install-held') refuse('procedure');
      if (witness) refuse('admission_held');
      return { phase: 'worker-held', adoptionCertified: false, activationEnabled: false };
    case 'worker-held': {
      if (action !== 'mark-ready' || !witness) refuse('procedure');
      verifySealedAdoptionWitness(witness, Date.now());
      return { phase: 'worker-ready', adoptionCertified: true, activationEnabled: false };
    }
    case 'worker-ready': {
      if (action !== 'reopen-api' || !witness) refuse('procedure');
      verifySealedAdoptionWitness(witness, Date.now());
      return { phase: 'api-open', adoptionCertified: true, activationEnabled: false };
    }
    case 'api-open':
    case 'rolled-back':
      refuse('procedure');
      break;
    default: {
      const unreachable: never = state.phase;
      return unreachable;
    }
  }
}

/**
 * API validation boot has no admission-held mode and does not write email
 * preferences during startup. The installation boundary is traffic, not a
 * new flag: the new API revision stays at zero traffic until the worker
 * and outbox are attested.
 */
export const API_VALIDATION_START = {
  admissionHeldMode: false,
  bootstrapsProcessOnValidationBoot: true,
  writesPreferencesAtBoot: false,
  boundary: 'no-traffic-until-attested-worker-and-outbox',
} as const;
