import type { Garment, ParsedProduct, Platform } from "@/types";
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

/** 从标题关键词推断试衣覆盖区域（不再经过服装类型中间量） */
function detectRegion(title: string): "upper" | "lower" | "full" {
  const s = (title || "").toLowerCase();
  if (/连衣裙|套装|连体|长裙|dress|suit|jumpsuit/.test(s)) return "full";
  if (/半身裙|短裙|裙|裤子|牛仔裤|休闲裤|西裤|短裤|pants|skirt|jeans|shorts/.test(s)) return "lower";
  if (/衬衫|卫衣|连帽|毛衣|针织|大衣|风衣|西装|外套|夹克|背心|吊带|无袖|上衣|t恤|短袖|tee|shirt|hoodie|coat|jacket|sweater|polo/.test(s)) return "upper";
  return "upper";
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
    const region = detectRegion(title);
    garments.push({
      id: `g-${seed.toString(36)}`,
      name: title,
      region,
    });
    // 套装场景：连衣裙/大衣下再补一件内搭
    if (region === "full" && rand() > 0.5) {
      garments.push({
        id: `g-${seed.toString(36)}-2`,
        name: "基础内搭T恤",
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

  // 后端已解析为服装，但服装未识别（标题无关键词命中 / 视觉兜底未触发）
  // → 用商品主图再让视觉模型识别一次，自动补全服装信息与试衣部位，免去手动选择。
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
