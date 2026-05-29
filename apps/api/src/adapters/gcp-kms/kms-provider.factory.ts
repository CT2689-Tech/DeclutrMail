import type { KmsProvider } from '@declutrmail/shared/contracts';

import { GcpKmsProvider, type KmsAccessErrorRecorder } from './gcp-kms.provider.js';
import { LocalKeyKmsProvider } from './local-key-kms.provider.js';

/**
 * Optional factory options. Carry the D181 audit recorder when the
 * caller has one (the Nest auth-crypto module + the worker bootstrap
 * both do); local key fallback ignores the recorder because there's
 * no remote KMS surface to audit on the in-process AES path.
 */
export interface CreateKmsProviderOptions {
  /** D181 audit recorder for the GCP KMS adapter only. */
  onAccessError?: KmsAccessErrorRecorder;
}

/**
 * Builds the active KmsProvider from the environment (D14).
 *
 *   - `KMS_KEY_RESOURCE` set  → GcpKmsProvider (deployed environments).
 *   - otherwise                → LocalKeyKmsProvider, which requires
 *     `ENCRYPTION_LOCAL_KEY` (the D14 local-dev fallback).
 *
 * Throws a clear error when neither is configured — a misconfigured
 * environment must fail loudly, not silently store plaintext.
 */
export function createKmsProvider(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateKmsProviderOptions = {},
): KmsProvider {
  const kmsKeyResource = env.KMS_KEY_RESOURCE?.trim();
  if (kmsKeyResource) {
    return new GcpKmsProvider(kmsKeyResource, options.onAccessError);
  }

  const localKey = env.ENCRYPTION_LOCAL_KEY?.trim();
  if (localKey) {
    return new LocalKeyKmsProvider(localKey);
  }

  throw new Error(
    'No KMS configured: set KMS_KEY_RESOURCE (deployed) or ' +
      'ENCRYPTION_LOCAL_KEY (local dev) — see .env.example.',
  );
}
