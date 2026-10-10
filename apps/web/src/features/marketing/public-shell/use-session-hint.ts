'use client';

import { useEffect, useState } from 'react';

/** A cookie-presence hint only; the app still verifies the session. No auth request before paint. */
export function useSessionHint(): boolean {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    setPresent(/(?:^|;\s*)dm_csrf=/.test(document.cookie));
  }, []);
  return present;
}
