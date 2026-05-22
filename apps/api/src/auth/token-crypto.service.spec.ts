import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { LocalKeyKmsProvider } from '../adapters/gcp-kms/local-key-kms.provider.js';
import { TokenCryptoService } from './token-crypto.service.js';

/**
 * TokenCryptoService unit tests (D14).
 *
 * Built on LocalKeyKmsProvider with a per-run random key — no GCP, no
 * env dependency, so the envelope encrypt/decrypt path is verifiable in
 * CI. Plain-class instantiation; no @nestjs/testing needed.
 */
function makeService(): TokenCryptoService {
  const kms = new LocalKeyKmsProvider(randomBytes(32).toString('hex'));
  return new TokenCryptoService(kms);
}

const SAMPLE_TOKEN = '1//0eXaMpLeReFrEsHtOkEn-not-a-real-secret_abcdef0123456789';

describe('TokenCryptoService', () => {
  it('round-trips: encrypt then decrypt returns the original token', async () => {
    const svc = makeService();
    const { ciphertext, wrappedDek } = await svc.encrypt(SAMPLE_TOKEN);

    const decrypted = await svc.decrypt(ciphertext, wrappedDek);
    expect(decrypted).toBe(SAMPLE_TOKEN);
  });

  it('reports the KMS key version', async () => {
    const svc = makeService();
    const { keyVersion } = await svc.encrypt(SAMPLE_TOKEN);
    expect(keyVersion).toBe(1);
  });

  it('rejects decryption when the ciphertext is tampered (GCM auth tag)', async () => {
    const svc = makeService();
    const { ciphertext, wrappedDek } = await svc.encrypt(SAMPLE_TOKEN);

    // Flip a byte inside the encrypted payload (past iv+authTag).
    const tampered = Buffer.from(ciphertext);
    const last = tampered.length - 1;
    tampered.writeUInt8(tampered.readUInt8(last) ^ 0xff, last);

    await expect(svc.decrypt(tampered, wrappedDek)).rejects.toThrow();
  });

  it('produces a distinct ciphertext and wrapped DEK on each encrypt', async () => {
    const svc = makeService();
    const a = await svc.encrypt(SAMPLE_TOKEN);
    const b = await svc.encrypt(SAMPLE_TOKEN);

    // Random DEK + random IV → no two encryptions match.
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);

    // Both still decrypt back to the same plaintext.
    expect(await svc.decrypt(a.ciphertext, a.wrappedDek)).toBe(SAMPLE_TOKEN);
    expect(await svc.decrypt(b.ciphertext, b.wrappedDek)).toBe(SAMPLE_TOKEN);
  });
});
