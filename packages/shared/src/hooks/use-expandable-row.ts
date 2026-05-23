'use client';

import { useCallback, useState } from 'react';

/**
 * Headless single-row-accordion behavior (D198).
 *
 * One row may be expanded at a time. Calling `onExpand(id)` expands
 * that row and collapses any other; calling it with `null` collapses
 * the current row. `onExpand(currentlyExpandedId)` is a toggle.
 *
 * Generic over the row id type — consumers may use `string`, a numeric
 * id, or a branded id type. The hook does not assume DOM, so it is
 * safe to share with `apps/mobile/` later (per D198 / D173).
 *
 * State ownership note: per the task spec for this PR, this hook owns
 * its own `expandedRowId` state. D198's plan body sketches a variant
 * where state is lifted to the feature's Zustand store; that
 * controlled-input variant can be added as a sibling overload when a
 * consumer needs cross-component coordination. For now, every consumer
 * is a single component-tree owner of its accordion.
 */
export interface UseExpandableRowResult<TId> {
  /** Currently expanded row id, or `null` if none. */
  expandedRowId: TId | null;
  /**
   * Expand the given row id, collapsing any other. Passing the
   * currently-expanded id toggles it closed. Passing `null` collapses
   * any open row.
   */
  onExpand: (rowId: TId | null) => void;
  /** Returns true iff the given row id is the expanded row. */
  isExpanded: (rowId: TId) => boolean;
}

/**
 * Pure reducer for the next expanded id given the current expanded id
 * and the requested target. Exposed for unit testing so the accordion
 * semantics can be asserted without a React renderer.
 */
export function nextExpandedRowId<TId>(current: TId | null, requested: TId | null): TId | null {
  // Toggle: requesting the already-expanded row collapses it.
  if (requested !== null && current !== null && Object.is(current, requested)) {
    return null;
  }
  return requested;
}

export function useExpandableRow<TId>(
  initialExpandedRowId: TId | null = null,
): UseExpandableRowResult<TId> {
  const [expandedRowId, setExpandedRowId] = useState<TId | null>(initialExpandedRowId);

  const onExpand = useCallback((rowId: TId | null) => {
    setExpandedRowId((current) => nextExpandedRowId(current, rowId));
  }, []);

  const isExpanded = useCallback(
    (rowId: TId) => expandedRowId !== null && Object.is(expandedRowId, rowId),
    [expandedRowId],
  );

  return { expandedRowId, onExpand, isExpanded };
}
