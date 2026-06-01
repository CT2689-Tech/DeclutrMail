// @declutrmail/shared/actions — the Action Registry (ADR-0015).
//
// A non-React module (pure TS) so the NestJS api + BullMQ workers can
// import the registry without pulling the component tree. Re-exports the
// verb vocabulary from contracts/ so this subpath is a one-stop import.

export { ACTION_REGISTRY, getActionDescriptor, listActionDescriptors } from './manifest-entries';
export type {
  ActionCapability,
  ActionCopy,
  ActionDescriptor,
  ActionExecution,
  ActionRegistry,
  CapabilitiesBySelector,
  LabelChange,
  LabelChangePair,
  ParamsForVerb,
  PolicyDelta,
  VerbParams,
} from './manifest-entries';

export {
  ACTION_TIER_RANK,
  ACTION_TIERS,
  ACTION_VERBS,
  CANONICAL_SHORTCUTS,
  EXECUTION_KINDS,
  isActionVerb,
  PREVIEW_MODES,
  SELECTOR_TYPES,
} from '../contracts/verb-constants';
export type {
  ActionTier,
  ActionVerb,
  CanonicalShortcut,
  CanonicalVerb,
  ExecutionKind,
  PreviewMode,
  SelectorType,
} from '../contracts/verb-constants';
