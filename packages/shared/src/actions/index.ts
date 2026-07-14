// @declutrmail/shared/actions — the Action Registry (ADR-0015).
//
// A non-React module (pure TS) so the NestJS api + BullMQ workers can
// import the registry without pulling the component tree. Re-exports the
// verb vocabulary from contracts/ so this subpath is a one-stop import.

export { ACTION_REGISTRY, getActionDescriptor, listActionDescriptors } from './manifest-entries';
export {
  ACTION_SEMANTICS,
  actionHasRecovery,
  getActionSemantics,
  staticActionPreviewCopy,
} from './action-semantics';
export type {
  ActionFinality,
  ActionScheduleRequirement,
  ActionSemantics,
  ActionSemanticsRegistry,
  ActivityUndoSemantics,
  CurrentMailDestination,
  CurrentMailScope,
  FutureMailEffect,
  ProviderRecoverySemantics,
} from './action-semantics';
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

// ADR-0019 — FE-presentation Verb Registry. Complements ACTION_REGISTRY
// for surfaces that need tone / canBePrimary / separator / icon
// metadata. See verb-registry.ts header for the BE vs FE registry split.
// Phase 5 dead-code sweep consolidates the two registries.
export {
  VERB_REGISTRY,
  PRIMARY_ELIGIBLE_VERBS,
  SECONDARY_HISTORIC_VERBS,
  verbById,
  deriveDefaultPrimary,
} from './verb-registry';
export type { VerbId, VerbSpec, VerbTone } from './verb-registry';
