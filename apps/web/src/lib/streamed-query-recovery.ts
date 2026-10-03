/** Safe transport marker; the server settlement owns original diagnostics. */
export class StreamedQueryRecoveryError extends Error {
  constructor() {
    super('Optional query is recovering in the browser');
    this.name = 'DeclutrMailStreamedQueryRecovery';
  }
}

export function isStreamedQueryRecoveryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'DeclutrMailStreamedQueryRecovery' &&
    error.message === 'Optional query is recovering in the browser'
  );
}
