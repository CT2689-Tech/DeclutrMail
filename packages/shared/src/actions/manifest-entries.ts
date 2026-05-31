// @declutrmail/shared/actions — the Action Registry (ADR-0015).
//
// ONE typed descriptor per verb: the source of truth for the button
// label + microcopy, the preview surface, the per-selector tier
// capabilities, and the pipeline routing (which worker + how to build
// the mutation). P2 ships the foundation with ZERO consumers — P3 wires
// the worker to `execution`, P4 wires the web surfaces to `copy` +
// `shortcut` + `preview`, P5 appends the bulk verbs.
//
// Design contract (Codex review, consensus 2026-05-30):
//   A. Verb vocabulary lives in contracts/verb-constants — the DB enum
//      and this registry both agree on it; neither derives the other.
//   B. `execution.kind` is a discriminated union; a verb is routed by
//      its kind and carries a PURE builder (no IO, no DB) that returns
//      the mutation to apply.
//   C. Capabilities are keyed by selector (`sender` / `multi-sender` /
//      `sender-filter`), not a single tier.

import type {
  ActionTier,
  ActionVerb,
  CanonicalShortcut,
  CanonicalVerb,
  PreviewMode,
} from '../contracts/verb-constants';
import { ACTION_VERBS, CANONICAL_SHORTCUTS } from '../contracts/verb-constants';

/**
 * A Gmail label-set delta — structurally identical to the worker's
 * `LabelChange` port (packages/workers/gmail-mutation-client). Mirrored
 * here (not imported) so `@declutrmail/shared` stays a leaf and the
 * worker's Gmail port stays self-contained. P3 reconciled the data SOURCE
 * — the worker reads `buildLabelChange` from this registry — while
 * deliberately keeping the two structurally-identical type definitions
 * independent. PRIVACY (D7): label ids only, never body.
 */
export interface LabelChange {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

/** Forward mutation + its inverse (the undo). */
export interface LabelChangePair {
  readonly forward: LabelChange;
  readonly reverse: LabelChange;
}

/**
 * A standing sender-policy mutation — the `policy-only` execution
 * output. Mirrors the mutable `sender_policies` columns a verb writes
 * (D42); the P3 PolicyActionWorker applies it. No label mutation, no
 * undo journal entry (a standing decision is not a destructive action).
 */
export interface PolicyDelta {
  /** Standing verdict (sender_policies.policy_type). */
  readonly policyType?: CanonicalVerb;
  /** Protect modifier (D42) — `keep` sets this true. */
  readonly isProtected?: boolean;
}

/**
 * Per-verb typed builder params. Each verb gets exactly the params its
 * builder needs; empty today (no verb is parametric yet), grown at P5
 * when `archive` gains a historic-scope param (Codex §10.3). The
 * mapped-type registry below forces an entry here for every verb.
 */
export interface VerbParams {
  readonly keep: Record<string, never>;
  readonly archive: Record<string, never>;
}
export type ParamsForVerb<V extends ActionVerb> = VerbParams[V];

/**
 * Pipeline routing (Codex correction B). The `kind` selects the worker;
 * the builder is a pure function of the verb's params.
 */
export type ActionExecution<V extends ActionVerb> =
  | {
      readonly kind: 'label-modify';
      readonly buildLabelChange: (params: ParamsForVerb<V>) => LabelChangePair;
    }
  | {
      readonly kind: 'policy-only';
      readonly buildPolicyWrite: (params: ParamsForVerb<V>) => PolicyDelta;
    };

/** Letter-free user-facing copy (§3.1 — shortcuts are not shown inline). */
export interface ActionCopy {
  /** Button label — canonical verb, no shortcut letter ("Archive"). */
  readonly primary: string;
  /** Preview / confirm body. */
  readonly description: string;
}

/** Tier + cleanup-counting for one selector axis (Codex correction C). */
export interface ActionCapability {
  readonly tier: ActionTier;
  /** Whether this draws down the Free 5-lifetime-cleanup counter (D19). */
  readonly countsAsCleanup: boolean;
  /** Max senders per batch for the `multi-sender` selector (D-Q1: 1000). */
  readonly cap?: number;
}

/**
 * Capabilities per selector. `sender` (single) is always supported;
 * `multi-sender` / `sender-filter` are `null` when the verb does not
 * support that selector.
 */
export interface CapabilitiesBySelector {
  readonly sender: ActionCapability;
  readonly 'multi-sender': ActionCapability | null;
  readonly 'sender-filter': ActionCapability | null;
}

/** ONE registry descriptor for a verb. */
export interface ActionDescriptor<V extends ActionVerb = ActionVerb> {
  readonly verb: V;
  readonly copy: ActionCopy;
  /**
   * Single-key shortcut (D227, K/A/U/L); bound to `event.key`. Typed to
   * the canonical letter set so a typo is a compile error — the D227
   * shortcut invariant lives in the type, not only the runtime test.
   */
  readonly shortcut: CanonicalShortcut | null;
  readonly preview: PreviewMode;
  readonly capabilities: CapabilitiesBySelector;
  readonly execution: ActionExecution<V>;
}

/** The registry type — one descriptor per verb, enforced at compile time. */
export type ActionRegistry = { readonly [V in ActionVerb]: ActionDescriptor<V> };

/**
 * The Action Registry. Adding a verb is one entry here + one append to
 * `ACTION_VERBS` + the pg_enum migration — never a new worker.
 */
export const ACTION_REGISTRY: ActionRegistry = {
  keep: {
    verb: 'keep',
    copy: {
      primary: 'Keep',
      description: "Keep this sender's mail in your inbox.",
    },
    shortcut: CANONICAL_SHORTCUTS.keep,
    // Keep is non-destructive — a 200ms toast with a 5s undo, no sheet.
    preview: 'inline-confirm',
    capabilities: {
      sender: { tier: 'free', countsAsCleanup: false },
      'multi-sender': { tier: 'plus', countsAsCleanup: false },
      'sender-filter': null,
    },
    execution: {
      kind: 'policy-only',
      // Standing "keep" verdict only. The defensive `is_protected`
      // modifier (D42 — cascade rule #1) is a SEPARATE user action
      // (Always-Keep toggle on Sender Detail), not bundled into the
      // lightweight triage Keep. P3 confirms this before wiring the
      // real sender_policies write.
      buildPolicyWrite: () => ({ policyType: 'keep' }),
    },
  },
  archive: {
    verb: 'archive',
    copy: {
      primary: 'Archive',
      description: 'Remove these messages from your inbox. You can undo this.',
    },
    shortcut: CANONICAL_SHORTCUTS.archive,
    preview: 'modal',
    capabilities: {
      sender: { tier: 'free', countsAsCleanup: true },
      'multi-sender': { tier: 'plus', countsAsCleanup: true, cap: 1000 },
      'sender-filter': { tier: 'pro', countsAsCleanup: true },
    },
    execution: {
      kind: 'label-modify',
      // Archive = drop INBOX; undo re-adds it. The LabelActionWorker reads
      // this builder as its single source of truth (P3, `labelChangeForVerb`).
      buildLabelChange: () => ({
        forward: { removeLabelIds: ['INBOX'] },
        reverse: { addLabelIds: ['INBOX'] },
      }),
    },
  },
};

/** Lookup a descriptor by verb (type-narrowed to the verb's descriptor). */
export function getActionDescriptor<V extends ActionVerb>(verb: V): ActionRegistry[V] {
  return ACTION_REGISTRY[verb];
}

/** Every registered descriptor, in `ACTION_VERBS` order. */
export function listActionDescriptors(): readonly ActionDescriptor[] {
  // Indexing the mapped registry yields a per-verb union; the cast widens
  // it to the base descriptor for a homogeneous list. (The element shapes
  // are identical at the base type — the only difference is the deferred
  // `ParamsForVerb<V>` index, which TS compares by index literal.)
  return ACTION_VERBS.map((verb) => ACTION_REGISTRY[verb]) as readonly ActionDescriptor[];
}
