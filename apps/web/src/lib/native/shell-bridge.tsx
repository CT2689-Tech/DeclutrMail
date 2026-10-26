'use client';

import { useEffect } from 'react';

import { installShellBridge } from './oauth-shell';

/** Mounts the native shell's OAuth diversion and return handling. Renders nothing. */
export function NativeShellBridge(): null {
  useEffect(() => {
    let teardown: (() => void) | undefined;
    let unmounted = false;
    void installShellBridge().then((remove) => {
      if (unmounted) remove();
      else teardown = remove;
    });
    return () => {
      unmounted = true;
      teardown?.();
    };
  }, []);
  return null;
}
