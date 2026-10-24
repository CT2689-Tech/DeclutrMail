'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

import { isNativeShell } from './shell';

// The bridge and the Capacitor plugins behind it load only inside the native
// shell; every other visitor downloads none of it.
const NativeShellBridge = dynamic(
  () => import('./shell-bridge').then((module) => module.NativeShellBridge),
  { ssr: false },
);

export function NativeShellGate(): React.ReactElement | null {
  const [inShell, setInShell] = useState(false);
  useEffect(() => setInShell(isNativeShell()), []);
  return inShell ? <NativeShellBridge /> : null;
}
