'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useActiveWallet } from '@/lib/account';

// Shared connect CTA: a button that opens a Temple / MetaMask picker dropdown (the app's two signing
// directions). Auto-flips upward when there's no room below, closes on outside-click, and notifies the
// parent via onOpenChange so it can raise a clipping container above its siblings while open.
export function ConnectButton({
  children = 'Connect wallet',
  header = 'Connect with',
  buttonClassName = 'btn-primary w-full',
  wrapperClassName = 'relative',
  onOpenChange,
}: {
  children?: ReactNode;
  header?: string;
  buttonClassName?: string;
  wrapperClassName?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const aw = useActiveWallet();
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false); // flip upward when near the bottom of the viewport
  const ref = useRef<HTMLDivElement>(null);
  const set = (o: boolean) => {
    if (o) {
      const r = ref.current?.getBoundingClientRect();
      setDropUp(!!r && window.innerHeight - r.bottom < 160); // ~picker height + margin
    }
    setOpen(o);
    onOpenChange?.(o);
  };
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && set(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className={wrapperClassName} ref={ref}>
      <button className={buttonClassName} disabled={aw.connecting} onClick={() => set(!open)}>
        {aw.connecting ? 'Connecting…' : children}
      </button>
      {open && (
        <div className={`absolute left-0 right-0 z-30 rounded-xl border border-edge bg-panel p-1.5 shadow-xl shadow-black/50 ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500">{header}</div>
          <button
            className="btn-ghost w-full justify-between"
            onClick={() => {
              set(false);
              void aw.temple.connect();
            }}
          >
            Temple <span className="text-[10px] text-slate-500">Michelson</span>
          </button>
          <button
            className="btn-ghost mt-1 w-full justify-between"
            onClick={() => {
              set(false);
              void aw.evm.connect().catch(() => undefined);
            }}
          >
            MetaMask <span className="text-[10px] text-slate-500">EVM</span>
          </button>
        </div>
      )}
    </div>
  );
}
