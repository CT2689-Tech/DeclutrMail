import { KeyManagementServiceClient } from '@google-cloud/kms';
import type { KmsProvider } from '@declutrmail/shared/contracts';

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

  /** Full KMS crypto-key resource name, e.g.
   * `projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>`. */
  constructor(private readonly keyResource: string) {}

  async wrap(dek: Buffer): Promise<Buffer> {
    const [result] = await this.client.encrypt({
      name: this.keyResource,
      plaintext: dek,
    });
    if (!result.ciphertext) {
      throw new Error('GcpKmsProvider.wrap: KMS returned no ciphertext');
    }
    return Buffer.from(result.ciphertext);
  }

  async unwrap(wrapped: Buffer): Promise<Buffer> {
    const [result] = await this.client.decrypt({
      name: this.keyResource,
      ciphertext: wrapped,
    });
    if (!result.plaintext) {
      throw new Error('GcpKmsProvider.unwrap: KMS returned no plaintext');
    }
    return Buffer.from(result.plaintext);
  }
}
