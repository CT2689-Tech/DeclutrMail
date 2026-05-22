import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { KmsProvider } from '@declutrmail/shared/contracts';

/**
 * NestJS DI token for the KmsProvider adapter. An interface cannot be a
 * DI token, so the auth module provides the concrete adapter (chosen by
 * `createKmsProvider`) under this string token.
 */
export const KMS_PROVIDER = 'KMS_PROVIDER';

/** Result of envelope-encrypting an OAuth token — maps 1:1 to the
 * `mailbox_accounts` OAuth-token columns (D14). */
export interface EnvelopeCiphertext {
  /** iv(12) || authTag(16) || ciphertext — goes to `encrypted_refresh_token`. */
  ciphertext: Buffer;
  /** The DEK wrapped by the KMS KEK — goes to `dek_encrypted`. */
  wrappedDek: Buffer;
  /** KEK version used — goes to `key_version`. */
  keyVersion: number;
}

/**
 * TokenCryptoService — D14 envelope encryption for OAuth tokens.
 *
 * Each token gets a fresh random 256-bit DEK. The token is encrypted
 * with the DEK (AES-256-GCM); the DEK is then wrapped by the KMS KEK.
 * The KEK never enters this process. Decrypt reverses both steps.
 *
 * Ciphertext layout: iv(12 bytes) || authTag(16 bytes) || ciphertext.
 */
@Injectable()
export class TokenCryptoService {
  constructor(@Inject(KMS_PROVIDER) private readonly kms: KmsProvider) {}

  async encrypt(plaintext: string): Promise<EnvelopeCiphertext> {
    const dek = randomBytes(32);
    const iv = randomBytes(12);

    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([iv, authTag, ct]);

    const wrappedDek = await this.kms.wrap(dek);

    return { ciphertext, wrappedDek, keyVersion: this.kms.keyVersion };
  }

  async decrypt(ciphertext: Buffer, wrappedDek: Buffer): Promise<string> {
    const dek = await this.kms.unwrap(wrappedDek);

    const iv = ciphertext.subarray(0, 12);
    const authTag = ciphertext.subarray(12, 28);
    const data = ciphertext.subarray(28);

    const decipher = createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}
