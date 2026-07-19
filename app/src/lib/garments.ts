import type { GarmentType } from "@/types";

/** 服装中文名映射 */
export const GARMENT_LABELS: Record<GarmentType, string> = {
  tshirt: "T恤",
  shirt: "衬衫",
  hoodie: "卫衣",
  sweater: "毛衣",
  jacket: "夹克",
  coat: "大衣",
  dress: "连衣裙",
  skirt: "半身裙",
  pants: "裤子",
  shorts: "短裤",
  tanktop: "背心",
  other: "服装",
};

/** 区域映射 */
export const REGION_MAP: Record<GarmentType, "upper" | "lower" | "full"> = {
  tshirt: "upper",
  shirt: "upper",
  hoodie: "upper",
  sweater: "upper",
  jacket: "upper",
  coat: "full",
  dress: "full",
  skirt: "lower",
  pants: "lower",
  shorts: "lower",
  tanktop: "upper",
  other: "upper",
};

/** 颜色调亮 / 调暗 */
function shade(hex: string, percent: number): string {
  const h = hex.replace("#", "");
  const num = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent);
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** 各服装类型的 SVG 内部图形（front view，透明背景） */
function garmentShape(type: GarmentType): string {
  switch (type) {
    case "tshirt":
      return `
        <polygon points="62,66 22,96 42,124 64,102" />
        <polygon points="138,66 178,96 158,124 136,102" />
        <path d="M62,66 C66,60 78,58 100,58 C122,58 134,60 138,66 L144,210 L56,210 Z" />
        <path d="M80,58 Q100,78 120,58" fill="none" stroke-width="4" />`;
    case "tanktop":
      return `
        <path d="M70,64 L40,78 L58,104 L70,92" />
        <path d="M130,64 L160,78 L142,104 L130,92" />
        <path d="M70,64 C78,58 88,62 100,62 C112,62 122,58 130,64 L140,210 L60,210 Z" />
        <path d="M82,60 Q100,74 118,60" fill="none" stroke-width="3" />`;
    case "shirt":
      return `
        <polygon points="60,66 20,98 42,126 64,102" />
        <polygon points="140,66 180,98 158,126 136,102" />
        <path d="M60,66 L140,66 L146,212 L54,212 Z" />
        <path d="M100,58 L100,212" fill="none" stroke-width="2.5" />
        <path d="M78,58 L100,74 L122,58" fill="none" stroke-width="3.5" />
        <circle cx="100" cy="110" r="2.5" />
        <circle cx="100" cy="140" r="2.5" />
        <circle cx="100" cy="170" r="2.5" />`;
    case "hoodie":
      return `
        <polygon points="60,70 18,100 40,130 64,106" />
        <polygon points="140,70 182,100 160,130 136,106" />
        <path d="M64,70 L136,70 L142,214 L58,214 Z" />
        <path d="M78,62 Q100,84 122,62 Q100,96 78,62 Z" fill="none" stroke-width="3" />
        <path d="M88,72 L112,72 L112,96 L88,96 Z" fill="none" stroke-width="2.5" />
        <path d="M58,120 L142,120" fill="none" stroke-width="3" />`;
    case "sweater":
      return `
        <polygon points="60,66 16,98 40,132 64,104" />
        <polygon points="140,66 184,98 160,132 136,104" />
        <path d="M60,66 L140,66 L146,214 L54,214 Z" />
        <path d="M82,58 Q100,76 118,58" fill="none" stroke-width="4" />
        <path d="M60,120 L140,120" fill="none" stroke-width="2.5" />
        <path d="M64,150 L136,150" fill="none" stroke-width="2.5" />`;
    case "jacket":
      return `
        <polygon points="58,66 16,100 40,128 62,102" />
        <polygon points="142,66 184,100 160,128 138,102" />
        <path d="M58,66 L142,66 L148,216 L52,216 Z" />
        <path d="M100,58 L100,216" fill="none" stroke-width="2.5" />
        <path d="M78,58 L100,74 L122,58" fill="none" stroke-width="3.5" />
        <path d="M58,110 L142,110" fill="none" stroke-width="2.5" />
        <rect x="92" y="120" width="6" height="6" />
        <rect x="102" y="120" width="6" height="6" />
        <rect x="92" y="150" width="6" height="6" />
        <rect x="102" y="150" width="6" height="6" />`;
    case "coat":
      return `
        <polygon points="56,64 10,102 36,134 60,104" />
        <polygon points="144,64 190,102 164,134 140,104" />
        <path d="M56,64 L144,64 L154,244 L46,244 Z" />
        <path d="M100,56 L100,244" fill="none" stroke-width="2.5" />
        <path d="M76,56 L100,76 L124,56" fill="none" stroke-width="3.5" />
        <path d="M56,118 L144,118" fill="none" stroke-width="2.5" />
        <rect x="90" y="130" width="6" height="6" />
        <rect x="104" y="130" width="6" height="6" />
        <rect x="90" y="165" width="6" height="6" />
        <rect x="104" y="165" width="6" height="6" />
        <rect x="90" y="200" width="6" height="6" />
        <rect x="104" y="200" width="6" height="6" />`;
    case "dress":
      return `
        <polygon points="64,66 26,96 46,122 66,100" />
        <polygon points="136,66 174,96 154,122 134,100" />
        <path d="M64,66 L136,66 L150,110 L162,236 L38,236 L50,110 Z" />
        <path d="M82,58 Q100,76 118,58" fill="none" stroke-width="4" />
        <path d="M62,140 L138,140" fill="none" stroke-width="2.5" />`;
    case "skirt":
      return `
        <path d="M66,90 L134,90 L168,210 L32,210 Z" />
        <path d="M66,90 L134,90 L136,104 L64,104 Z" fill="none" stroke-width="3" />
        <path d="M60,140 L140,140" fill="none" stroke-width="2" />`;
    case "pants":
      return `
        <path d="M64,60 L136,60 L138,80 L120,80 L116,236 L100,236 L100,104 L100,236 L84,236 L80,80 L62,80 Z" />
        <path d="M64,60 L136,60 L140,104 L60,104 Z" />
        <path d="M100,104 L100,236" fill="none" stroke-width="2.5" />`;
    case "shorts":
      return `
        <path d="M64,70 L136,70 L138,90 L120,90 L116,160 L100,160 L100,114 L100,160 L84,160 L80,90 L62,90 Z" />
        <path d="M64,70 L136,70 L140,114 L60,114 Z" />
        <path d="M100,114 L100,160" fill="none" stroke-width="2.5" />`;
    case "other":
    default:
      return `
        <polygon points="62,66 22,96 42,124 64,102" />
        <polygon points="138,66 178,96 158,124 136,102" />
        <path d="M62,66 C66,60 78,58 100,58 C122,58 134,60 138,66 L144,210 L56,210 Z" />`;
  }
}

/** 生成服装 SVG（字符串） */
export function garmentSvg(type: GarmentType, color: string): string {
  const base = color || "#7c3aed";
  const light = shade(base, 0.18);
  const dark = shade(base, -0.32);
  const shape = garmentShape(type);
  const gid = `g-${type}-${base.replace("#", "")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260">
  <defs>
    <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${light}"/>
      <stop offset="1" stop-color="${base}"/>
    </linearGradient>
  </defs>
  <g fill="url(#${gid})" stroke="${dark}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    ${shape}
  </g>
</svg>`;
}

/** 将服装 SVG 转为可直接用于 <img> 的 data URL */
export function garmentDataUrl(type: GarmentType, color: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(garmentSvg(type, color))}`;
}

/** 常见服装色板（HEX） */
export const COLOR_PALETTE = [
  "#7c3aed", // 紫
  "#2563eb", // 蓝
  "#0ea5e9", // 天蓝
  "#10b981", // 绿
  "#f59e0b", // 橙
  "#ef4444", // 红
  "#ec4899", // 粉
  "#111827", // 黑
  "#f3f4f6", // 白
  "#a16207", // 棕
  "#64748b", // 灰
  "#84cc16", // 黄绿
];
