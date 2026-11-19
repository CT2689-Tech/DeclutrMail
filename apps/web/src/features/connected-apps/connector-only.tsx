'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether the person viewing the page can connect an app (the connector
 * answered `/api/oauth/grants`). False until a screen that asked says
 * otherwise, so copy about connected apps never describes a feature the
 * person cannot use.
 */
export const ConnectorAvailableContext = createContext(false);

/** Its children, only where the connector is available. */
export function ConnectorOnly({ children }: { children: ReactNode }) {
  return useContext(ConnectorAvailableContext) ? <>{children}</> : null;
}
