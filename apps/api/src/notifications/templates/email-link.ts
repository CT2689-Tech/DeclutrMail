import type { EmailLinkTemplate } from '@declutrmail/shared/analytics/sanitize-product-event';

/**
 * Adds from, mailbox (when the email is about one mailbox), and
 * utm_source=email&utm_campaign=<template>. Preserves an existing
 * query and a hash. Does not belong on the API unsubscribe token URL.
 */
export function emailLink(
  path: string,
  options: { template: EmailLinkTemplate; mailboxId?: string },
): string {
  const hashAt = path.indexOf('#');
  const hash = hashAt === -1 ? '' : path.slice(hashAt);
  const withoutHash = hashAt === -1 ? path : path.slice(0, hashAt);
  const queryAt = withoutHash.indexOf('?');
  const base = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? '' : withoutHash.slice(queryAt + 1));
  if (options.mailboxId !== undefined && !params.has('mailbox')) {
    params.append('mailbox', options.mailboxId);
  }
  params.set('from', options.template);
  params.set('utm_source', 'email');
  params.set('utm_campaign', options.template);
  const query = params.toString();
  return `${base}${query.length > 0 ? `?${query}` : ''}${hash}`;
}
