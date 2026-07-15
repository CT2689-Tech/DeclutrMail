import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the KMS client BEFORE the provider import so the constructor
// inside `GcpKmsProvider` (which calls `new KeyManagementServiceClient()`)
// gets the stub instance the test owns. The test mutates `encryptImpl` /
// `decryptImpl` per case to drive each branch of the provider.
const encryptImpl = vi.fn();
const decryptImpl = vi.fn();

vi.mock('@google-cloud/kms', () => ({
  // vitest 4: a mock invoked with `new` needs a constructable
  // implementation — arrow functions are rejected. A `function`
  // returning the stub object keeps the same behavior.
  KeyManagementServiceClient: vi.fn(function () {
    return {
      encrypt: encryptImpl,
      decrypt: decryptImpl,
    };
  }),
}));

import { GcpKmsProvider } from './gcp-kms.provider.js';

const KEY_RESOURCE = 'projects/p/locations/l/keyRings/r/cryptoKeys/k';

/**
 * D181 — `kms.access_error` audit emit. The recorder is wired by
 * `createKmsProvider` (Nest auth-crypto module + worker bootstrap);
 * the provider invokes it BEFORE the existing throw on each failure
 * branch so a recorder failure cannot mutate the original error
 * reaching `TokenCryptoService`.
 *
 * Failure branches under test:
 *
 *   - encrypt rejects             → reason `kms_call_failed`
 *   - encrypt returns no ct        → reason `kms_returned_no_ciphertext`
 *   - decrypt rejects             → reason `kms_call_failed`
 *   - decrypt returns no pt        → reason `kms_returned_no_plaintext`
 *
 * The recorder is fire-and-forget — a recorder that throws must not
 * alter the original error type.
 */
describe('GcpKmsProvider — D181 kms.access_error emit', () => {
  beforeEach(() => {
    encryptImpl.mockReset();
    decryptImpl.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('records reason=kms_call_failed when encrypt rejects, and rethrows the original error', async () => {
    const upstream = new Error('PERMISSION_DENIED: roles/cloudkms.cryptoKeyEncrypterDecrypter');
    encryptImpl.mockRejectedValueOnce(upstream);
    const recorder = vi.fn();
    const provider = new GcpKmsProvider(KEY_RESOURCE, recorder);

    await expect(provider.wrap(Buffer.from('dek'))).rejects.toBe(upstream);
    expect(recorder).toHaveBeenCalledWith({
      operation: 'encrypt',
      reason: 'kms_call_failed',
      keyResource: KEY_RESOURCE,
    });
  });

  it('records reason=kms_returned_no_ciphertext when encrypt resolves without ciphertext', async () => {
    encryptImpl.mockResolvedValueOnce([{}]);
    const recorder = vi.fn();
    const provider = new GcpKmsProvider(KEY_RESOURCE, recorder);

    await expect(provider.wrap(Buffer.from('dek'))).rejects.toThrow(
      /GcpKmsProvider\.wrap: KMS returned no ciphertext/,
    );
    expect(recorder).toHaveBeenCalledWith({
      operation: 'encrypt',
      reason: 'kms_returned_no_ciphertext',
      keyResource: KEY_RESOURCE,
    });
  });

  it('records reason=kms_call_failed when decrypt rejects, and rethrows', async () => {
    const upstream = new Error('UNAVAILABLE: deadline exceeded');
    decryptImpl.mockRejectedValueOnce(upstream);
    const recorder = vi.fn();
    const provider = new GcpKmsProvider(KEY_RESOURCE, recorder);

    await expect(provider.unwrap(Buffer.from('ct'))).rejects.toBe(upstream);
    expect(recorder).toHaveBeenCalledWith({
      operation: 'decrypt',
      reason: 'kms_call_failed',
      keyResource: KEY_RESOURCE,
    });
  });

  it('records reason=kms_returned_no_plaintext when decrypt resolves without plaintext', async () => {
    decryptImpl.mockResolvedValueOnce([{}]);
    const recorder = vi.fn();
    const provider = new GcpKmsProvider(KEY_RESOURCE, recorder);

    await expect(provider.unwrap(Buffer.from('ct'))).rejects.toThrow(
      /GcpKmsProvider\.unwrap: KMS returned no plaintext/,
    );
    expect(recorder).toHaveBeenCalledWith({
      operation: 'decrypt',
      reason: 'kms_returned_no_plaintext',
      keyResource: KEY_RESOURCE,
    });
  });

  it('never records on a successful wrap / unwrap', async () => {
    encryptImpl.mockResolvedValueOnce([{ ciphertext: Buffer.from('wrapped') }]);
    decryptImpl.mockResolvedValueOnce([{ plaintext: Buffer.from('unwrapped') }]);
    const recorder = vi.fn();
    const provider = new GcpKmsProvider(KEY_RESOURCE, recorder);

    await provider.wrap(Buffer.from('dek'));
    await provider.unwrap(Buffer.from('ct'));

    expect(recorder).not.toHaveBeenCalled();
  });

  it('still throws the original error when the recorder itself throws (fire-and-forget)', async () => {
    const upstream = new Error('GCP boom');
    encryptImpl.mockRejectedValueOnce(upstream);
    const recorder = vi.fn().mockImplementation(() => {
      throw new Error('audit pipe burst');
    });
    const provider = new GcpKmsProvider(KEY_RESOURCE, recorder);

    await expect(provider.wrap(Buffer.from('dek'))).rejects.toBe(upstream);
    expect(recorder).toHaveBeenCalledTimes(1);
  });

  it('preserves existing behavior when no recorder is wired', async () => {
    encryptImpl.mockResolvedValueOnce([{}]);
    const provider = new GcpKmsProvider(KEY_RESOURCE);
    await expect(provider.wrap(Buffer.from('dek'))).rejects.toThrow(/no ciphertext/);
  });

  it('payload never copies the raw upstream error message (regression)', async () => {
    // The reason enum is deliberately closed; an upstream GCP error
    // can mention internal project paths / key resources beyond the
    // single safe `keyResource` field. Assert the recorder argument
    // does not echo the upstream message text.
    const upstream = new Error(
      'PERMISSION_DENIED: caller does not have permission on key projects/secret-proj/keys/internal',
    );
    encryptImpl.mockRejectedValueOnce(upstream);
    const recorder = vi.fn();
    const provider = new GcpKmsProvider(KEY_RESOURCE, recorder);

    await expect(provider.wrap(Buffer.from('dek'))).rejects.toBe(upstream);
    const arg = recorder.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(JSON.stringify(arg)).not.toContain('PERMISSION_DENIED');
    expect(JSON.stringify(arg)).not.toContain('secret-proj');
  });
});
