import type { Garment, GarmentType, ParsedProduct, Platform } from "@/types";
import { REGION_MAP, COLOR_PALETTE } from "./garments";
import { parseViaApi, recognizeProductImageApi } from "./api";

/* ──────────────────────────────────────────────────────────────────────────
 * 生产环境接入说明（重要）
 * ──────────────────────────────────────────────────────────────────────────
 * 淘宝/天猫/京东/拼多多等平台均有反爬与跨域限制，浏览器端无法直接抓取商品页。
 * 真实上线时应由后端代理完成解析（任选其一）：
 *   1) 调用各平台开放平台商品 API（需商家/开发者资质）
 *   2) 自建无头浏览器服务（Playwright/Puppeteer）抓取并提取主图+标题+类目
 *   3) 第三方商品解析服务（按 itemId 返回结构化数据）
 * 后端解析后还应额外返回「服装抠图（透明 PNG）」用于试衣合成，
 * 或至少返回主图，由试衣引擎做自动抠图。
 *
 * 本 MVP 在前端用确定性 mock 模拟解析结果，保证流程可完整跑通、无需后端。
 * 接入真实后端时，只需把下方 parseLink 内部替换为 fetch('/api/parse?url=...')。
 * ──────────────────────────────────────────────────────────────────────── */

/** 简单字符串哈希（用于从 URL 派生稳定随机） */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 基于种子的伪随机（0-1） */
function seededRand(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PLATFORM_RULES: { key: Platform; match: RegExp; name: string }[] = [
  { key: "taobao", match: /taobao\.com|tb\.cn/i, name: "淘宝" },
  { key: "tmall", match: /tmall\.com/i, name: "天猫" },
  { key: "jd", match: /jd\.com|jingdong\.com/i, name: "京东" },
  { key: "pinduoduo", match: /pinduoduo\.com|pdd\.com|yangkeduo\.com/i, name: "拼多多" },
  { key: "xianyu", match: /goofish\.com|2\.taobao\.com|xianyu/i, name: "闲鱼" },
  { key: "douyin", match: /douyin\.com|jinritemai/i, name: "抖音" },
];

function detectPlatform(url: string): { platform: Platform; name: string } {
  for (const r of PLATFORM_RULES) {
    if (r.match.test(url)) return { platform: r.key, name: r.name };
  }
  return { platform: "unknown", name: "其他平台" };
}

/** 服装类目关键词（命中即视为服装） */
const CLOTHING_KEYWORDS = [
  "T恤", "短袖", "衬衫", "卫衣", "连帽", "毛衣", "针织", "夹克", "大衣", "风衣",
  "西装", "连衣裙", "半身裙", "短裙", "长裙", "裤子", "牛仔裤", "休闲裤", "短裤",
  "背心", "吊带", "无袖", "上衣", "外套", "裙", "tee", "shirt", "dress", "hoodie",
  "jacket", "coat", "sweater", "pants",
];

/** 类型识别关键词 → GarmentType */
const TYPE_RULES: { type: GarmentType; words: string[] }[] = [
  { type: "tshirt", words: ["T恤", "短袖", "tee", "t-shirt"] },
  { type: "shirt", words: ["衬衫", "shirt"] },
  { type: "hoodie", words: ["卫衣", "连帽", "hoodie"] },
  { type: "sweater", words: ["毛衣", "针织", "sweater"] },
  { type: "jacket", words: ["夹克", "外套", "jacket"] },
  { type: "coat", words: ["大衣", "风衣", "西装", "coat"] },
  { type: "dress", words: ["连衣裙", "dress"] },
  { type: "skirt", words: ["半身裙", "短裙", "长裙", "裙"] },
  { type: "pants", words: ["裤子", "牛仔裤", "休闲裤", "西裤", "pants"] },
  { type: "shorts", words: ["短裤", "shorts"] },
  { type: "tanktop", words: ["背心", "吊带", "无袖"] },
];

/** 颜色识别关键词 → HEX */
const COLOR_RULES: { word: string; hex: string }[] = [
  { word: "黑", hex: "#1f2937" },
  { word: "白", hex: "#f3f4f6" },
  { word: "红", hex: "#ef4444" },
  { word: "蓝", hex: "#2563eb" },
  { word: "天蓝", hex: "#0ea5e9" },
  { word: "绿", hex: "#10b981" },
  { word: "粉", hex: "#ec4899" },
  { word: "紫", hex: "#7c3aed" },
  { word: "灰", hex: "#64748b" },
  { word: "黄", hex: "#f59e0b" },
  { word: "棕", hex: "#a16207" },
  { word: "橙", hex: "#f97316" },
];

function detectType(title: string): GarmentType {
  for (const r of TYPE_RULES) {
    if (r.words.some((w) => title.toLowerCase().includes(w.toLowerCase()))) {
      return r.type;
    }
  }
  return "other";
}

function detectColor(title: string): { color: string; accent: string } {
  for (const r of COLOR_RULES) {
    if (title.includes(r.word)) return { color: r.hex, accent: r.hex };
  }
  return { color: "#7c3aed", accent: "#7c3aed" };
}

const SAMPLE_TITLES = [
  "2026春季新款纯棉宽松圆领短袖T恤女",
  "日系复古格纹长袖衬衫男中性风",
  "加绒连帽卫衣情侣款宽松运动上衣",
  "法式碎花收腰显瘦长款连衣裙",
  "高腰显瘦阔腿牛仔裤直筒休闲裤",
  "羊毛混纺双面呢中长款大衣外套",
  "百褶半身裙高腰A字中长裙",
  "冰丝凉感无袖背心运动健身上衣",
  "复古工装夹克多口袋宽松外套",
  "针织开衫软糯慵懒风毛衣",
];

const SAMPLE_SHOPS = [
  "优衣库官方旗舰店", "ZARA官方旗舰店", "UR官方旗舰店", "太平鸟服饰",
  "海澜之家", "ONLY官方旗舰店", "森马官方outlet", "GAP官方旗舰店",
];

/** 判断是否为服装类 */
export function isClothingTitle(title: string): boolean {
  return CLOTHING_KEYWORDS.some((k) => title.toLowerCase().includes(k.toLowerCase()));
}

/**
 * 解析购物链接 → 商品 + 服装识别结果
 * MVP：前端确定性 mock。生产：替换为后端解析接口。
 */
export async function parseLink(url: string): Promise<ParsedProduct> {
  const trimmed = (url || "").trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("请输入有效的商品链接（以 http/https 开头）");
  }

  // 模拟网络延迟
  await new Promise((r) => setTimeout(r, 700));

  const { platform } = detectPlatform(trimmed);
  const isShopping = platform !== "unknown";
  const seed = hash(trimmed);
  const rand = seededRand(seed);

  // 从 URL 中随机选一个示例标题（稳定）
  const title = SAMPLE_TITLES[Math.floor(rand() * SAMPLE_TITLES.length)];
  const shop = SAMPLE_SHOPS[Math.floor(rand() * SAMPLE_SHOPS.length)];
  const price = Math.round((49 + rand() * 951) * 1) / 1; // 49 - 1000

  const isClothing = isShopping ? true : isClothingTitle(title);
  const garments: Garment[] = [];

  if (isClothing) {
    // 单件为主，偶尔同时识别上下装（如套装）
    const type = detectType(title);
    const { color, accent } = detectColor(title);
    garments.push({
      id: `g-${seed.toString(36)}`,
      type,
      name: title,
      color: color === "#f3f4f6" ? "#e5e7eb" : color, // 白色略微加灰便于看清
      accentColor: accent,
      region: REGION_MAP[type],
    });
    // 套装场景：连衣裙/大衣下再补一件内搭
    if ((type === "coat" || type === "dress") && rand() > 0.5) {
      garments.push({
        id: `g-${seed.toString(36)}-2`,
        type: "tshirt",
        name: "基础内搭T恤",
        color: "#f3f4f6",
        accentColor: "#e5e7eb",
        region: "upper",
      });
    }
  }

  return {
    url: trimmed,
    platform,
    title,
    imageUrl: "", // MVP 不加载外部图（CORS/跨域），由服装 SVG 替代
    price,
    shop,
    isClothing,
    garments,
    mock: true,
  };
}

export { COLOR_PALETTE };

/**
 * 解析商品链接（智能路由）：优先调用后端真实解析，
 * 任何失败（无后端 / 网络错误 / 解析异常）自动回退到前端 mock，保证流程可用。
 */
export async function parseProduct(url: string): Promise<ParsedProduct> {
  let product: ParsedProduct;
  try {
    product = await parseViaApi(url);
  } catch {
    product = await parseLink(url);
  }

  // 后端已解析为服装，但服装类型未识别（标题无关键词命中 / 视觉兜底未触发）
  // → 用商品主图再让视觉模型识别一次，自动补全类型与颜色，免去手动选择。
  if (
    product.isClothing &&
    product.garments.length === 0 &&
    typeof product.imageUrl === "string" &&
    product.imageUrl.startsWith("data:")
  ) {
    try {
      const rec = await recognizeProductImageApi(product.imageUrl);
      if (rec.recognized && rec.garment) {
        product = {
          ...product,
          garments: [rec.garment],
          incomplete: false,
          aiRecognized: true,
        };
      }
    } catch {
      // 识别失败则保持 garments 为空，由 ProductCard 提示「无法识别，无法进行下一步」
    }
  }

  return product;
}
