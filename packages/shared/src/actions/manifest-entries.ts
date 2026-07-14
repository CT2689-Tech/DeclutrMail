// @declutrmail/shared/actions — the Action Registry (ADR-0015).
//
// ONE typed descriptor per verb: the source of truth for the button
// label + microcopy, the preview surface, the per-selector tier
// capabilities, and the pipeline routing (which worker + how to build
// the mutation). P2 shipped the foundation with ZERO consumers — P3
// wired the worker to `execution`; P4 (this change) appends the
// `later` / `unsubscribe` / `unarchive` verbs AND wires the web surfaces
// to `copy` + `shortcut` + `preview`. The bulk SELECTORS + reservation
// table remain deferred (P5+).
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
import {
  ACTION_SEMANTICS,
  staticActionPreviewCopy,
  type ActionSemantics,
} from './action-semantics';

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
  readonly later: Record<string, never>;
  readonly unsubscribe: Record<string, never>;
  readonly unarchive: Record<string, never>;
  /**
   * Delete verb (ADR-0019). Currently params-less — the time-window
   * filter (`olderThanDays`) lives on the `action_jobs.older_than_days`
   * column directly, not as a verb param, because the worker reads it
   * from the row when resolving the message set. Future Delete-specific
   * params (e.g., a "skip Important label" toggle) land here.
   */
  readonly delete: Record<string, never>;
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
    }
  | {
      readonly kind: 'unsubscribe';
      /**
       * The standing side-effect label applied when a sender is
       * unsubscribed (`DeclutrMail/Unsubscribed`). Static — no params.
       *
       * The per-sender one-click vs mailto RESOLUTION (`resolveMethod`,
       * Codex §4 sketch) is deliberately NOT modeled here: it needs the
       * `List-Unsubscribe` sender data this registry does not carry, and
       * at launch mailto unsubscribe is manual (D230). It lands with the
       * mailto-batch CTA work (P9). Until then `unsubscribe` carries only
       * the routing discriminant + this side-effect so the FE can read
       * its copy/shortcut/preview without a half-built resolver.
       *
       * PRIVACY (D7): label ids only, never body.
       */
      readonly sideEffect: LabelChange;
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
  readonly semantics: ActionSemantics & { readonly verb: V };
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
    semantics: ACTION_SEMANTICS.keep,
    copy: {
      primary: ACTION_SEMANTICS.keep.label,
      description: staticActionPreviewCopy('keep'),
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
    semantics: ACTION_SEMANTICS.archive,
    copy: {
      primary: ACTION_SEMANTICS.archive.label,
      description: staticActionPreviewCopy('archive'),
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
  later: {
    verb: 'later',
    semantics: ACTION_SEMANTICS.later,
    copy: {
      primary: ACTION_SEMANTICS.later.label,
      description: staticActionPreviewCopy('later'),
    },
    shortcut: CANONICAL_SHORTCUTS.later,
    preview: 'modal',
    capabilities: {
      sender: { tier: 'free', countsAsCleanup: true },
      'multi-sender': { tier: 'plus', countsAsCleanup: true, cap: 1000 },
      'sender-filter': { tier: 'pro', countsAsCleanup: true },
    },
    execution: {
      kind: 'label-modify',
      // Later = drop INBOX + tag DeclutrMail/Later; undo restores the
      // inbox + clears the tag. Modeled as the label mutation that moves
      // EXISTING mail — the future-mail standing rule is a separate
      // policy concern (like keep's policy-only), wired later, NOT bundled
      // into this label delta. A label-modify verb, so it shares the
      // LabelActionWorker + the action_verb pg_enum (P5).
      buildLabelChange: () => ({
        forward: { removeLabelIds: ['INBOX'], addLabelIds: ['DeclutrMail/Later'] },
        reverse: { addLabelIds: ['INBOX'], removeLabelIds: ['DeclutrMail/Later'] },
      }),
    },
  },
  unsubscribe: {
    verb: 'unsubscribe',
    semantics: ACTION_SEMANTICS.unsubscribe,
    copy: {
      primary: ACTION_SEMANTICS.unsubscribe.label,
      description: staticActionPreviewCopy('unsubscribe'),
    },
    shortcut: CANONICAL_SHORTCUTS.unsubscribe,
    preview: 'modal',
    capabilities: {
      sender: { tier: 'free', countsAsCleanup: true },
      'multi-sender': { tier: 'plus', countsAsCleanup: true, cap: 1000 },
      'sender-filter': { tier: 'pro', countsAsCleanup: true },
    },
    execution: {
      kind: 'unsubscribe',
      // Its OWN kind (Codex §4 — never misclassified as label-modify, so
      // it never reaches the LabelActionWorker). Carries only the standing
      // side-effect label at V2; the one-click vs mailto resolver lands at
      // P9 (D230). NOT in the label-modify pg_enum.
      sideEffect: { addLabelIds: ['DeclutrMail/Unsubscribed'] },
    },
  },
  delete: {
    verb: 'delete',
    semantics: ACTION_SEMANTICS.delete,
    copy: {
      primary: ACTION_SEMANTICS.delete.label,
      description: staticActionPreviewCopy('delete'),
    },
    shortcut: CANONICAL_SHORTCUTS.delete,
    // Delete is destructive in a way that survives undo — Trash recovery
    // window is 30 days vs Archive/Later's 7d. Modal preview MANDATORY
    // per D226; the modal renders the red Delete tone + recovery-window
    // banner per spec v1.2 Decision 15 ConfirmActionModal redesign.
    preview: 'modal',
    capabilities: {
      sender: { tier: 'free', countsAsCleanup: true },
      'multi-sender': { tier: 'plus', countsAsCleanup: true, cap: 1000 },
      'sender-filter': { tier: 'pro', countsAsCleanup: true },
    },
    execution: {
      // Routes through `label-modify` kind because Gmail's `TRASH` is
      // internally a label; `batchModify` with `addLabelIds:['TRASH']` is
      // semantically equivalent to `messages.trash` per Gmail API
      // (the message gains TRASH; Gmail hides it from inbox view). We
      // ALSO drop `INBOX` explicitly so the local label mirror reflects
      // "out of inbox" — our sender-inbox queries use
      // `'INBOX' = ANY(labelIds)`, which would otherwise still return
      // trashed messages. Reverse re-adds `INBOX` + removes `TRASH` so
      // undo within the 30-day Gmail Trash window restores the inbox
      // state the user expects (spec v1.2 Decision 1).
      kind: 'label-modify',
      buildLabelChange: () => ({
        forward: { addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] },
        reverse: { addLabelIds: ['INBOX'], removeLabelIds: ['TRASH'] },
      }),
    },
  },
  unarchive: {
    verb: 'unarchive',
    semantics: ACTION_SEMANTICS.unarchive,
    copy: {
      // Not a K/A/U/L triage verb — a restore op (Q3 "Restore from bulk"),
      // so its label is descriptive, not one of the four canonical verbs.
      primary: ACTION_SEMANTICS.unarchive.label,
      description: staticActionPreviewCopy('unarchive'),
    },
    // No canonical single-key shortcut — unarchive is not part of K/A/U/L.
    shortcut: null,
    preview: 'modal',
    capabilities: {
      // Single-sender restore only (Q3). Bulk restore is not a launch
      // surface — no multi-sender / sender-filter selector.
      sender: { tier: 'free', countsAsCleanup: false },
      'multi-sender': null,
      'sender-filter': null,
    },
    execution: {
      kind: 'label-modify',
      // The inverse of archive — re-add INBOX; undo drops it again. A
      // label-modify verb (so it would ride the shared LabelActionWorker),
      // but it is NOT in the `action_verb` pg_enum yet: the worker writes
      // the verb into `undo_action_kind` + `activity_action`, neither of
      // which includes `unarchive`. Wiring it is the restore-pipeline
      // change (those two enums + worker support), deferred until there is
      // a producer.
      buildLabelChange: () => ({
        forward: { addLabelIds: ['INBOX'] },
        reverse: { removeLabelIds: ['INBOX'] },
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
