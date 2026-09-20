/** A row held on screen after its action finished, with where it sat. */
export interface PinnedRow<T> {
  row: T;
  index: number;
}

/**
 * Overlay pinned rows on the server's list.
 *
 * A row still in the server list is left exactly as the server sent it
 * (fresh counts, and never twice). A row the refetch dropped is put back
 * at the index it held, lowest index first so each insert lands against
 * the positions the earlier ones already restored.
 */
export function mergePinnedRows<T extends { id: string }>(
  rows: readonly T[],
  pinned: ReadonlyMap<string, PinnedRow<T>>,
): readonly T[] {
  if (pinned.size === 0) return rows;
  const listed = new Set(rows.map((r) => r.id));
  const missing = [...pinned.values()]
    .filter((p) => !listed.has(p.row.id))
    .sort((a, b) => a.index - b.index);
  if (missing.length === 0) return rows;
  const out = [...rows];
  for (const p of missing) out.splice(Math.min(p.index, out.length), 0, p.row);
  return out;
}
