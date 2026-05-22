import { GcpKmsProvider } from './gcp-kms.provider.js';
import type { KmsProvider } from './kms-provider.js';
import { LocalKeyKmsProvider } from './local-key-kms.provider.js';

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
export function createKmsProvider(env: NodeJS.ProcessEnv = process.env): KmsProvider {
  const kmsKeyResource = env.KMS_KEY_RESOURCE?.trim();
  if (kmsKeyResource) {
    return new GcpKmsProvider(kmsKeyResource);
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
