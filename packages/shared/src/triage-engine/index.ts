// @declutrmail/shared/triage-engine — the deterministic triage cascade
// (D20, D21, D22) and its D24 template renderer.
//
// Lives in shared rather than workers because both run in two places: the
// score worker, and the browser, where the public inbox simulator derives
// its fixture verdicts and reasoning copy from them (D133). A fixture that
// hardcoded a verdict or reasoning string could drift from what the engine
// would actually produce; deriving both means the demo cannot drift from
// the engine.
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
export { renderTemplate, VERDICT_LABEL } from './template';
