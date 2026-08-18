import { queryOptions } from '@tanstack/react-query';
import type { AccountDeletionStatus } from '@declutrmail/shared/contracts';

export const ACCOUNT_DELETION_QUERY_KEY = ['account-deletion'] as const;

type AccountDeletionReader = (signal: AbortSignal) => Promise<AccountDeletionStatus>;

export function accountDeletionQueryOptions(reader: AccountDeletionReader) {
  return queryOptions({
    queryKey: ACCOUNT_DELETION_QUERY_KEY,
    queryFn: ({ signal }) => reader(signal),
    staleTime: 60_000,
  });
}
