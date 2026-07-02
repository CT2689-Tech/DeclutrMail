import { KeyManagementServiceClient } from '@google-cloud/kms';
import type { KmsProvider } from '@declutrmail/shared/contracts';

/**
 * Reason enum for the D181 `kms.access_error` audit emit. A closed set
 * so the audit payload never carries raw GCP error text (which can
 * contain project/key resource names beyond what the safe payload
 * surfaces explicitly).
 *
 *   - `kms_returned_no_ciphertext` — the wrap call succeeded at the
 *     transport level but the response was missing `ciphertext`.
 *   - `kms_returned_no_plaintext`  — same shape for the unwrap call.
 *   - `kms_call_failed`            — the SDK rejected (permission denied,
 *     network, KMS 5xx, …).
 */
export type KmsAccessErrorReason =
  'kms_returned_no_ciphertext' | 'kms_returned_no_plaintext' | 'kms_call_failed';

/** Operation that produced the {@link KmsAccessErrorReason}. */
export type KmsOperation = 'encrypt' | 'decrypt';

/**
 * Optional fire-and-forget audit callback (D181). Invoked by
 * {@link GcpKmsProvider} on each wrap / unwrap failure with the
 * operation kind, controlled reason, and the configured KMS key
 * resource (an operator-meaningful identifier — NOT a secret).
 *
 * Implementations MUST NOT throw and MUST NOT delay the caller;
 * the recorder runs alongside the original throw and never alters
 * or replaces it. The provider additionally wraps the call in a
 * defensive try/catch as belt-and-braces.
 */
export type KmsAccessErrorRecorder = (failure: {
  operation: KmsOperation;
  reason: KmsAccessErrorReason;
  keyResource: string;
}) => void;

/**
 * GcpKmsProvider — the deployed-environment KMS adapter (D14, D201).
 *
 * Wraps / unwraps the per-record DEK using a Cloud KMS crypto key. The
 * KEK never leaves KMS; this process only ever holds the wrapped DEK
 * and asks KMS to encrypt/decrypt it. The app service account needs
 * `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the key.
 *
 * Selected by the factory when `KMS_KEY_RESOURCE` is set.
 */
export class GcpKmsProvider implements KmsProvider {
  readonly keyVersion = 1;

  private readonly client = new KeyManagementServiceClient();
  private readonly onAccessError: KmsAccessErrorRecorder | undefined;

  /** Full KMS crypto-key resource name, e.g.
   * `projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>`. */
  constructor(
    private readonly keyResource: string,
    onAccessError?: KmsAccessErrorRecorder,
  ) {
    this.onAccessError = onAccessError;
  }

  async wrap(dek: Buffer): Promise<Buffer> {
    let ciphertext: Uint8Array | string | null | undefined;
    try {
      const response = await this.client.encrypt({
        name: this.keyResource,
        plaintext: dek,
      });
      ciphertext = response[0]?.ciphertext;
    } catch (err) {
      // D181: emit BEFORE the rethrow so a recorder failure (swallowed
      // below) cannot alter the original error reaching TokenCryptoService.
      this.emit('encrypt', 'kms_call_failed');
      throw err;
    }
    if (!ciphertext) {
      this.emit('encrypt', 'kms_returned_no_ciphertext');
      throw new Error('GcpKmsProvider.wrap: KMS returned no ciphertext');
    }
    return Buffer.from(ciphertext);
  }

  async unwrap(wrapped: Buffer): Promise<Buffer> {
    let plaintext: Uint8Array | string | null | undefined;
    try {
      const response = await this.client.decrypt({
        name: this.keyResource,
        ciphertext: wrapped,
      });
      plaintext = response[0]?.plaintext;
    } catch (err) {
      this.emit('decrypt', 'kms_call_failed');
      throw err;
    }
    if (!plaintext) {
      this.emit('decrypt', 'kms_returned_no_plaintext');
      throw new Error('GcpKmsProvider.unwrap: KMS returned no plaintext');
    }
    return Buffer.from(plaintext);
  }

  /**
   * Run the D181 audit recorder if one was wired. Wrapped in try/catch
   * so a buggy recorder cannot mutate the wrap/unwrap throw — the
   * recorder is documented as fire-and-forget, this is defense in
   * depth (mirrors the same pattern in {@link GmailClientService}).
   */
  private emit(operation: KmsOperation, reason: KmsAccessErrorReason): void {
    if (!this.onAccessError) {
      return;
    }
    try {
      this.onAccessError({ operation, reason, keyResource: this.keyResource });
    } catch {
      // Swallow — the recorder must never break the KMS path.
    }
  }
}
