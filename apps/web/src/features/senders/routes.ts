/** Href G2 uses for "Review them first". Ids stay in the query, in order. */
export function sendersFixSetHref(senderIds: readonly string[]): string {
  const params = new URLSearchParams();
  for (const id of senderIds) {
    if (id.length > 0) params.append('fix', id);
  }
  const query = params.toString();
  return query.length > 0 ? `/senders?${query}` : '/senders';
}
