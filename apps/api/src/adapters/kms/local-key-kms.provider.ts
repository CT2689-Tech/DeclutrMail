import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { KmsProvider } from './kms-provider.js';

/**
 * LocalKeyKmsProvider — the D14-sanctioned local-dev fallback.
 *
 * Local dev has no Cloud KMS. When `KMS_KEY_RESOURCE` is unset, the
 * factory uses this provider, which wraps the DEK with AES-256-GCM
 * under a 32-byte key supplied via `ENCRYPTION_LOCAL_KEY` (64 hex
 * chars). Dev tokens are test-account only — this fallback is never
 * used in deployed environments.
 *
 * Wrapped layout: iv(12) || authTag(16) || ciphertext.
 */
export class LocalKeyKmsProvider implements KmsProvider {
  readonly keyVersion = 1;

  /** 32-byte key-encryption key (the local KEK stand-in). */
  private readonly key: Buffer;

  constructor(keyHex: string) {
    const key = Buffer.from(keyHex, 'hex');
    if (key.length !== 32) {
      throw new Error(
        'LocalKeyKmsProvider: key must be 32 bytes (64 hex chars) — ' +
          'generate with `openssl rand -hex 32`',
      );
    }
    this.key = key;
  }

  async wrap(dek: Buffer): Promise<Buffer> {
    // 12-byte IV is the AES-GCM standard nonce length.
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  async unwrap(wrapped: Buffer): Promise<Buffer> {
    const iv = wrapped.subarray(0, 12);
    const authTag = wrapped.subarray(12, 28);
    const ciphertext = wrapped.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
