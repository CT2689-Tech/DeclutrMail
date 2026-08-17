import 'server-only';

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { makeServerQueryClient } from '@/lib/server-query-client';
import { ME_QUERY_KEY } from './api/me-contract';
import { getServerMe } from './api/server-me';

export async function ServerAuthBoundary({
  cookieHeader,
  children,
}: {
  cookieHeader: string;
  children: ReactNode;
}) {
  const queryClient = makeServerQueryClient();
  const me = await getServerMe(cookieHeader);
  if (me !== null) {
    queryClient.setQueryData(ME_QUERY_KEY, me);
  }

  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>;
}
