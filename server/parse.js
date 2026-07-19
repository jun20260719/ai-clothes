import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env") });
import * as cheerio from "cheerio";
import { recognizeProductImage } from "./vision.js";

/* ── 平台识别 ── */
const PLATFORM_RULES = [
  { key: "taobao", match: /taobao\.com|tb\.cn/i, name: "淘宝" },
  { key: "tmall", match: /tmall\.com/i, name: "天猫" },
  { key: "jd", match: /jd\.com|jingdong\.com/i, name: "京东" },
  { key: "pinduoduo", match: /pinduoduo\.com|pdd\.com|yangkeduo\.com/i, name: "拼多多" },
  { key: "xianyu", match: /goofish\.com|2\.taobao\.com|xianyu/i, name: "闲鱼" },
  { key: "douyin", match: /douyin\.com|jinritemai/i, name: "抖音" },
];

function detectPlatform(url) {
  for (const r of PLATFORM_RULES) if (r.match.test(url)) return r.key;
  return "unknown";
}
const PLATFORM_NAME = {
  taobao: "淘宝", tmall: "天猫", jd: "京东", pinduoduo: "拼多多",
  xianyu: "闲鱼", douyin: "抖音", unknown: "商品",
};

/* ── 从链接提取商品 id（淘宝 num_iid / itemId 等）── */
function extractItemId(url) {
  const m =
    url.match(/[?&](?:id|item_id|itemId|num_iid)=(\d{6,})/i) ||
    url.match(/\/(\d{10,})(?:\.html|\?|$)/);
  return m ? m[1] : "";
}

/**
 * 淘宝「手机分享短链」(e.tb.cn/h/xxx、m.tb.cn 等) 落地页是 JS 跳转，
 * 真实商品页链接 (item.taobao.com/item.htm?id=...) 嵌在 HTML 里。
 * 这里从落地页 HTML 中提取真实商品链接，供二次带 Cookie 抓取。
 */
function extractRedirectTarget(html, baseUrl) {
  if (!html) return null;
  const decoded = html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
  // 直接出现的完整商品链接
  const m1 = decoded.match(
    /https?:\/\/(?:item\.taobao\.com|detail\.tmall\.com)\/item\.htm\?[^\s"'<>]+/i,
  );
  if (m1) return m1[0].replace(/["'\);]+$/, "");
  // 或写在 href="..." / location="..." 里
  const m2 = decoded.match(
    /["']?(?:href|location)\s*[:=]\s*["']([^"']*(?:item\.taobao\.com|detail\.tmall\.com)\/item\.htm[^"']*)/i,
  );
  if (m2) return m2[1].replace(/["'\);]+$/, "");
  return null;
}

/* ── 服装识别 ── */
const CLOTHING_KEYWORDS = [
  "T恤","短袖","衬衫","卫衣","连帽","毛衣","针织","夹克","大衣","风衣","西装",
  "连衣裙","半身裙","短裙","长裙","裤子","牛仔裤","休闲裤","短裤","背心","吊带",
  "无袖","上衣","外套","裙","tee","shirt","dress","hoodie","jacket","coat",
  "sweater","pants",
];
const TYPE_RULES = [
  { type: "tshirt", words: ["T恤","短袖","tee","t-shirt"] },
  { type: "shirt", words: ["衬衫","shirt"] },
  { type: "hoodie", words: ["卫衣","连帽","hoodie"] },
  { type: "sweater", words: ["毛衣","针织","sweater"] },
  { type: "jacket", words: ["夹克","外套","jacket"] },
  { type: "coat", words: ["大衣","风衣","西装","coat"] },
  { type: "dress", words: ["连衣裙","dress"] },
  { type: "skirt", words: ["半身裙","短裙","长裙","裙"] },
  { type: "pants", words: ["裤子","牛仔裤","休闲裤","西裤","pants"] },
  { type: "shorts", words: ["短裤","shorts"] },
  { type: "tanktop", words: ["背心","吊带","无袖"] },
];
const COLOR_RULES = [
  { word: "黑", hex: "#1f2937" }, { word: "白", hex: "#f3f4f6" },
  { word: "红", hex: "#ef4444" }, { word: "蓝", hex: "#2563eb" },
  { word: "天蓝", hex: "#0ea5e9" }, { word: "绿", hex: "#10b981" },
  { word: "粉", hex: "#ec4899" }, { word: "紫", hex: "#7c3aed" },
  { word: "灰", hex: "#64748b" }, { word: "黄", hex: "#f59e0b" },
  { word: "棕", hex: "#a16207" }, { word: "橙", hex: "#f97316" },
];
const REGION_MAP = {
  tshirt: "upper", shirt: "upper", hoodie: "upper", sweater: "upper",
  jacket: "upper", coat: "full", dress: "full", skirt: "lower",
  pants: "lower", shorts: "lower", tanktop: "upper", other: "upper",
};
/** 后端服装类型中文名（用于 AI 识别结果的 garment.name） */
const GARMENT_LABELS = {
  tshirt: "T恤", shirt: "衬衫", hoodie: "卫衣", sweater: "毛衣", jacket: "夹克",
  coat: "大衣/外套", dress: "连衣裙", skirt: "半身裙", pants: "裤子",
  shorts: "短裤", tanktop: "背心/吊带", other: "服装",
};

function makeGarment(type, name, color, region) {
  const c = color || "#7c3aed";
  return {
    id: `g-${Date.now().toString(36)}`,
    type,
    name: name || GARMENT_LABELS[type] || "服装",
    color: c,
    accentColor: c,
    region: region || REGION_MAP[type] || "upper",
  };
}
function isClothingTitle(t) {
  const s = (t || "").toLowerCase();
  return CLOTHING_KEYWORDS.some((k) => s.includes(k.toLowerCase()));
}
function detectType(t) {
  const s = (t || "").toLowerCase();
  for (const r of TYPE_RULES) if (r.words.some((w) => s.includes(w.toLowerCase()))) return r.type;
  return "other";
}
function detectColor(t) {
  for (const r of COLOR_RULES) if ((t || "").includes(r.word)) return r.hex;
  return "#7c3aed";
}

/* ── 抓取 + 提取 ── */
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

/** 移动端 UA（部分平台对桌面 UA 返回 JS 中间跳转页，移动端返回真实数据） */
const MOBILE_HEADERS = {
  ...FETCH_HEADERS,
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

/* ── 淘宝/天猫登录态 Cookie（环境变量注入，用于绕过反爬拿到真实商品数据）──
 * 敏感信息：绝不打印 cookie 内容，只记录是否配置。 */
const TAOBAO_COOKIE = (process.env.TAOBAO_COOKIE || "").trim();
const HAS_COOKIE = TAOBAO_COOKIE.length > 0;

/** 淘宝/天猫链接自动带上登录态 Cookie，其它平台不带 */
function requestHeaders(url) {
  const h = { ...FETCH_HEADERS, Referer: "https://www.taobao.com/" };
  if (HAS_COOKIE && /taobao\.com|tmall\.com/i.test(url)) {
    h.Cookie = TAOBAO_COOKIE;
  }
  return h;
}
export { requestHeaders };

function unescapeJson(s) {
  return (s || "")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .trim();
}

function stripTitleSuffix(t) {
  return (t || "")
    .replace(/\s*[-–|·]\s*(淘宝网|天猫|tmall\.com|淘宝|京东商城|京东|jd\.com|拼多多|pinduoduo).*$/i, "")
    .trim();
}

/** 从页面内嵌 <script> JSON 中兜底提取标题/主图/价格/店铺（登录态下命中率更高） */
function extractEmbedded(html) {
  const out = { title: "", price: null, image: "", shop: "" };
  // 标题：覆盖淘宝常见键名（title / titleText / subTitle / itemName / name）
  const titleM =
    html.match(/"titleText"\s*:\s*"((?:[^"\\]|\\.){4,200})"/i) ||
    html.match(/"subTitle"\s*:\s*"((?:[^"\\]|\\.){4,200})"/i) ||
    html.match(/"itemName"\s*:\s*"((?:[^"\\]|\\.){4,200})"/i) ||
    html.match(/"title"\s*:\s*"((?:[^"\\]|\\.){4,200})"/i) ||
    html.match(/"name"\s*:\s*"((?:[^"\\]|\\.){4,200})"/i);
  if (titleM) out.title = unescapeJson(titleM[1]);

  // 价格：覆盖 salePrice / priceInfo / priceText / skuPrice / realPrice / lowPrice / highPrice / price
  const priceM =
    html.match(/"salePrice"\s*:\s*"?(\d+(?:\.\d+)?)/i) ||
    html.match(/"priceInfo"\s*:\s*"?(\d+(?:\.\d+)?)/i) ||
    html.match(/"priceText"\s*:\s*"([\d.]+)"/i) ||
    html.match(/"skuPrice"\s*:\s*"(\d+(?:\.\d+)?)/i) ||
    html.match(/"realPrice"\s*:\s*"?(\d+(?:\.\d+)?)/i) ||
    html.match(/"lowPrice"\s*:\s*"?(\d+(?:\.\d+)?)/i) ||
    html.match(/"highPrice"\s*:\s*"?(\d+(?:\.\d+)?)/i) ||
    html.match(/"price"\s*:\s*"?(\d+(?:\.\d+)?)/i);
  if (priceM) {
    const n = parseFloat(priceM[1]);
    if (!Number.isNaN(n)) out.price = n;
  }

  // 店铺名
  const shopM =
    html.match(/"shopName"\s*:\s*"((?:[^"\\]|\\.){1,60})"/i) ||
    html.match(/"sellerName"\s*:\s*"((?:[^"\\]|\\.){1,60})"/i) ||
    html.match(/"shopTitle"\s*:\s*"((?:[^"\\]|\\.){1,60})"/i);
  if (shopM) out.shop = unescapeJson(shopM[1]);

  const imgM = html.match(
    /"(?:pic|picUrl|imgUrl|mainImage|image|images|originalImage)"\s*:\s*"(https?:)?(\/\/[^"]+?\.(?:jpg|jpeg|png|webp))"/i,
  );
  if (imgM) out.image = imgM[1] ? imgM[1] + imgM[2] : "https:" + imgM[2];
  if (!out.image) {
    const imgTag = html.match(
      /<img[^>]+src="([^"]*?(?:alicdn|taobaocdn|tbcdn|360buyimg|jd|jdc)[^"]*?\.(?:jpg|jpeg|png|webp))"/i,
    );
    if (imgTag) out.image = imgTag[1].startsWith("//") ? "https:" + imgTag[1] : imgTag[1];
  }
  return out;
}

function extractMeta(html) {
  const $ = cheerio.load(html);
  const get = (sel) => {
    const el = $(sel).first();
    return el.length ? (el.attr("content") || el.text() || "").trim() : "";
  };
  const ogTitle = get('meta[property="og:title"]');
  const twTitle = get('meta[name="twitter:title"]');
  let title = ogTitle || twTitle || $("title").first().text().trim() || "";

  const ogImage = get('meta[property="og:image"]') || get('meta[property="og:image:url"]');
  const twImage = get('meta[name="twitter:image"]');
  let image = ogImage || twImage || "";

  const ogPrice = get('meta[property="og:price:amount"]');
  const twPrice = get('meta[name="twitter:data1"]');
  const priceMeta = ogPrice || twPrice;
  let price = null;
  if (priceMeta) {
    const n = parseFloat(priceMeta.replace(/[^\d.]/g, ""));
    if (!Number.isNaN(n)) price = n;
  }

  // JSON-LD
  let jsonLd = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        if (d && (d["@type"] === "Product" || d.name)) {
          jsonLd = d;
          return false;
        }
      }
    } catch {
      /* ignore */
    }
  });
  if (jsonLd) {
    if (!title && jsonLd.name) title = jsonLd.name;
    if (!image) {
      const img = jsonLd.image;
      image = typeof img === "string" ? img : img?.url || (Array.isArray(img) ? img[0] : "");
    }
    if (price == null && jsonLd.offers) {
      const o = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
      const p = o?.price || o?.lowPrice;
      if (p != null) {
        const n = parseFloat(String(p).replace(/[^\d.]/g, ""));
        if (!Number.isNaN(n)) price = n;
      }
    }
  }

  // 兜底：内嵌 <script> JSON（登录态 Cookie 下更易命中）
  const emb = extractEmbedded(html);
  if (!title && emb.title) title = emb.title;
  if (!image && emb.image) image = emb.image;
  if (price == null && emb.price != null) price = emb.price;
  let shop = get('meta[property="og:site_name"]') || emb.shop || "";

  if (title) title = stripTitleSuffix(title);
  // 主图归一化为绝对 URL（淘宝常返回 //img.alicdn.com/...）
  if (image && image.startsWith("//")) image = "https:" + image;

  return { title, image, price, shop, hasImage: !!image };
}

/**
 * 反爬 / 拦截页检测：命中即视为"详情抓取失败"。
 * 淘宝系正常商品页必有 og:image，若无主图基本是被拦截或降级页。
 */
function isAntiCrawl({ title, url }) {
  if (!title || title.trim() === "") return true;
  if (title === url) return true;
  const t = title.toLowerCase();
  const blocked = [
    "验证码", "安全验证", "滑块", "登录", "请稍候", "访问被拒绝",
    "亲，", "robot", "captcha", "verify", "淘！我喜欢", "淘你喜欢", "404",
  ];
  if (blocked.some((k) => t.includes(k))) return true;
  // 带登录态 Cookie 时，淘宝页即使没有 og:image 也可能已有真实标题，
  // 不再因「无主图」就判为拦截，改由调用方按 hasImage 标记 incomplete。
  return false;
}

/**
 * 检测是否为天猫/淘宝的 JS 中间跳转页（而非真实商品详情）。
 * 这类页面通常：<10KB、包含 localStorage.x5referer / a-link 脚本、无 og:image
 */
function isInterstitialPage(html, url) {
  if (!html || html.length > 20000) return false;
  const hasRedirectScript =
    html.includes("localStorage.x5referer") ||
    html.includes('id="a-link"') ||
    html.includes("window.location.href") ||
    html.includes("login.m.taobao.com");
  const noProductData = !html.includes("og:image") && !html.includes('"price"');
  return /taobao|tmall/i.test(url) && hasRedirectScript && noProductData;
}

/**
 * 天猫/淘宝轻量详情接口（无需签名，返回含标题/价格/图片的 HTML 片段）。
 * 当主抓取拿到中间跳转页时作为最后手段调用。
 */
async function fetchLightDetail(itemId, platform) {
  if (!itemId) return null;
  // 天猫轻量详情
  const urls = [
    `https://detailskip.taobao.com/service/getData/1/p1/item/detail/sib.htm?itemId=${itemId}&sellerId=&sid=&appId=300`,
    `https://h5api.m.taobao.com/h5/mtop.taobao.idle.detail.get/1.0/?data={"itemNumId":"${itemId}"}`,
  ];
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, {
        headers: {
          "User-Agent": MOBILE_HEADERS["User-Agent"],
          Referer: platform === "tmall"
            ? `https://detail.tmall.com/item.htm?id=${itemId}`
            : `https://item.taobao.com/item.htm?id=${itemId}`,
          Accept: "*/*",
        },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const text = await r.text();
      // 轻量接口可能返回 HTML 片段或 JSONP
      if (text.includes("title") || text.includes("price") || text.includes("img")) {
        console.log(`[parse] Light detail got ${text.length}B from ${new URL(url).pathname}`);
        return text;
      }
    } catch {
      /* continue to next URL */
    }
  }
  return null;
}

/** 从轻量详情响应中提取信息 */
function parseLightDetail(text) {
  const out = { title: "", price: null, image: "", shop: "" };
  // 标题
  const tM = text.match(/["']?title["']?\s*[:=]\s*["']([^"']{4,200})["']/i);
  if (tM) out.title = unescapeJson(tM[1]);
  // 价格（数字）
  const pM = text.match(/["']?price["']?\s*[:=]\s*"?(\d+\.?\d*)"?/i);
  if (pM) { const n = parseFloat(pM[1]); if (!Number.isNaN(n)) out.price = n; }
  // 图片 URL
  const iM = text.match(/(https?:\/\/(?:img|gw)\.(alicdn|taobaocdn|tbcdn)[^"'\s>]+\.(?:jpg|jpeg|png|webp))/i);
  if (iM) out.image = iM[1];
  // 店铺
  const sM = text.match(/["']?(?:shopName|shopTitle|sellerName|nick)["']?\s*[:=]\s*"([^"]{2,60})"/i);
  if (sM) out.shop = unescapeJson(sM[1]);
  return out;
}

/** 抓取失败 / 被反爬拦截时的兜底：购物平台默认当作可试衣，引导端上手动确认服装 */
function buildFallback(platform, url) {
  const itemId = extractItemId(url);
  return {
    url,
    platform,
    title: itemId
      ? `「${PLATFORM_NAME[platform]}商品 #${itemId}」`
      : `「${PLATFORM_NAME[platform]}商品（详情待补充）」`,
    imageUrl: "",
    price: 0,
    shop: "",
    isClothing: true,
    incomplete: true,
    itemId,
    garments: [],
    mock: false,
    cookieUsed: HAS_COOKIE && /taobao|tmall/.test(platform),
  };
}

/** 视觉识别兜底：用商品图补全标题/价格/服装；失败返回 null */
async function tryVision(platform, finalUrl, meta) {
  if (!meta.image) return null;
  console.log(`[parse] Vision fallback triggered: image=${meta.image.substring(0, 80)}...`);
  const rec = await recognizeProductImage(meta.image);
  if (!rec) {
    console.log(`[parse] Vision returned null, skipping`);
    return null;
  }
  console.log(`[parse] Vision result: title="${rec.title}" price=${rec.price} type=${rec.garmentType}`);

  const garments = [];
  if (rec.garmentType && rec.garmentType !== "other") {
    garments.push(
      makeGarment(rec.garmentType, rec.title || GARMENT_LABELS[rec.garmentType], rec.color, rec.region),
    );
  } else if (rec.title && isClothingTitle(rec.title)) {
    const type = detectType(rec.title);
    garments.push(
      makeGarment(type, rec.title, rec.color || detectColor(rec.title), REGION_MAP[type] || "upper"),
    );
  }

  const title =
    rec.title || (meta.title && meta.title !== finalUrl ? meta.title : `「${PLATFORM_NAME[platform]}商品」`);
  const price = rec.price != null ? rec.price : (meta.price ?? 0);

  return {
    url: finalUrl,
    platform,
    title,
    imageUrl: meta.image || "",
    price,
    shop: meta.shop || "",
    isClothing: true,
    incomplete: garments.length === 0,
    garments,
    mock: false,
    itemId: extractItemId(finalUrl),
    cookieUsed: HAS_COOKIE && /taobao|tmall/.test(platform),
    aiRecognized: true,
  };
}

/**
 * 解析商品链接 → 结构化结果（真实抓取）。
 * 抓不到详情（平台反爬）时，对购物平台返回 incomplete 兜底结果而非失败，
 * 由前端引导用户手动选择服装，保证试衣流程仍可跑通。
 */
export async function parseProductPage(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error("无效的链接");

  let finalUrl = url;
  let html = "";
  try {
    // 第一跳：抓取落地页（短链 e.tb.cn 会返回 200 的 HTML，内含真实商品链接）
    const resp1 = await fetch(url, { headers: requestHeaders(url), redirect: "follow" });
    if (!resp1.ok) throw new Error(`抓取失败：HTTP ${resp1.status}`);
    let h1 = await resp1.text();

    // 短链解析：从落地页 HTML 提取真实商品页链接，二次带 Cookie 抓取（拿到真实详情）
    const resolved = extractRedirectTarget(h1, url);
    if (resolved && resolved !== url) {
      finalUrl = resolved;
      try {
        const resp2 = await fetch(finalUrl, {
          headers: requestHeaders(finalUrl),
          redirect: "follow",
        });
        if (resp2.ok) h1 = await resp2.text();
      } catch {
        /* 二次抓取失败则沿用第一跳 HTML */
      }
    }
    html = h1;

    // 桌面端 UA 可能拿到天猫/淘宝的 JS 中间跳转页（非真实商品数据），
    // 自动切换为移动端 UA 重试（移动端通常返回含 og:image 的 H5 页面）。
    if (isInterstitialPage(html, finalUrl) && /taobao|tmall/i.test(finalUrl)) {
      console.log(`[parse] Detected interstitial page (${html.length}B), retrying with mobile UA...`);
      try {
        const mobileHeaders = { ...requestHeaders(finalUrl), ...MOBILE_HEADERS };
        delete mobileHeaders.Cookie; // 移动端 Cookie 格式不同，避免冲突
        const respM = await fetch(finalUrl, {
          headers: mobileHeaders,
          redirect: "follow",
        });
        if (respM.ok) {
          const hMobile = await respM.text();
          if (!isInterstitialPage(hMobile, finalUrl)) {
            console.log(`[parse] Mobile UA got ${hMobile.length}B HTML (was ${html.length}B)`);
            html = hMobile;
          }
        }
      } catch {
        /* mobile retry failed, stick with desktop result */
      }
    }
  } catch {
    html = "";
  }

  const meta = html
    ? extractMeta(html)
    : { title: "", image: "", price: null, shop: "", hasImage: false };

  // 轻量详情兜底：桌面+移动端都没拿到有效数据时，尝试轻量接口
  const itemId = extractItemId(finalUrl);
  const plat = detectPlatform(finalUrl);
  if (!meta.hasImage && !meta.title && /taobao|tmall/i.test(finalUrl) && itemId) {
    console.log(`[parse] Main fetch empty, trying light detail API for item ${itemId}...`);
    const lightHtml = await fetchLightDetail(itemId, plat);
    if (lightHtml) {
      const light = parseLightDetail(lightHtml);
      console.log(`[parse] Light detail: title="${light.title}" price=${light.price} img=${light.image ? "YES" : "NO"}`);
      if (!meta.title && light.title) meta.title = stripTitleSuffix(light.title);
      if (meta.price == null && light.price != null) meta.price = light.price;
      if (!meta.image && light.image) meta.image = light.image;
      if (!meta.shop && light.shop) meta.shop = light.shop;
      meta.hasImage = !!meta.image;
    }
  }

  // 抓取为空，或被反爬/拦截页 → 兜底
  if (!html || isAntiCrawl({ title: meta.title, hasImage: meta.hasImage, url: finalUrl })) {
    const platform = detectPlatform(finalUrl);
    if (platform === "unknown") {
      // 普通网页且无有效信息：确实无法识别为服装
      return {
        url: finalUrl,
        platform: "unknown",
        title: meta.title || url,
        imageUrl: "",
        price: 0,
        shop: "",
        isClothing: false,
        garments: [],
        mock: false,
      };
    }
    // 购物平台：即使被拦截，只要有主图就先尝试「视觉识别」补全商品信息
    if (meta.hasImage) {
      const rec = await tryVision(platform, finalUrl, meta);
      if (rec) return rec;
    }
    return buildFallback(platform, finalUrl);
  }

  // 正常解析路径
  const platform = detectPlatform(finalUrl);
  const title = meta.title || url;
  const autoClothing = isClothingTitle(title); // 标题是否命中服装关键词
  const garments = [];
  let isClothing;
  let incomplete = !meta.hasImage;

  if (platform === "unknown") {
    // 普通网页：仅按关键词判定是否为服装，无法识别则视为非服装
    isClothing = autoClothing;
    if (isClothing) {
      const type = detectType(title);
      const color = detectColor(title);
      garments.push({
        id: `g-${Date.now().toString(36)}`,
        type,
        name: title,
        color: color === "#f3f4f6" ? "#e5e7eb" : color,
        accentColor: color,
        region: REGION_MAP[type] || "upper",
      });
    }
  } else {
    // 购物平台商品链接：用户粘贴的目的就是衣服，默认当作可试衣。
    // 标题命中服装关键词 → 自动识别；否则交给端上手动选择，绝不再硬拒。
    isClothing = true;
    if (autoClothing) {
      const type = detectType(title);
      const color = detectColor(title);
      garments.push({
        id: `g-${Date.now().toString(36)}`,
        type,
        name: title,
        color: color === "#f3f4f6" ? "#e5e7eb" : color,
        accentColor: color,
        region: REGION_MAP[type] || "upper",
      });
      incomplete = !meta.hasImage; // 仅主图缺失时 incomplete
    } else {
      // 标题未命中服装关键词：引导用户手动选择服装，不再判定为「非服装」
      incomplete = true;
    }
  }

  // 视觉识别兜底：购物平台 + 有主图，但服装未识别 / 缺价格 / 缺标题时，
  // 用商品图自动补全（HTML 已确认的字段优先，缺失的才用视觉补）。
  const needsVision =
    platform !== "unknown" &&
    meta.hasImage &&
    (garments.length === 0 || meta.price == null || !meta.title || meta.title === finalUrl);
  if (needsVision) {
    console.log(`[parse] Needs vision: hasImage=${meta.hasImage} garments=${garments.length} title=${meta.title ? '"' + meta.title.substring(0,40) + '"' : 'EMPTY'} price=${meta.price}`);
    const rec = await tryVision(platform, finalUrl, meta);
    if (rec) {
      const mergedGarments = garments.length > 0 ? garments : rec.garments;
      const mergedTitle =
        meta.title && meta.title !== finalUrl ? meta.title : rec.title;
      const mergedPrice =
        meta.price != null && meta.price !== 0 ? meta.price : rec.price || 0;
      return {
        url: finalUrl,
        platform,
        title: mergedTitle,
        imageUrl: meta.image || "",
        price: mergedPrice,
        shop: meta.shop || "",
        isClothing: true,
        incomplete: mergedGarments.length === 0,
        garments: mergedGarments,
        mock: false,
        itemId: extractItemId(finalUrl),
        cookieUsed: HAS_COOKIE && /taobao|tmall/.test(platform),
        aiRecognized: true,
      };
    }
  }

  return {
    url: finalUrl,
    platform,
    title,
    imageUrl: meta.image || "",
    price: meta.price ?? 0,
    shop: meta.shop || "",
    isClothing,
    incomplete,
    garments,
    mock: false,
    cookieUsed: HAS_COOKIE && /taobao|tmall/.test(platform),
  };
}
