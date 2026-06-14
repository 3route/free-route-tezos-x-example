'use client';
import { useId, useMemo } from 'react';
import { nftHue, nftName } from '@/lib/names';

// Deterministic generative cover art for a token (the test FA2 has no metadata): a mesh gradient built on the
// token's base hue + a few seeded geometric shapes (overlay-blended) + faint grain + a monogram initial.
// Pure SVG, no deps, memoized by tokenId. Drop-in: size/rounding come from `className`.

// mulberry32 — small, fast, seeded PRNG.
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (tokenId: number | string) => Number((BigInt(tokenId) * 2654435761n) % 4294967296n);
const initials = (tokenId: number | string) =>
  nftName(tokenId)
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export function NftArt({ tokenId, className }: { tokenId: number | string; className?: string }) {
  const uid = useId().replace(/:/g, ''); // unique per instance (avoids SVG id collisions)
  const art = useMemo(() => {
    const r = makeRng(seedOf(tokenId));
    const h = nftHue(tokenId); // dominant hue stays consistent with the rest of the UI
    const hues = [h, (h + 35 + Math.floor(r() * 50)) % 360, (h + 190 + Math.floor(r() * 50)) % 360];
    const blobs = hues.map((hue) => ({ hue, cx: 12 + r() * 76, cy: 12 + r() * 76 }));
    const shapes = Array.from({ length: 2 + Math.floor(r() * 2) }, () => ({
      kind: Math.floor(r() * 3), // 0 disc · 1 ring · 2 triangle
      x: 10 + r() * 80,
      y: 10 + r() * 80,
      s: 14 + r() * 30,
      rot: r() * 360,
      hue: hues[Math.floor(r() * hues.length)],
      op: 0.22 + r() * 0.3,
    }));
    return { h, hues, blobs, shapes };
  }, [tokenId]);

  const hsl = (hue: number, s: number, l: number) => `hsl(${hue} ${s}% ${l}%)`;

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      <defs>
        {art.blobs.map((b, i) => (
          <radialGradient key={i} id={`${uid}b${i}`} cx={`${b.cx}%`} cy={`${b.cy}%`} r="65%">
            <stop offset="0%" stopColor={hsl(b.hue, 78, 62)} stopOpacity="0.95" />
            <stop offset="100%" stopColor={hsl(b.hue, 70, 45)} stopOpacity="0" />
          </radialGradient>
        ))}
        <filter id={`${uid}grain`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.05" />
          </feComponentTransfer>
        </filter>
      </defs>

      <rect width="100" height="100" fill={hsl(art.h, 60, 20)} />
      {art.blobs.map((_, i) => (
        <rect key={i} width="100" height="100" fill={`url(#${uid}b${i})`} />
      ))}

      <g style={{ mixBlendMode: 'overlay' }}>
        {art.shapes.map((sh, i) => {
          const c = hsl(sh.hue, 82, 66);
          if (sh.kind === 0) return <circle key={i} cx={sh.x} cy={sh.y} r={sh.s / 2} fill={c} opacity={sh.op} />;
          if (sh.kind === 1) return <circle key={i} cx={sh.x} cy={sh.y} r={sh.s / 2} fill="none" stroke={c} strokeWidth={2.5} opacity={sh.op} />;
          const p = sh.s / 2;
          return (
            <polygon
              key={i}
              points={`${sh.x},${sh.y - p} ${sh.x - p},${sh.y + p} ${sh.x + p},${sh.y + p}`}
              fill={c}
              opacity={sh.op}
              transform={`rotate(${sh.rot} ${sh.x} ${sh.y})`}
            />
          );
        })}
      </g>

      <text x="50" y="52" textAnchor="middle" dominantBaseline="central" fontSize="32" fontWeight={800} fill="#fff" fillOpacity="0.12" fontFamily="ui-sans-serif, system-ui, sans-serif">
        {initials(tokenId)}
      </text>

      <rect width="100" height="100" filter={`url(#${uid}grain)`} />
    </svg>
  );
}
