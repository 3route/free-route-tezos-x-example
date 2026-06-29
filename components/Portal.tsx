'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Render children into document.body, escaping any ancestor stacking context (e.g. the sticky <aside> that
// hosts the Activity log) so fixed overlays sit above the sticky Header instead of being trapped beneath it.
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}
