// The setup chat's pictures, drawn as SVG so they stay crisp, cost nothing to
// load and work offline in the native bundle. Colors are SuperHub's own
// profile and theme colors.
import type { ReactNode } from "react";
import type { Art, IconName } from "@/lib/setupChat/script";

export const COLORS = {
  blue: "#5E8FAD",
  blueDark: "#46708A",
  blueSoft: "#E7F1F6",
  coral: "#E07B6A",
  coralDark: "#C26050",
  green: "#6DB98A",
  purple: "#A67BB9",
  gold: "#D4A843",
  goldDark: "#A87C24",
  goldLight: "#F4CE70",
  bronze: "#C48456",
  bronzeDark: "#8C5632",
  bronzeLight: "#E4AE82",
  sky: "hsl(203 45% 92%)",
  sage: "hsl(140 24% 90%)",
  sageDark: "hsl(140 20% 80%)",
  peach: "hsl(22 70% 92%)",
  lavender: "hsl(270 40% 94%)",
  butter: "hsl(45 75% 90%)",
  skinA: "hsl(28 48% 74%)",
  skinB: "hsl(24 38% 52%)",
  skinC: "hsl(30 55% 82%)",
  skinD: "hsl(22 34% 40%)",
  ink: "hsl(30 9% 15%)",
  muted: "hsl(30 5% 40%)",
  google: "#4285F4",
  outlook: "#0072C6",
  ical: "#EA5448",
};

export const ROUNDED_FONT = "ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, system-ui, sans-serif";

const HEART = "M0 7C-6 3-10 0-10-4c0-3.3 2.5-5.5 5-5.5 2.2 0 4 1.2 5 3 1-1.8 2.8-3 5-3 2.5 0 5 2.2 5 5.5 0 4-4 7-10 11z";

function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((-90 + i * 36) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}

function sparkle(x: number, y: number, s: number): string {
  return `M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`;
}

// ── Icons ───────────────────────────────────────────────────────────────────

const ICONS: Record<IconName | "chevron" | "cloud" | "copy" | "send", ReactNode> = {
  camera: (
    <>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
      <circle cx={12} cy={13} r={3} />
    </>
  ),
  image: (
    <>
      <rect x={3} y={3} width={18} height={18} rx={2} />
      <circle cx={9} cy={9} r={2} />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </>
  ),
  lock: (
    <>
      <rect x={3} y={11} width={18} height={11} rx={2} />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0" />
      <circle cx={12} cy={10} r={3} />
    </>
  ),
  calendar: (
    <>
      <rect x={3} y={4} width={18} height={18} rx={2} />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  star: <path d="M12 2.5l2.9 5.9 6.6 1-4.8 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.8-4.6 6.6-1z" />,
  mail: (
    <>
      <rect x={2} y={4} width={20} height={16} rx={2} />
      <path d="m22 7-9 5.7a2 2 0 0 1-2 0L2 7" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  cloud: <path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z" />,
  copy: (
    <>
      <rect x={8} y={8} width={14} height={14} rx={2} />
      <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  ),
  pencil: <path d="M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8L2 21.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z" />,
  plus: <path d="M5 12h14M12 5v14" />,
  send: <path d="m5 12 7-7 7 7M12 19V5" />,
  play: <path d="M7 4.5v15l12-7.5z" />,
  device: (
    <>
      <rect x={4} y={2} width={16} height={20} rx={2} />
      <path d="M12 18h.01" />
    </>
  ),
};

export function Icon({ name, size = 16, className }: { name: keyof typeof ICONS; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: "block", flexShrink: 0, width: size, height: size }}
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

export function IconTile({ name }: { name: IconName }) {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#E7F1F6] text-[#5E8FAD]">
      <Icon name={name} size={17} />
    </span>
  );
}

export function BotAvatar({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", flexShrink: 0 }} aria-hidden="true">
      <rect width={24} height={24} rx={7} fill={COLORS.blue} />
      <rect x={14.6} y={5.4} width={2.2} height={4} rx={0.4} fill="#fff" />
      <path d="M12 4.8 19.4 11h-1.6v7.6a.6.6 0 0 1-.6.6H6.8a.6.6 0 0 1-.6-.6V11H4.6z" fill="#fff" />
      <path d={HEART} transform="translate(12 14.6) scale(0.27)" fill={COLORS.blue} />
    </svg>
  );
}

// ── Picture cards ───────────────────────────────────────────────────────────

const ART_H = 104;

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 300 ${ART_H}`} width="100%" height={ART_H} role="img" aria-label={label} style={{ display: "block" }}>
      {children}
    </svg>
  );
}

function Figure({ x, ground, shirt, skin, kid }: { x: number; ground: number; shirt: string; skin: string; kid?: boolean }) {
  const bodyW = kid ? 15 : 19;
  const bodyH = kid ? 17 : 24;
  const headR = kid ? 6.5 : 8;
  return (
    <g>
      <rect x={x - bodyW / 2} y={ground - bodyH} width={bodyW} height={bodyH + 4} rx={bodyW / 2} fill={shirt} />
      <circle cx={x} cy={ground - bodyH - headR + 1} r={headR} fill={skin} />
    </g>
  );
}

function Cloud({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g fill="#fff" transform={`translate(${x} ${y}) scale(${s})`}>
      <circle cx={-12} cy={4} r={8} />
      <circle cx={0} cy={0} r={11} />
      <circle cx={13} cy={5} r={7} />
      <rect x={-18} y={3} width={37} height={9} rx={4.5} />
    </g>
  );
}

function HomeArt() {
  return (
    <Frame label="A house with a family standing in front of it">
      <circle cx={248} cy={26} r={13} fill={COLORS.gold} />
      <Cloud x={74} y={26} />
      <ellipse cx={150} cy={99} rx={140} ry={8} fill={COLORS.sageDark} />
      <rect x={170} y={24} width={11} height={22} rx={2} fill={COLORS.blueDark} />
      <rect x={112} y={52} width={76} height={46} rx={4} fill={COLORS.blue} />
      <path d="M100 58 150 20 200 58z" fill={COLORS.blueDark} />
      <path d={HEART} transform="translate(150 77) scale(1.1)" fill="#fff" />
      <Figure x={62} ground={99} shirt={COLORS.coral} skin={COLORS.skinA} />
      <Figure x={86} ground={99} shirt={COLORS.green} skin={COLORS.skinC} kid />
      <Figure x={214} ground={99} shirt={COLORS.purple} skin={COLORS.skinB} kid />
      <Figure x={238} ground={99} shirt={COLORS.gold} skin={COLORS.skinD} />
    </Frame>
  );
}

function MapArt() {
  const road = "M-4 88C60 84 96 38 150 48S238 92 304 40";
  return (
    <Frame label="A map with a pin on it">
      <g fill="#fff" opacity={0.75}>
        <rect x={22} y={12} width={66} height={34} rx={8} />
        <rect x={22} y={56} width={42} height={36} rx={8} />
        <rect x={210} y={60} width={72} height={34} rx={8} />
        <rect x={104} y={72} width={64} height={24} rx={8} />
      </g>
      <path d={road} fill="none" stroke="#fff" strokeWidth={10} strokeLinecap="round" />
      <path d={road} fill="none" stroke={COLORS.sageDark} strokeWidth={2} strokeDasharray="6 7" strokeLinecap="round" />
      <path d="M150 54C141 43 136 37 136 30A14 14 0 0 1 164 30C164 37 159 43 150 54Z" fill={COLORS.coral} />
      <circle cx={150} cy={30} r={5} fill="#fff" />
      <circle cx={250} cy={22} r={12} fill={COLORS.gold} />
      <Cloud x={250} y={30} s={0.8} />
    </Frame>
  );
}

function CalendarArt() {
  const tiles = [
    { x: 30, label: "Google", head: COLORS.google, day: "12" },
    { x: 115, label: "Outlook", head: COLORS.outlook, day: "18" },
    { x: 200, label: "iCal link", head: COLORS.ical, day: "24" },
  ];
  return (
    <Frame label="Google, Outlook and iCal calendar pages">
      {tiles.map((tile) => (
        <g key={tile.label}>
          <rect x={tile.x} y={10} width={70} height={64} rx={12} fill="#fff" />
          <path d={`M${tile.x} 22a12 12 0 0 1 12-12h46a12 12 0 0 1 12 12v6h-70z`} fill={tile.head} />
          <text x={tile.x + 35} y={62} textAnchor="middle" fontSize={24} fontWeight={700} fill={COLORS.ink} fontFamily={ROUNDED_FONT}>
            {tile.day}
          </text>
          <text x={tile.x + 35} y={94} textAnchor="middle" fontSize={12} fontWeight={600} fill={COLORS.muted}>
            {tile.label}
          </text>
        </g>
      ))}
    </Frame>
  );
}

function TrophyArt() {
  return (
    <Frame label="A star trophy between a coin and a gift">
      <circle cx={76} cy={56} r={28} fill={COLORS.bronze} />
      <circle cx={76} cy={56} r={21} fill="none" stroke={COLORS.bronzeLight} strokeWidth={3} />
      <text x={76} y={66} textAnchor="middle" fontSize={28} fontWeight={800} fill={COLORS.bronzeDark} fontFamily={ROUNDED_FONT}>
        $
      </text>
      <rect x={128} y={88} width={44} height={11} rx={4} fill={COLORS.goldDark} />
      <rect x={143} y={72} width={14} height={18} fill={COLORS.gold} />
      <polygon points={starPoints(150, 42, 33, 14.5)} fill={COLORS.goldLight} stroke={COLORS.gold} strokeWidth={3} strokeLinejoin="round" />
      <path d={sparkle(194, 16, 6)} fill={COLORS.gold} />
      <path d={sparkle(108, 20, 4)} fill={COLORS.gold} />
      <rect x={204} y={50} width={58} height={44} rx={6} fill={COLORS.coral} />
      <rect x={200} y={40} width={66} height={15} rx={5} fill={COLORS.coralDark} />
      <rect x={229} y={40} width={8} height={54} fill={COLORS.goldLight} />
      <ellipse cx={224} cy={36} rx={10} ry={6} fill={COLORS.goldLight} transform="rotate(-20 224 36)" />
      <ellipse cx={242} cy={36} rx={10} ry={6} fill={COLORS.goldLight} transform="rotate(20 242 36)" />
    </Frame>
  );
}

function EnvelopeArt() {
  return (
    <Frame label="An invitation travelling between two phones">
      {[34, 226].map((x) => (
        <g key={x}>
          <rect x={x} y={16} width={40} height={72} rx={9} fill={COLORS.blueDark} />
          <rect x={x + 4} y={23} width={32} height={56} rx={5} fill="#fff" />
          <rect x={x + 9} y={36} width={22} height={5} rx={2.5} fill={COLORS.blueSoft} />
          <rect x={x + 9} y={46} width={16} height={5} rx={2.5} fill={COLORS.blueSoft} />
        </g>
      ))}
      <path d="M80 56C92 36 98 34 104 42" fill="none" stroke={COLORS.blue} strokeWidth={2} strokeDasharray="4 5" strokeLinecap="round" />
      <path d="M196 42C202 34 208 36 220 56" fill="none" stroke={COLORS.blue} strokeWidth={2} strokeDasharray="4 5" strokeLinecap="round" />
      <rect x={106} y={24} width={88} height={58} rx={8} fill="#fff" />
      <path d="M110 30 150 60 190 30" fill="none" stroke={COLORS.blue} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <path d={HEART} transform="translate(150 64) scale(0.85)" fill={COLORS.coral} />
    </Frame>
  );
}

function DoneArt() {
  const confetti: [number, number, string, number][] = [
    [40, 22, COLORS.coral, 20], [66, 66, COLORS.gold, -30], [92, 14, COLORS.blue, 45], [100, 82, COLORS.purple, 10],
    [206, 18, COLORS.green, -20], [222, 76, COLORS.coral, 35], [250, 36, COLORS.blue, -45], [270, 84, COLORS.gold, 15],
    [124, 8, COLORS.gold, 60], [178, 92, COLORS.green, -60], [30, 78, COLORS.purple, -15], [262, 10, COLORS.purple, 30],
  ];
  return (
    <Frame label="A big check mark with confetti">
      {confetti.map(([x, y, fill, turn]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={10} height={5} rx={1.5} fill={fill} transform={`rotate(${turn} ${x + 5} ${y + 2.5})`} />
      ))}
      <circle cx={150} cy={52} r={32} fill={COLORS.green} />
      <path d="M135 53 146 64 166 42" fill="none" stroke="#fff" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

export const ART: Record<Art, () => ReactNode> = {
  home: HomeArt,
  map: MapArt,
  calendar: CalendarArt,
  trophy: TrophyArt,
  envelope: EnvelopeArt,
  done: DoneArt,
};

// ── Small pictures for answers ──────────────────────────────────────────────

export function RoleArt({ kid, size = 58 }: { kid?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx={32} cy={32} r={30} fill={kid ? COLORS.sage : COLORS.peach} />
      {kid ? (
        <>
          <path d="M20 56c1-9 5-13 12-13s11 4 12 13z" fill={COLORS.green} />
          <circle cx={32} cy={33} r={7.5} fill={COLORS.skinC} />
        </>
      ) : (
        <>
          <path d="M15 56c1-11 7-17 17-17s16 6 17 17z" fill={COLORS.coral} />
          <circle cx={32} cy={26} r={9.5} fill={COLORS.skinA} />
        </>
      )}
    </svg>
  );
}

export function GiftMini({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x={6} y={15} width={28} height={21} rx={4} fill={COLORS.coral} />
      <rect x={4} y={10} width={32} height={8} rx={3} fill={COLORS.coralDark} />
      <rect x={17} y={10} width={6} height={26} fill={COLORS.goldLight} />
      <ellipse cx={15} cy={8} rx={5.5} ry={3.5} fill={COLORS.goldLight} transform="rotate(-20 15 8)" />
      <ellipse cx={25} cy={8} rx={5.5} ry={3.5} fill={COLORS.goldLight} transform="rotate(20 25 8)" />
    </svg>
  );
}

export function CoinMini({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx={20} cy={20} r={17} fill={COLORS.bronze} />
      <circle cx={20} cy={20} r={12.5} fill="none" stroke={COLORS.bronzeLight} strokeWidth={2} />
      <text x={20} y={26.5} textAnchor="middle" fontSize={17} fontWeight={800} fill={COLORS.bronzeDark} fontFamily={ROUNDED_FONT}>
        $
      </text>
    </svg>
  );
}

export function BothMini() {
  return (
    <span className="relative block h-[34px] w-[34px] shrink-0" aria-hidden="true">
      <span className="absolute -left-0.5 top-1.5">
        <CoinMini size={24} />
      </span>
      <span className="absolute left-3 top-0.5">
        <GiftMini size={24} />
      </span>
    </span>
  );
}
