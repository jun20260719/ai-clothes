/** 试衣覆盖区域选项（前端选择 UI 用） */
export const REGION_OPTIONS: { value: "upper" | "lower" | "full"; label: string }[] = [
  { value: "upper", label: "上半身" },
  { value: "lower", label: "下半身" },
  { value: "full", label: "全身" },
];

/** 区域中文名 */
export const REGION_LABELS: Record<"upper" | "lower" | "full", string> = {
  upper: "上半身",
  lower: "下半身",
  full: "全身",
};

/**
 * 生成服装占位 SVG（仅用于本地 Canvas 预览，不绑定具体款式/颜色）。
 * 商品原图才是真实试衣来源，这里只是无商品图时的兜底视觉。
 */
function garmentSvg(region: "upper" | "lower" | "full"): string {
  const base = "#7c3aed";
  const light = "#a78bfa";
  const dark = "#5b21b6";
  // 通用服装剪影（装饰用，不区分具体款式/颜色）
  const shape = `
    <polygon points="62,66 22,96 42,124 64,102" />
    <polygon points="138,66 178,96 158,124 136,102" />
    <path d="M62,66 C66,60 78,58 100,58 C122,58 134,60 138,66 L144,210 L56,210 Z" />`;
  const gid = `g-${region}`;
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
export function garmentDataUrl(region: "upper" | "lower" | "full"): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(garmentSvg(region))}`;
}
