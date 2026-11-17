// Shared JSON-LD building blocks for public pages.
//
// One source for the Organization identity and for BreadcrumbList nodes,
// so the layout's Organization, the article publisher that points at it,
// and every page's breadcrumb trail cannot drift apart.

import { siteUrl } from './landing/urls';

/** `@id` of the Organization node the marketing layout emits on every page. */
export function organizationId(): string {
  return `${siteUrl()}/#organization`;
}

/** The logo the Organization node publishes. */
export function organizationLogoUrl(): string {
  return `${siteUrl()}/icons/icon-512.png`;
}

export interface Crumb {
  /** The label the visible breadcrumb shows for this step. */
  readonly name: string;
  /** Site-relative path, e.g. `/compare`. */
  readonly path: string;
}

/**
 * A BreadcrumbList node: Home, then `crumbs` in order, the last one being
 * the page itself. Names must be the labels a reader sees in the visible
 * breadcrumb. No `@context`: nest it (`WebPage.breadcrumb`) or spread it
 * into a standalone node.
 */
export function breadcrumbList(crumbs: readonly Crumb[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', path: '' }, ...crumbs].map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: `${siteUrl()}${crumb.path}`,
    })),
  };
}
