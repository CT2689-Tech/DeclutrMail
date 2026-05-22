/**
 * KmsProvider — the adapter contract for the KMS external boundary
 * (D201: external integrations sit behind an interface, never the raw
 * SDK). The auth module's TokenCryptoService depends on this interface,
 * not on `@google-cloud/kms` directly.
 *
 * Envelope encryption (D14): the KEK never leaves the KMS. `wrap`
 * encrypts a per-record DEK with the KEK; `unwrap` reverses it.
 */
export interface KmsProvider {
  /** KEK version used by this provider — persisted so rotation is traceable. */
  readonly keyVersion: number;

  /** Encrypt (wrap) the data-encryption key with the key-encryption key. */
  wrap(dek: Buffer): Promise<Buffer>;

  /** Decrypt (unwrap) a previously wrapped data-encryption key. */
  unwrap(wrapped: Buffer): Promise<Buffer>;
}
