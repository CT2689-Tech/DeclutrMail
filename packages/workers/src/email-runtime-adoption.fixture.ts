import {
  attestEmailRuntimeAdoption,
  emailRuntimeHostingDigest,
  type EmailRuntimeAdoptionEvidence,
  type EmailRuntimeAdoptionWitness,
  type EmailRuntimeHostingSnapshot,
  type EmailRuntimeRetirementBoundary,
} from './email-runtime-adoption.js';

export const FIXTURE_SOURCE = 'a'.repeat(40);
export const FIXTURE_WORKER = 'declutrmail-worker-00164-synthetic';
export const FIXTURE_API = 'declutrmail-api-00641-synthetic';
const IMAGE = `sha256:${'b'.repeat(64)}`;

function hosting(source: string, workerRevision: string): EmailRuntimeHostingSnapshot {
  return {
    kind: 'cloud-run-service',
    project: 'declutrmail-ai-prod',
    workerRegion: 'us-west1',
    apiRegion: 'us-central1',
    workerService: 'declutrmail-worker',
    apiService: 'declutrmail-api',
    workerRevision,
    apiRevision: FIXTURE_API,
    source,
    imageDigest: IMAGE,
    workerConfiguredGeneration: 171,
    workerObservedGeneration: 171,
    apiConfiguredGeneration: 643,
    apiObservedGeneration: 643,
    workerTrafficPercent: 100,
    apiTrafficPercent: 100,
    tagRoutes: 0,
    workerAdmissionGuard: 'on',
    apiAdmissionGuard: 'on',
  };
}

/** Shape-only fixture. Sealing it does not certify a production fleet. */
export function adoptionEvidence(options?: {
  now?: number;
  source?: string;
  workerRevision?: string;
  billingConsumerRequired?: boolean;
  boundary?: EmailRuntimeRetirementBoundary;
  mutate?: (evidence: EmailRuntimeAdoptionEvidence) => void;
}): EmailRuntimeAdoptionEvidence {
  const source = options?.source ?? FIXTURE_SOURCE;
  const workerRevision = options?.workerRevision ?? FIXTURE_WORKER;
  const snapshot = hosting(source, workerRevision);
  const billing = options?.billingConsumerRequired ?? false;
  const evidence: EmailRuntimeAdoptionEvidence = {
    reviewedSource: source,
    imageDigest: IMAGE,
    hostingBefore: snapshot,
    hostingAfter: { ...snapshot },
    workloads: [
      {
        role: 'email-send',
        revision: workerRevision,
        source,
        identity: '00000000-0000-4000-8000-000000000001',
        ready: true,
        held: false,
        admissionGuard: 'on',
      },
      {
        role: 'brief-email',
        revision: workerRevision,
        source,
        identity: '00000000-0000-4000-8000-000000000002',
        ready: true,
        held: false,
        admissionGuard: 'on',
      },
      {
        role: 'outbox',
        revision: workerRevision,
        source,
        identity: '00000000-0000-4000-8000-000000000003',
        ready: true,
        held: false,
        admissionGuard: 'on',
      },
      {
        role: 'api-preference-writer',
        revision: FIXTURE_API,
        source,
        identity: FIXTURE_API,
        ready: true,
        held: false,
        admissionGuard: 'on',
      },
      ...(billing
        ? [
            {
              role: 'billing-email' as const,
              revision: workerRevision,
              source,
              identity: '00000000-0000-4000-8000-000000000004',
              ready: true,
              held: false,
              admissionGuard: 'on' as const,
            },
          ]
        : []),
    ],
    credentialHolders: [
      {
        id: 'declutrmail-worker-00001-legacy',
        coverage: 'authoritative',
        processRetired: true,
        requestsDrained: true,
        externalIoSettled: true,
        providerRevisionStatus: 'unknown',
      },
      {
        id: 'redis:legacy-holder',
        coverage: 'authoritative',
        processRetired: true,
        requestsDrained: true,
        externalIoSettled: true,
        providerRevisionStatus: 'retired',
      },
    ],
    outstandingWork: 'settled',
    retirementBoundary: options?.boundary ?? 'positive-process-drain-io',
    probe: {
      id: 'fixture-probe',
      imageDigest: IMAGE,
      source,
      owned: true,
      cleanedBefore: true,
      cleanedAfter: true,
    },
    observation: {
      digestBefore: emailRuntimeHostingDigest(snapshot),
      digestAfter: emailRuntimeHostingDigest(snapshot),
      observedAt: options?.now ?? Date.now(),
    },
    billingConsumerRequired: billing,
  };
  options?.mutate?.(evidence);
  return evidence;
}

export function sealedWitness(
  options?: Parameters<typeof adoptionEvidence>[0],
): EmailRuntimeAdoptionWitness {
  return attestEmailRuntimeAdoption(adoptionEvidence(options));
}
