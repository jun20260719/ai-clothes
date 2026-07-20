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
 *
 * 增强覆盖（解决手机短链落地页提取失败 → interstitial 误判）：
 *   ① 桌面端 item.taobao.com / detail.tmall.com 完整链接
 *   ② 移动端 a.m.taobao.com/i{itemId}.htm（手机分享短链常见跳转目标）
 *   ③ href / location.href / location.replace("...") 里的商品链接
 *   ④ <meta http-equiv="refresh" content="0;url=..."> 跳转
 *   ⑤ 短链落地页裸 itemId（11-16 位数字，仅在 baseUrl 是短链时启用，避免误匹配）
 *
 * 返回值统一归一化为 item.taobao.com/item.htm?id={itemId}（带 Cookie 二次抓取命中率最高）。
 */
function extractRedirectTarget(html, baseUrl) {
  if (!html) return null;
  const decoded = html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
  const isShortLink = /tb\.cn|e\.tb\.cn|m\.tb\.cn/i.test(baseUrl || "");

  // 排除：noitem 错误页（其 location 指向 error.item.taobao.com，不是真实商品）
  if (html.includes("error/noitem") || html.includes("error.item.taobao.com")) {
    return null;
  }

  // 从任意 URL 片段中提取 itemId，归一化为标准商品页
  const toCanonical = (u) => {
    if (!u) return null;
    const idM =
      u.match(/[?&](?:id|item_id|itemId|num_iid)=(\d{6,})/i) ||
      u.match(/\/i(\d{6,})\.htm/i) ||
      u.match(/\/(\d{10,})(?:\.html|\?|$)/);
    if (idM) return `https://item.taobao.com/item.htm?id=${idM[1]}`;
    return null;
  };

  // ① 完整桌面端商品链接（https://item.taobao.com/...）
  const m1 = decoded.match(
    /https?:\/\/(?:item\.taobao\.com|detail\.tmall\.com)\/item\.htm\?[^\s"'<>]+/i,
  );
  if (m1) {
    const c = toCanonical(m1[0]);
    if (c) return c;
  }

  // ② 移动端商品页 a.m.taobao.com/i{itemId}.htm（支持 https:// 或 // 协议相对）
  const mMobile = decoded.match(
    /(?:https?:)?\/\/a\.m\.taobao\.com\/i(\d{6,})\.htm[^\s"'<>]*/i,
  );
  if (mMobile) return `https://item.taobao.com/item.htm?id=${mMobile[1]}`;

  // ③ href / location.href / location.replace / location.assign 里的商品链接
  //    支持协议相对 URL（//item.taobao.com/...）
  const m2 = decoded.match(
    /["']?(?:href|location(?:\.href)?|replace|assign)\s*[:=]\s*["']((?:https?:)?\/\/[^"']*(?:item\.taobao\.com|detail\.tmall\.com|a\.m\.taobao\.com)\/(?:item\.htm|i\d+\.htm)[^"']*)/i,
  );
  if (m2) {
    const c = toCanonical(m2[1]);
    if (c) return c;
  }

  // ④ meta refresh 跳转
  const mMeta = decoded.match(
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=(https?:\/\/[^"'\s>]+)/i,
  );
  if (mMeta) {
    const c = toCanonical(mMeta[1]);
    if (c) return c;
    if (/taobao|tmall/i.test(mMeta[1]) && !/error\.item/i.test(mMeta[1])) {
      return mMeta[1].replace(/["'\s>]+$/, "");
    }
  }

  // ⑤ 短链落地页裸 itemId（仅短链场景启用，避免普通页面误匹配）
  //    淘宝 itemId 通常 12-13 位，放宽到 11-16 位兜底
  //    额外要求：必须是独立数字串（前后有引号/标点），且页面含淘宝特征词
  if (isShortLink) {
    const idM = decoded.match(/["'(>\s=:](\d{11,16})["'\s)<,]/);
    if (idM && /taobao|tmall|tb\.cn|alicdn/i.test(decoded)) {
      return `https://item.taobao.com/item.htm?id=${idM[1]}`;
    }
  }

  return null;
}

/* ── 服装识别 ── */
const CLOTHING_KEYWORDS = [
  "T恤","短袖","衬衫","卫衣","连帽","毛衣","针织","夹克","大衣","风衣","西装",
  "连衣裙","半身裙","短裙","长裙","裤子","牛仔裤","休闲裤","短裤","背心","吊带",
  "无袖","上衣","外套","裙","tee","shirt","dress","hoodie","jacket","coat",
  "sweater","pants",
];
const REGION_VALUES = ["upper", "lower", "full"];

/** 从标题关键词推断试衣覆盖区域（不再经过服装类型中间量） */
function detectRegion(title) {
  const s = (title || "").toLowerCase();
  if (/连衣裙|套装|连体|长裙|dress|suit|jumpsuit/.test(s)) return "full";
  if (/半身裙|短裙|裙|裤子|牛仔裤|休闲裤|西裤|短裤|pants|skirt|jeans|shorts/.test(s)) return "lower";
  if (/衬衫|卫衣|连帽|毛衣|针织|大衣|风衣|西装|外套|夹克|背心|吊带|无袖|上衣|t恤|短袖|tee|shirt|hoodie|coat|jacket|sweater|polo/.test(s)) return "upper";
  return "upper";
}

export function makeGarment(name, region) {
  return {
    id: `g-${Date.now().toString(36)}`,
    name: name || "服装",
    region: REGION_VALUES.includes(region) ? region : "upper",
  };
}
function isClothingTitle(t) {
  const s = (t || "").toLowerCase();
  return CLOTHING_KEYWORDS.some((k) => s.includes(k.toLowerCase()));
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

/**
 * 淘宝/天猫链接自动带上登录态 Cookie，其它平台不带
 *
 * 关键：Referer 必须按目标域名区分！
 *   - tmall.com → Referer: https://www.tmall.com/
 *   - taobao.com / tb.cn → Referer: https://www.taobao.com/
 * 否则 item.taobao.com 302 跳转到 detail.tmall.com 时，天猫反爬会
 * 检测到跨站 Referer（taobao.com），直接返回 5047B login 拦截页。
 * （实测：同 cookie 同 UA，taobao Referer 被拦截，tmall Referer 拿到 55KB 正常页）
 */
function requestHeaders(url) {
  const h = { ...FETCH_HEADERS };
  if (/tmall\.com/i.test(url)) {
    h.Referer = "https://www.tmall.com/";
  } else {
    h.Referer = "https://www.taobao.com/";
  }
  if (HAS_COOKIE && /taobao\.com|tmall\.com/i.test(url)) {
    h.Cookie = TAOBAO_COOKIE;
  }
  return h;
}
export { requestHeaders };

/**
 * 智能重定向抓取：手动跟随 301/302/303/307/308，每一跳都根据当前 URL 域名
 * 重新计算 Referer 与 Cookie。fetch 默认的 redirect:"follow" 不会在跳转时
 * 更新 headers，这是淘宝→天猫跨站跳转被反爬拦截的根因。
 *
 * 最多跟随 5 跳，防止无限重定向。
 */
async function fetchWithSmartRedirect(url, { headers, ...rest } = {}) {
  let currentUrl = url;
  let resp = await fetch(currentUrl, {
    ...rest,
    headers: headers || requestHeaders(currentUrl),
    redirect: "manual",
  });
  let hops = 0;
  while (
    resp.status >= 300 &&
    resp.status < 400 &&
    hops < 5
  ) {
    const location = resp.headers.get("location");
    if (!location) break;
    // 关键：跟随跳转后，用新 URL 重新计算 headers（Referer / Cookie 按域名区分）
    currentUrl = new URL(location, currentUrl).href;
    // 如果调用方显式传了 headers，只更新 Referer；否则用 requestHeaders 全量重建
    const nextHeaders = headers
      ? { ...headers, Referer: /tmall\.com/i.test(currentUrl) ? "https://www.tmall.com/" : "https://www.taobao.com/" }
      : requestHeaders(currentUrl);
    resp = await fetch(currentUrl, { ...rest, headers: nextHeaders, redirect: "manual" });
    hops++;
  }
  return { resp, finalUrl: currentUrl, hops };
}

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

  // 天猫新详情页（detail.tmall.com）把真实标题放在
  // <span class="mainTitle--xxxxx" title="商品标题"> 里，<title> 只有"商品详情"。
  // 用正则从 HTML 直接提取，避免 cheerio 对动态 class 的处理开销。
  if (!title || title === "商品详情" || title === "商品详情-天猫Tmall.com") {
    const mainTitleM = html.match(
      /<span[^>]*class="[^"]*mainTitle[^"]*"[^>]*title="([^"]{4,200})"/i,
    );
    if (mainTitleM) title = mainTitleM[1].trim();
  }

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
 * 诊断跳转页：提取 window.location.href 目标、识别特殊错误页。
 * 用于在日志中直接看到 5047B 跳转页到底是什么，免去猜测。
 *
 * 返回 { kind, redirectUrl, detail }：
 *   kind = "noitem"   → 商品不存在/已下架（error.item.taobao.com/error/noitem）
 *   kind = "login"    → Cookie 已失效（跳转 login.m.taobao.com）
 *   kind = "captcha"  → 被反爬（含验证码/滑块）
 *   kind = "redirect" → 正常跳转页，redirectUrl 为跳转目标
 *   kind = "unknown"  → 未识别
 */
function diagnoseInterstitial(html) {
  const out = { kind: "unknown", redirectUrl: "", detail: "" };
  if (!html) return out;

  // 提取 window.location.href = "..." / location.replace("...") / location.assign("...")
  const urlM =
    html.match(/(?:window\.)?location\.(?:href|replace|assign)\s*=\s*["']([^"']+)["']/i) ||
    html.match(/location\.(?:href|replace|assign)\s*\(\s*["']([^"']+)["']\s*\)/i);
  if (urlM) out.redirectUrl = urlM[1];

  // 识别特殊页面
  const lower = html.toLowerCase();
  if (html.includes("error/noitem") || html.includes("error.item.taobao.com")) {
    out.kind = "noitem";
    out.detail = "商品不存在或已下架";
  } else if (html.includes("login.m.taobao.com") || /login\s*\.\s*taobao/i.test(html)) {
    out.kind = "login";
    out.detail = "Cookie 已失效，需重新登录淘宝复制 Cookie";
  } else if (html.includes("验证码") || html.includes("安全验证") || html.includes("滑块") || /captcha/i.test(lower)) {
    out.kind = "captcha";
    out.detail = "被淘宝反爬拦截，请稍后重试或更换网络";
  } else if (out.redirectUrl) {
    out.kind = "redirect";
    out.detail = "JS 跳转页";
  }
  return out;
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
  console.log(`[parse] Vision result: title="${rec.title}" price=${rec.price} region=${rec.region}`);

  const garments = [];
  if (rec.region) {
    garments.push(makeGarment(rec.title || "服装", rec.region));
  } else if (rec.title && isClothingTitle(rec.title)) {
    garments.push(makeGarment(rec.title, detectRegion(rec.title)));
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
    // 使用 smart redirect：每跳重新设置 Referer/Cookie，避免跨站跳转被反爬拦截
    const { resp: resp1, finalUrl: fu1 } = await fetchWithSmartRedirect(url);
    if (!resp1.ok) throw new Error(`抓取失败：HTTP ${resp1.status}`);
    let h1 = await resp1.text();
    finalUrl = fu1;

    // 短链解析：从落地页 HTML 提取真实商品页链接，二次带 Cookie 抓取（拿到真实详情）
    const resolved = extractRedirectTarget(h1, url);
    if (resolved && resolved !== url) {
      finalUrl = resolved;
      try {
        const { resp: resp2 } = await fetchWithSmartRedirect(resolved);
        if (resp2.ok) h1 = await resp2.text();
      } catch {
        /* 二次抓取失败则沿用第一跳 HTML */
      }
    }
    html = h1;

    // 桌面端 UA 可能拿到天猫/淘宝的 JS 中间跳转页（非真实商品数据）。
    // 手机分享短链（m.tb.cn / e.tb.cn）落地页也是跳转页，跳转目标常是
    // 移动端商品页 a.m.taobao.com/i{id}.htm。
    // 处理顺序：① 先诊断跳转页类型（noitem/login/captcha/redirect）
    //          ② 正常 redirect → 用增强提取取真实商品链接 → 带 Cookie 二次抓取
    //          ③ 提取不到 → 移动端 UA 重试（兜底）
    //          ④ 仍失败 → 走轻量详情接口 / 视觉识别 / 兜底
    //          注意：smart redirect 已经解决了 item.taobao.com → detail.tmall.com
    //          跨站跳转 Referer 不更新的问题，login interstitial 在 smart redirect
    //          下若仍出现才视为真正 cookie 失效。
    if (isInterstitialPage(html, finalUrl) && /taobao|tmall/i.test(finalUrl)) {
      const diag = diagnoseInterstitial(html);
      console.log(
        `[parse] Detected interstitial page (${html.length}B), kind=${diag.kind}` +
          (diag.redirectUrl ? `, redirectUrl=${diag.redirectUrl.slice(0, 80)}` : "") +
          (diag.detail ? `, ${diag.detail}` : ""),
      );

      // noitem/captcha：明确报错，不再盲目重试
      if (diag.kind === "noitem") {
        throw new Error("商品不存在或已下架，请检查链接是否正确");
      }
      if (diag.kind === "captcha") {
        throw new Error("被淘宝反爬拦截（验证码），请稍后重试或更换网络环境");
      }

      // ① redirect/login 类型：从跳转页 HTML 提取真实商品链接，smart redirect 二次抓取
      //    login 类型不直接报错——可能是中间页跳转链路问题，先尝试提取真实 URL 重新抓
      const resolved2 = extractRedirectTarget(html, finalUrl);
      if (resolved2 && resolved2 !== finalUrl) {
        console.log(`[parse] Resolved real URL from interstitial: ${resolved2.slice(0, 80)}`);
        try {
          const { resp: resp2, finalUrl: fu2 } = await fetchWithSmartRedirect(resolved2);
          if (resp2.ok) {
            const h2 = await resp2.text();
            if (!isInterstitialPage(h2, fu2)) {
              console.log(`[parse] Second fetch got ${h2.length}B real product HTML (finalUrl=${fu2.slice(0, 60)})`);
              html = h2;
              finalUrl = fu2;
            } else {
              // 二次抓取仍是跳转页，诊断一下
              const diag2 = diagnoseInterstitial(h2);
              console.log(`[parse] Second fetch still interstitial: kind=${diag2.kind}${diag2.redirectUrl ? ", url=" + diag2.redirectUrl.slice(0, 60) : ""}`);
              if (diag2.kind === "noitem") throw new Error("商品不存在或已下架，请检查链接是否正确");
              if (diag2.kind === "login") throw new Error("淘宝 Cookie 已失效，请重新登录淘宝并更新 server/.env 中的 TAOBAO_COOKIE");
            }
          }
        } catch (e) {
          // noitem/login 明确错误需要抛出，网络错误继续尝试移动端
          if (String(e.message).includes("Cookie 已失效") || String(e.message).includes("商品不存在")) throw e;
          /* 二次抓取失败，继续尝试移动端重试 */
        }
      } else {
        console.log(`[parse] extractRedirectTarget returned null, html head: ${html.substring(0, 200).replace(/\n/g, " ")}`);
      }

      // ② 仍是 interstitial → 移动端 UA 重试兜底（smart redirect）
      if (isInterstitialPage(html, finalUrl)) {
        console.log(`[parse] Still interstitial, retrying with mobile UA on ${finalUrl.slice(0, 60)}...`);
        try {
          const mobileHeaders = { ...requestHeaders(finalUrl), ...MOBILE_HEADERS };
          delete mobileHeaders.Cookie; // 移动端 Cookie 格式不同，避免冲突
          const { resp: respM, finalUrl: fuM } = await fetchWithSmartRedirect(finalUrl, {
            headers: mobileHeaders,
          });
          if (respM.ok) {
            const hMobile = await respM.text();
            if (!isInterstitialPage(hMobile, fuM)) {
              console.log(`[parse] Mobile UA got ${hMobile.length}B HTML (was ${html.length}B)`);
              html = hMobile;
              finalUrl = fuM;
            } else {
              const diagM = diagnoseInterstitial(hMobile);
              console.log(`[parse] Mobile UA still interstitial: kind=${diagM.kind}${diagM.redirectUrl ? ", url=" + diagM.redirectUrl.slice(0, 60) : ""}`);
            }
          }
        } catch {
          /* mobile retry failed, stick with desktop result */
        }
      }

      // ③ smart redirect + 移动端都失败后，若是 login 类型才报 cookie 失效
      if (isInterstitialPage(html, finalUrl)) {
        const diagFinal = diagnoseInterstitial(html);
        if (diagFinal.kind === "login") {
          throw new Error("淘宝 Cookie 已失效，请重新登录淘宝并更新 server/.env 中的 TAOBAO_COOKIE");
        }
      }
    }
  } catch (e) {
    // 明确错误（商品不存在 / Cookie 失效 / 反爬拦截）需传播给用户，不吞掉
    const msg = String(e?.message || "");
    if (msg.includes("商品不存在") || msg.includes("Cookie 已失效") || msg.includes("反爬拦截")) {
      throw e;
    }
    // 其它网络错误：降级为空 html，走兜底
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
      garments.push({
        id: `g-${Date.now().toString(36)}`,
        name: title,
        region: detectRegion(title),
      });
    }
  } else {
    // 购物平台商品链接：用户粘贴的目的就是衣服，默认当作可试衣。
    // 标题命中服装关键词 → 自动识别；否则交给端上手动选择，绝不再硬拒。
    isClothing = true;
    if (autoClothing) {
      garments.push({
        id: `g-${Date.now().toString(36)}`,
        name: title,
        region: detectRegion(title),
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
    itemId: extractItemId(finalUrl),
    cookieUsed: HAS_COOKIE && /taobao|tmall/.test(platform),
  };
}
