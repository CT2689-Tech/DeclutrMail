/**
 * The deterministic triage cascade (D20, D21, D22).
 *
 * Lives in shared rather than workers because it runs in two places: the
 * score worker, and the browser, where the public inbox simulator derives
 * its fixture verdicts from it (D133). A fixture that hardcoded a verdict
 * could show a recommendation the engine would never make; deriving it
 * means the demo cannot drift from the engine.
 */
export {
  CASCADE_RULE_IDS,
  CASCADE_RULE_PHRASE,
  GOV_UNSUB_CONFIDENCE_CAP,
  isGovernmentDomain,
  MIN_UNSUB_STREAM_VOLUME,
  runCascade,
} from './cascade';
export type {
  CascadePhase,
  CascadeResult,
  CascadeRuleId,
  SenderSignals,
  UnsubscribeChannel,
} from './cascade';
