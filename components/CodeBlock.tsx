'use client';
import { useState } from 'react';

// Code sample: shiki-highlighted HTML (server-rendered) shown as a peek, expanded only via the toggle
// button (clicking/selecting the code never collapses it), with a copy button. `code` is the raw source.
export function CodeBlock({ html, code }: { html: string; code: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-edge">
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation(); // don't trigger the click-to-expand below
            void copy();
          }}
          className="absolute right-2 top-2 z-10 rounded-md border border-edge bg-ink/70 px-2 py-1 text-[11px] text-slate-300 backdrop-blur-sm transition hover:bg-white/10"
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        {/* collapsed: click anywhere to expand. expanded: no handler, so text stays selectable. */}
        <div
          onClick={expanded ? undefined : () => setExpanded(true)}
          className={`text-[11px] [&>pre]:m-0 [&>pre]:overflow-x-auto [&>pre]:p-3 [&>pre]:leading-relaxed ${
            expanded ? 'max-h-none' : 'max-h-44 cursor-pointer overflow-hidden'
          }`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {!expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#24292e] to-transparent" />
        )}
      </div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-edge bg-ink/40 py-1.5 text-[11px] text-accent transition hover:bg-white/5"
      >
        {expanded ? '▲ Collapse' : '▼ Show full example'}
      </button>
    </div>
  );
}
