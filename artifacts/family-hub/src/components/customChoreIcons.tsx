// Custom (non-Unicode) chore icons for jobs that have no dedicated emoji —
// Unicode has no real mop/vacuum/duster/squeegee/lawn-mower/etc. glyph, so
// these ship as small hand-drawn SVGs alongside the existing full emoji-mart
// picker in EmojiPicker.tsx. Styled to read like Apple's own emoji artwork
// (filled gradient shapes + a soft drop shadow + a small glossy highlight)
// rather than thin line-art, so they sit naturally next to real emoji in the
// picker and in chore rows. A chore's `icon` field stays a single string; a
// custom icon is just stored as `"custom:<key>"` instead of a literal emoji
// character, and <ChoreIcon> below is the one place that knows how to render
// either kind — every render site in the app should use it instead of
// dropping `chore.icon` straight into JSX.

import type { ReactElement } from "react";

interface IconProps {
  className?: string;
}

// Every icon below draws itself with its own <defs> (gradients + a soft drop
// shadow), namespaced by a short prefix unique to that icon, so many can be
// mounted at once (e.g. the whole picker grid) without id collisions.

function BigVacuumIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bv-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f87171" />
          <stop offset="1" stopColor="#dc2626" />
        </linearGradient>
        <linearGradient id="bv-bag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fca5a5" />
          <stop offset="1" stopColor="#ef4444" />
        </linearGradient>
        <filter id="bv-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#bv-shadow)">
        <path d="M9 22c-1-4-1-8 0.5-11.5C10 9 14 9 14.5 10.5 16 14 16 18 15 22Z" fill="url(#bv-bag)" stroke="#b91c1c" strokeWidth="0.6" />
        <rect x="9.3" y="3" width="5.4" height="8" rx="2.2" fill="url(#bv-body)" stroke="#991b1b" strokeWidth="0.6" />
        <ellipse cx="10.6" cy="5.2" rx="0.7" ry="1.4" fill="#fecaca" opacity="0.7" />
        <path d="M12 3V1.4" stroke="#7f1d1d" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M12 1.4c1 0 1.8.5 2 1.3" stroke="#7f1d1d" strokeWidth="1.1" strokeLinecap="round" fill="none" />
        <circle cx="9.4" cy="21.3" r="1.5" fill="#3f3f46" />
        <circle cx="14.6" cy="21.3" r="1.5" fill="#3f3f46" />
        <circle cx="9.4" cy="21.3" r="0.5" fill="#71717a" />
        <circle cx="14.6" cy="21.3" r="0.5" fill="#71717a" />
      </g>
    </svg>
  );
}

function StickVacuumIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sv-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#67e8f9" />
          <stop offset="1" stopColor="#0891b2" />
        </linearGradient>
        <linearGradient id="sv-cup" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e0f2fe" />
          <stop offset="1" stopColor="#7dd3fc" />
        </linearGradient>
        <filter id="sv-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#sv-shadow)">
        <path d="M16 2 7 20" stroke="url(#sv-body)" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M16 2c1.1.2 1.8 1 1.6 2" stroke="#0e7490" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        <rect x="6.6" y="15.4" width="5.4" height="6.4" rx="2" transform="rotate(-25 9.3 18.6)" fill="url(#sv-cup)" stroke="#0369a1" strokeWidth="0.6" />
        <circle cx="8.6" cy="17.7" r="0.7" fill="#bae6fd" opacity="0.8" />
        <path d="M5.3 21.4 8 19.7" stroke="#155e75" strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function DishwasherIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="dw-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e2e8f0" />
          <stop offset="1" stopColor="#94a3b8" />
        </linearGradient>
        <linearGradient id="dw-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#64748b" />
          <stop offset="1" stopColor="#334155" />
        </linearGradient>
        <filter id="dw-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#dw-shadow)">
        <rect x="3" y="2.5" width="18" height="19" rx="2.2" fill="url(#dw-body)" stroke="#475569" strokeWidth="0.6" />
        <rect x="3" y="2.5" width="18" height="4.2" rx="2.2" fill="url(#dw-panel)" />
        <circle cx="6.4" cy="4.6" r="0.8" fill="#facc15" />
        <circle cx="9.4" cy="4.6" r="0.8" fill="#4ade80" />
        <rect x="12.2" y="3.9" width="6.8" height="1.4" rx="0.7" fill="#94a3b8" />
        <rect x="4.5" y="9" width="15" height="10.5" rx="1" fill="#cbd5e1" opacity="0.6" stroke="#94a3b8" strokeWidth="0.5" />
        <path d="M6.5 12h11M6.5 15h11M6.5 18h11" stroke="#64748b" strokeWidth="0.8" strokeLinecap="round" opacity="0.7" />
        <rect x="9.5" y="21" width="5" height="1.3" rx="0.6" fill="#475569" />
      </g>
    </svg>
  );
}

function UtensilsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* userSpaceOnUse, spanning the whole icon — this gradient is shared
            by the fork/knife/spoon shapes AND the spoon's handle, which is a
            perfectly vertical line (zero-width bbox on its own). An
            objectBoundingBox gradient is computed per-element, so it would
            paint the fork/knife fine but silently fail on just the spoon
            handle. Fixed coordinates sidestep that per-element degeneracy
            entirely, for every shape that references it. */}
        <linearGradient id="ut-metal" gradientUnits="userSpaceOnUse" x1="4" y1="2" x2="21" y2="22">
          <stop offset="0" stopColor="#f1f5f9" />
          <stop offset="1" stopColor="#94a3b8" />
        </linearGradient>
        <filter id="ut-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#ut-shadow)">
        {/* Fork */}
        <path d="M5.3 2v6.4c0 1.1.8 2 1.9 2.2V22" stroke="url(#ut-metal)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M4 2v4.2M5.3 2v4.2M6.6 2v4.2" stroke="url(#ut-metal)" strokeWidth="1.1" strokeLinecap="round" />
        {/* Knife */}
        <path d="M12 22V10.5c-1.6 0-2.2-1.3-2.2-3.2 0-2.6 1-4.8 2.2-5.3 1.2.5 2.2 2.7 2.2 5.3 0 1.9-.6 3.2-2.2 3.2Z" fill="url(#ut-metal)" stroke="#64748b" strokeWidth="0.5" />
        {/* Spoon */}
        <path d="M18.7 11.5V22" stroke="url(#ut-metal)" strokeWidth="1.5" strokeLinecap="round" />
        <ellipse cx="18.7" cy="4.3" rx="2.3" ry="3.3" fill="url(#ut-metal)" stroke="#64748b" strokeWidth="0.5" />
      </g>
    </svg>
  );
}

function MudIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="mud-blob" cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#a16207" />
          <stop offset="1" stopColor="#5b3a1e" />
        </radialGradient>
        <filter id="mud-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#mud-shadow)">
        <path d="M4.5 14c-.8-3 1.7-6 4.8-6 1-2 3.6-3 5.4-1.6 2.6-.7 5.6 1.4 5.3 4.3 2 1 2.4 4 .5 5.6-.3 2.2-2.6 3.7-4.8 3.2-1.4 1.6-4.2 1.7-5.7.2-2.6.9-5.6-.7-6.2-3.3-1.6-.3-2.6-1.9-2.3-3.5 1.1-1.7.6-3.6 1.6-3.6.5 0 1 .3 1.4.7Z" fill="url(#mud-blob)" />
        <ellipse cx="9.5" cy="9.5" rx="1.1" ry="0.7" fill="#c2924a" opacity="0.5" />
        <circle cx="17" cy="16" r="1" fill="#3f2a15" />
        <circle cx="7" cy="16.5" r="0.8" fill="#3f2a15" />
        <circle cx="20.5" cy="10.5" r="1.1" fill="#5b3a1e" />
      </g>
    </svg>
  );
}

function CardsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="cd-card" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#fef3c7" />
        </linearGradient>
        <filter id="cd-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.3" />
        </filter>
      </defs>
      <g filter="url(#cd-shadow)">
        <rect x="4.2" y="6" width="14" height="10" rx="1.3" fill="url(#cd-card)" stroke="#d6d3d1" strokeWidth="0.6" transform="rotate(-8 11.2 11)" />
        <rect x="5" y="5" width="14" height="10" rx="1.3" fill="url(#cd-card)" stroke="#d6d3d1" strokeWidth="0.6" transform="rotate(-2 12 10)" />
        <rect x="5.8" y="4.4" width="14" height="10" rx="1.3" fill="url(#cd-card)" stroke="#a8a29e" strokeWidth="0.6" />
        <path d="M8 8h8M8 10.5h8M8 13h5" stroke="#93c5fd" strokeWidth="0.7" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function NailClipperIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="nc-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e2e8f0" />
          <stop offset="1" stopColor="#94a3b8" />
        </linearGradient>
        <filter id="nc-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#nc-shadow)">
        {/* Housing (the barrel you hold) */}
        <rect x="9" y="3.5" width="6" height="8.5" rx="2.6" fill="url(#nc-metal)" stroke="#64748b" strokeWidth="0.6" />
        <path d="M9.4 7.7h5.2" stroke="#64748b" strokeWidth="0.5" opacity="0.7" />
        {/* Lever arm — the flat bar you press, lying diagonally across the
            housing and past the jaw, distinguishing it from a pair of
            scissors (which this previously read as with two long splayed
            legs instead). */}
        <path d="M14.6 4.3 10.4 15.2" stroke="url(#nc-metal)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="14.2" cy="5.2" r="0.9" fill="#94a3b8" stroke="#64748b" strokeWidth="0.4" />
        {/* Short, TIGHT pointed jaw — real clippers close to a small pinched
            point just below the housing, not a wide splayed "V". */}
        <path d="M9.6 12 12 15.4 14.4 12" fill="none" stroke="url(#nc-metal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="1" fill="#475569" />
      </g>
    </svg>
  );
}

function LawnMowerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="lm-deck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4ade80" />
          <stop offset="1" stopColor="#15803d" />
        </linearGradient>
        <linearGradient id="lm-handle" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#71717a" />
          <stop offset="1" stopColor="#3f3f46" />
        </linearGradient>
        <filter id="lm-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#lm-shadow)">
        <path d="M13 13V8l6.5-4.3" stroke="url(#lm-handle)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        <path d="M8.5 13.2h7.2a3 3 0 0 1 3 3v1.3H8.5Z" fill="url(#lm-deck)" stroke="#166534" strokeWidth="0.6" />
        <circle cx="6.3" cy="18.3" r="2.6" fill="#27272a" />
        <circle cx="6.3" cy="18.3" r="0.9" fill="#a1a1aa" />
        <circle cx="16.8" cy="18.3" r="2.6" fill="#27272a" />
        <circle cx="16.8" cy="18.3" r="0.9" fill="#a1a1aa" />
        <path d="M6.3 18.3h10.5" stroke="#3f3f46" strokeWidth="1.2" />
      </g>
    </svg>
  );
}

function DandelionIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="dl-puff" cx="45%" cy="40%" r="60%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d4d4d8" />
        </radialGradient>
        {/* userSpaceOnUse with explicit coords, not objectBoundingBox — the
            stem below is a perfectly VERTICAL line, whose bounding box has
            zero width. An objectBoundingBox gradient transform divides by
            that width, so it silently fails to paint the stroke at all in
            every browser. Same fix applied to every other handle/stem below
            drawn as an axis-aligned line (mop, duster, squeegee). */}
        <linearGradient id="dl-stem" gradientUnits="userSpaceOnUse" x1="11" y1="12" x2="11" y2="22">
          <stop offset="0" stopColor="#4ade80" />
          <stop offset="1" stopColor="#15803d" />
        </linearGradient>
        <filter id="dl-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.2" />
        </filter>
      </defs>
      <g filter="url(#dl-shadow)">
        <path d="M11 12v10" stroke="url(#dl-stem)" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M11 17c-1.5.5-2.5 1.7-2.7 3" stroke="#166534" strokeWidth="1" strokeLinecap="round" fill="none" />
        <circle cx="10.5" cy="8" r="4.6" fill="url(#dl-puff)" />
        {Array.from({ length: 10 }).map((_, i) => {
          const a = (i / 10) * Math.PI * 2;
          const x2 = 10.5 + Math.cos(a) * 5.3, y2 = 8 + Math.sin(a) * 5.3;
          return <line key={i} x1={10.5 + Math.cos(a) * 3.4} y1={8 + Math.sin(a) * 3.4} x2={x2} y2={y2} stroke="#a1a1aa" strokeWidth="0.5" strokeLinecap="round" />;
        })}
        {/* Seeds blowing away */}
        <circle cx="18.5" cy="4" r="0.6" fill="#e4e4e7" />
        <circle cx="20.5" cy="6.3" r="0.5" fill="#e4e4e7" />
        <circle cx="21.5" cy="3" r="0.45" fill="#e4e4e7" />
        <path d="M15.5 6.5 18 4.3M16.5 8.7 19.8 6.6M14.5 4 20.7 3" stroke="#d4d4d8" strokeWidth="0.35" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function ShovelIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sh-handle" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#d6a15d" />
          <stop offset="1" stopColor="#92592a" />
        </linearGradient>
        <linearGradient id="sh-blade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cbd5e1" />
          <stop offset="1" stopColor="#64748b" />
        </linearGradient>
        <filter id="sh-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#sh-shadow)">
        <ellipse cx="6" cy="3.4" rx="2.6" ry="1.8" fill="none" stroke="url(#sh-handle)" strokeWidth="1.4" />
        <path d="M6.7 4.8 15 14" stroke="url(#sh-handle)" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M14 12.5c2.2 0 4 .9 5 2.6-1 3.4-3.4 6-6.6 6.6-2.6-.7-4.4-3-4.7-5.6.9-2.2 3.4-3.6 6.3-3.6Z" fill="url(#sh-blade)" stroke="#475569" strokeWidth="0.6" />
        <path d="M11 15.2c1.6-.8 3.6-.8 5.2.2" stroke="#94a3b8" strokeWidth="0.6" fill="none" opacity="0.7" />
      </g>
    </svg>
  );
}

function CleanDishesIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="cln-plate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e2e8f0" />
        </linearGradient>
        <filter id="cln-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#cln-shadow)">
        <ellipse cx="12" cy="19" rx="8.5" ry="2" fill="url(#cln-plate)" stroke="#cbd5e1" strokeWidth="0.5" />
        <ellipse cx="12" cy="15.5" rx="8" ry="1.9" fill="url(#cln-plate)" stroke="#cbd5e1" strokeWidth="0.5" />
        <ellipse cx="12" cy="12.2" rx="7.5" ry="1.8" fill="url(#cln-plate)" stroke="#cbd5e1" strokeWidth="0.5" />
        <ellipse cx="12" cy="9" rx="7" ry="1.9" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.6" />
        <ellipse cx="12" cy="9" rx="4" ry="1" fill="#f1f5f9" />
        <path d="M17 4.5 18.6 6.1M19.4 3.8 20.4 4.8M15.8 5.8 16.8 6.8" stroke="#fde047" strokeWidth="0.8" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function DirtyDishesIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="dty-plate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f5f5f4" />
          <stop offset="1" stopColor="#d6d3d1" />
        </linearGradient>
        <filter id="dty-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#dty-shadow)">
        <ellipse cx="12.5" cy="19.3" rx="8" ry="1.9" fill="url(#dty-plate)" stroke="#a8a29e" strokeWidth="0.5" transform="rotate(3 12.5 19.3)" />
        <ellipse cx="11" cy="15.8" rx="7.6" ry="1.9" fill="url(#dty-plate)" stroke="#a8a29e" strokeWidth="0.5" transform="rotate(-6 11 15.8)" />
        <ellipse cx="12.7" cy="12" rx="6.8" ry="1.8" fill="#e7e5e4" stroke="#a8a29e" strokeWidth="0.6" transform="rotate(5 12.7 12)" />
        <ellipse cx="10.5" cy="12.4" rx="1.6" ry="0.9" fill="#78716c" opacity="0.6" />
        <ellipse cx="14.2" cy="11.6" rx="1" ry="0.6" fill="#a16207" opacity="0.55" />
        <path d="M6.5 8 8.6 11" stroke="#78716c" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M4.8 6.8 6.5 6.2" stroke="#78716c" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="18" cy="5.5" r="0.5" fill="#78716c" opacity="0.6" />
        <circle cx="19.3" cy="7.2" r="0.35" fill="#78716c" opacity="0.5" />
      </g>
    </svg>
  );
}

function MopIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* userSpaceOnUse — the handle below is a perfectly vertical line
            (zero-width bounding box), which makes an objectBoundingBox
            gradient degenerate and silently unpaintable. See DandelionIcon
            above for the full explanation. */}
        <linearGradient id="mp-handle" gradientUnits="userSpaceOnUse" x1="12" y1="2" x2="12" y2="13.5">
          <stop offset="0" stopColor="#d6a15d" />
          <stop offset="1" stopColor="#92592a" />
        </linearGradient>
        <linearGradient id="mp-head" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#93c5fd" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <filter id="mp-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#mp-shadow)">
        <path d="M12 2v11.5" stroke="url(#mp-handle)" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M8.3 22c-1-3.2-1-6.5.2-8.7 1.1-1.5 4.2-1.5 5.4 0 1.2 2.2 1.2 5.5.2 8.7Z" fill="url(#mp-head)" stroke="#1e40af" strokeWidth="0.5" />
        <path d="M8 13.6c1.7.9 6.3.9 8 0M8.6 16.5c1.6.7 5.2.7 6.8 0M9.1 19.3c1.3.5 4.5.5 5.8 0" stroke="#bfdbfe" strokeWidth="0.6" strokeLinecap="round" opacity="0.8" />
      </g>
    </svg>
  );
}

function DusterIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* userSpaceOnUse — see DandelionIcon above: a vertical-line stroke
            with an objectBoundingBox gradient has a zero-width bbox and
            silently fails to paint. */}
        <linearGradient id="dst-handle" gradientUnits="userSpaceOnUse" x1="11.5" y1="22" x2="11.5" y2="12">
          <stop offset="0" stopColor="#d6a15d" />
          <stop offset="1" stopColor="#92592a" />
        </linearGradient>
        <radialGradient id="dst-fluff" cx="45%" cy="35%" r="65%">
          <stop offset="0" stopColor="#fbcfe8" />
          <stop offset="1" stopColor="#ec4899" />
        </radialGradient>
        <filter id="dst-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.22" />
        </filter>
      </defs>
      <g filter="url(#dst-shadow)">
        <path d="M11.5 22V12" stroke="url(#dst-handle)" strokeWidth="1.6" strokeLinecap="round" />
        <ellipse cx="11.5" cy="7.5" rx="5.3" ry="5.6" fill="url(#dst-fluff)" />
        <path d="M5.6 5c-.6 1.6-.6 3.1 0 4.6M8 3c-.5 2-.5 4.2 0 6.2M11.5 2.3c-.4 2.3-.4 4.9 0 7.2M15 3c.5 2 .5 4.2 0 6.2M17.4 5c.6 1.6.6 3.1 0 4.6" stroke="#f9a8d4" strokeWidth="0.8" strokeLinecap="round" opacity="0.8" />
        <circle cx="9.5" cy="6" r="0.9" fill="#fff" opacity="0.5" />
      </g>
    </svg>
  );
}

function SqueegeeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sq-blade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
        {/* userSpaceOnUse — see DandelionIcon above: a vertical-line stroke
            with an objectBoundingBox gradient has a zero-width bbox and
            silently fails to paint. */}
        <linearGradient id="sq-handle" gradientUnits="userSpaceOnUse" x1="12" y1="8.6" x2="12" y2="22">
          <stop offset="0" stopColor="#a1a1aa" />
          <stop offset="1" stopColor="#52525b" />
        </linearGradient>
        <filter id="sq-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#sq-shadow)">
        <path d="M12 8.6V22" stroke="url(#sq-handle)" strokeWidth="1.7" strokeLinecap="round" />
        <rect x="3.6" y="3.5" width="16.8" height="5.2" rx="2" fill="url(#sq-blade)" stroke="#115e59" strokeWidth="0.6" />
        <rect x="4.6" y="4.4" width="14.8" height="1.3" rx="0.6" fill="#ccfbf1" opacity="0.7" />
      </g>
    </svg>
  );
}

function GardenShearsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gs-blade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e2e8f0" />
          <stop offset="1" stopColor="#94a3b8" />
        </linearGradient>
        <linearGradient id="gs-handle" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fb923c" />
          <stop offset="1" stopColor="#c2410c" />
        </linearGradient>
        <filter id="gs-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.5" stdDeviation="0.6" floodOpacity="0.25" />
        </filter>
      </defs>
      <g filter="url(#gs-shadow)">
        <path d="M12 12 5 4.5c-1.4-.4-2.6.6-2.4 2L12 12Z" fill="url(#gs-blade)" stroke="#64748b" strokeWidth="0.5" />
        <path d="M12 12 5 19.5c-1.4.4-2.6-.6-2.4-2L12 12Z" fill="url(#gs-blade)" stroke="#64748b" strokeWidth="0.5" />
        <circle cx="12" cy="12" r="1.5" fill="#475569" />
        <path d="M12 12 20 8.3c1.3.7 1.7 2.2 1 3.4L12 12Z" fill="url(#gs-handle)" stroke="#9a3412" strokeWidth="0.5" />
        <path d="M12 12 20 15.7c1.3-.7 1.7-2.2 1-3.4L12 12Z" fill="url(#gs-handle)" stroke="#9a3412" strokeWidth="0.5" />
      </g>
    </svg>
  );
}

export const CUSTOM_CHORE_ICONS: { key: string; label: string; Icon: (p: IconProps) => ReactElement }[] = [
  { key: "vacuum", label: "Big Vacuum", Icon: BigVacuumIcon },
  { key: "stickvacuum", label: "Stick Vacuum", Icon: StickVacuumIcon },
  { key: "dishwasher", label: "Dishwasher", Icon: DishwasherIcon },
  { key: "utensils", label: "Fork, Spoon & Knife", Icon: UtensilsIcon },
  { key: "mud", label: "Mud", Icon: MudIcon },
  { key: "cards", label: "Index Cards", Icon: CardsIcon },
  { key: "nailclipper", label: "Nail Clipper", Icon: NailClipperIcon },
  { key: "lawnmower", label: "Lawn Mower", Icon: LawnMowerIcon },
  { key: "weed", label: "Weed", Icon: DandelionIcon },
  { key: "shovel", label: "Shovel", Icon: ShovelIcon },
  { key: "cleandishes", label: "Clean Dishes", Icon: CleanDishesIcon },
  { key: "dirtydishes", label: "Dirty Dishes", Icon: DirtyDishesIcon },
  { key: "mop", label: "Mop", Icon: MopIcon },
  { key: "duster", label: "Duster", Icon: DusterIcon },
  { key: "squeegee", label: "Squeegee", Icon: SqueegeeIcon },
  { key: "shears", label: "Garden Shears", Icon: GardenShearsIcon },
];

const CUSTOM_ICON_PREFIX = "custom:";

export function isCustomChoreIcon(icon: string | null | undefined): boolean {
  return !!icon && icon.startsWith(CUSTOM_ICON_PREFIX);
}

export function customChoreIconKey(icon: string): string {
  return icon.slice(CUSTOM_ICON_PREFIX.length);
}

export function makeCustomChoreIcon(key: string): string {
  return `${CUSTOM_ICON_PREFIX}${key}`;
}

/**
 * The one place that knows how to render a chore's `icon` field regardless
 * of whether it's a plain emoji character or a `"custom:<key>"` reference —
 * every render site should use this instead of dropping `chore.icon`
 * straight into JSX, so a custom icon looks right wherever a chore's emoji
 * would otherwise show up.
 */
export function ChoreIcon({ icon, className = "w-5 h-5" }: { icon: string | null | undefined; className?: string }) {
  if (!icon) return null;
  if (isCustomChoreIcon(icon)) {
    const key = customChoreIconKey(icon);
    const match = CUSTOM_CHORE_ICONS.find((c) => c.key === key);
    if (!match) return null;
    return <match.Icon className={className} />;
  }
  // A plain inline <span> ignores the w-/h- sizing classes and lets the emoji
  // glyph sit on the text baseline, so it renders low relative to the adjacent
  // checkbox/title (and in the bottom of the Fun Mode bubble). inline-flex makes
  // the box honor its size and center the glyph both ways; leading-none removes
  // the extra line-box height that otherwise pushes it down.
  return (
    <span className={`inline-flex items-center justify-center leading-none ${className}`}>{icon}</span>
  );
}
