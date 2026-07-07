// @declutrmail/shared/flags — types for the feature-flag manifest
// (ADR-0025).

export interface FlagDefinition {
  /** Ships-on value when no override is present. */
  readonly default: boolean;
  /**
   * What the flag gates and where it mounts, so a founder scanning the
   * manifest can flip with confidence. Cite the D/ADR the feature
   * traces to.
   */
  readonly description: string;
}
