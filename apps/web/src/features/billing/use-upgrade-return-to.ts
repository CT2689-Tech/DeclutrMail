'use client';

import { usePathname, useSearchParams } from 'next/navigation';

/** Retain the feature, selected sender and filters when entering an upgrade. */
export function useUpgradeReturnTo(): string | undefined {
  const pathname = usePathname();
  const search = useSearchParams()?.toString();
  if (!pathname || pathname === '/billing' || new URLSearchParams(search).has('from'))
    return undefined;
  // This comes from the mounted app route. Billing validates it at entry
  // and again before returning after a server-confirmed upgrade.
  return `${pathname}${search ? `?${search}` : ''}`;
}
