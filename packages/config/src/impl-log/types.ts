/**
 * Implementation-log types (D158).
 *
 * The log is half DERIVED and half RECORDED, and the split is the whole
 * design:
 *
 *   - DERIVED (⬜ / 🔵, and which PR shipped a decision) is recomputed
 *     from the plan and from `Closes D###` trailers. Nothing human is
 *     stored for it.
 *   - RECORDED (🟢 / 🚫 / 🟡 / 🔴 / ⏸️, verification evidence, notes) is
 *     human knowledge that exists nowhere else, so it lives in git — one
 *     file per decision under `.impl-log/`.
 *
 * The recorded half used to live inside the rendered table, which made
 * the table the source of truth for its own regeneration and put every
 * parallel PR in conflict on one file. One file per decision means two
 * PRs recording different decisions never touch the same path.
 */

/** Every state a decision row can carry. */
export const ALL_STATES = ['⬜', '🔵', '🟢', '🚫', '🟡', '🔴', '⏸️'] as const;
export type State = (typeof ALL_STATES)[number];

/** States a human records; the rest are derived. */
export const RECORDED_STATES = ['🟢', '🚫', '🟡', '🔴', '⏸️'] as const;
export type RecordedState = (typeof RECORDED_STATES)[number];

/** One decision as parsed from the plan. */
export interface Decision {
  num: number;
  title: string;
}

/**
 * The recorded half for one decision — the contents of `.impl-log/D###.md`.
 *
 * `pr` exists only for decisions shipped before `Closes D###` trailers
 * were the convention: their PRs cannot be derived, so the number is
 * remembered. A decision shipped under trailer discipline records
 * nothing here and takes its citation from the derivation.
 */
export interface Fragment {
  num: number;
  status?: RecordedState | '🔵';
  /** Evidence for 🟢 — a command that was run or an observation made. */
  verifiedBy?: string;
  note?: string;
  /** Legacy, pre-trailer PR references. */
  pr?: string;
}

/** A fully composed row, ready to render. */
export interface ComposedRow {
  num: number;
  title: string;
  status: State;
  pr: string;
  verifiedBy: string;
  notes: string;
}

/** A PR as the generator needs it. */
export interface PrRef {
  number: number;
  body: string;
  files: { path: string }[];
}
