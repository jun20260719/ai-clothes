import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });
import express from "express";
import cors from "cors";
import { parseProductPage, makeGarment, extractItemId } from "./parse.js";
import { runTryOn, resolveToDataUrl } from "./tryon.js";
import { visionConfigured, visionModel, estimateBodyFromImage, recognizeProductImage } from "./vision.js";

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));
// 图片以 base64 dataURL 上传，需放大请求体上限
app.use(express.json({ limit: "30mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    tryonConfigured: !!process.env.IMAGE_API_KEY && !!process.env.IMAGE_MODEL,
    model: process.env.IMAGE_MODEL || "",
    baseUrl: process.env.IMAGE_BASE_URL || "https://api.openai.com/v1",
    visionConfigured,
    visionModel,
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 商品链接解析结果缓存
 * 相同商品（按 itemId / 规范 URL 归一化）命中即直接返回，避免每次都重新
 * 抓取页面 + 请求 AI 视觉模型识别，既省耗时又省额度。
 * - 进程内内存缓存，重启/重部署自动清空（可接受的简单策略）。
 * - TTL 默认 6 小时，可用环境变量 PARSE_CACHE_TTL（单位：小时）覆盖。
 * - 读取时清理过期项，并对超大缓存做兜底收缩，避免内存无限增长。
 * ──────────────────────────────────────────────────────────────────────── */
const parseCache = new Map(); // key -> { expires, product }
const PARSE_CACHE_TTL = (Number(process.env.PARSE_CACHE_TTL) || 6) * 60 * 60 * 1000;

function parseCacheKey(url) {
  const id = extractItemId(url); // 淘宝 num_iid / itemId 等 → 同一商品不同 UTMs 共享缓存
  if (id) return `item:${id}`;
  // 退化为规范 URL：去掉末尾斜杠与常见无效 query，降低重复缓存
  try {
    const u = new URL(url);
    u.hash = "";
    return `url:${u.toString().replace(/\/$/, "")}`;
  } catch {
    return `url:${url.replace(/\/+$/, "")}`;
  }
}

function pruneParseCache() {
  const now = Date.now();
  if (parseCache.size > 300) {
    // 容量兜底：超阈值时整体重建仅保留未过期项
    const kept = new Map();
    for (const [k, v] of parseCache) if (v.expires > now) kept.set(k, v);
    parseCache.clear();
    for (const [k, v] of kept) parseCache.set(k, v);
  } else {
    for (const [k, v] of parseCache) if (v.expires <= now) parseCache.delete(k);
  }
}

// ① 真实商品链接解析（带缓存）
app.get("/api/parse", async (req, res) => {
  const url = (req.query.url || "").toString().trim();
  if (!url) return res.status(400).json({ ok: false, error: "缺少 url 参数" });

  const key = parseCacheKey(url);
  pruneParseCache();
  const hit = parseCache.get(key);
  if (hit && hit.expires > Date.now()) {
    console.log(`[parse] cache HIT (${key})`);
    return res.json({ ok: true, product: hit.product, mock: false, cached: true });
  }

  try {
    const product = await parseProductPage(url);
    // 预取商品主图并转为 dataURL 一并返回：
    // 避免「生成试衣」时才临时拉取外链图，首次拉取失败会回退到通用衣服（mock），
    // 只有再试一次才用真实商品图。解析阶段用户正在填自拍/身体数据，有充足时间。
    if (product?.imageUrl && /^https?:/i.test(product.imageUrl)) {
      const dataUrl = await resolveToDataUrl(product.imageUrl);
      if (dataUrl) product.imageUrl = dataUrl;
    }
    parseCache.set(key, { expires: Date.now() + PARSE_CACHE_TTL, product });
    res.json({ ok: true, product, mock: false, cached: false });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || "解析失败" });
  }
});

// ② AI 试衣（OpenAI 兼容图像生成，需配置 IMAGE_API_KEY / IMAGE_MODEL）
app.post("/api/tryon", async (req, res) => {
  const { selfie, garment, measurements, productImage, feedback } = req.body || {};
  if (!selfie) {
    return res.status(400).json({ ok: false, error: "缺少 selfie（自拍照）" });
  }
  try {
    const { image } = await runTryOn({ selfie, garment, measurements, productImage, feedback });
    res.json({ ok: true, image });
  } catch (e) {
    res.status(e.code === "NO_TOKEN" || e.code === "NO_MODEL" ? 503 : 502).json({
      ok: false,
      code: e.code,
      error: e.message,
    });
  }
});

// ③ AI 识别身体数据（上传全身照 → 视觉模型估算身高/体重/三围/肩宽）
app.post("/api/estimate-body", async (req, res) => {
  const { image } = req.body || {};
  if (!image) {
    return res.status(400).json({ ok: false, error: "缺少 image（人物照片）" });
  }
  if (!visionConfigured) {
    return res
      .status(503)
      .json({ ok: false, code: "NO_VISION", error: "未配置视觉识别模型（VISION_API_KEY / VISION_MODEL）" });
  }
  try {
    const measurements = await estimateBodyFromImage(image);
    if (!measurements) {
      return res
        .status(502)
        .json({ ok: false, error: "身体数据识别失败，请手动填写或换一张更清晰的全身照" });
    }
    res.json({ ok: true, measurements });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || "识别失败" });
  }
});

// ④ 商品图视觉识别（上传图片 / 链接主图 → 自动识别服装信息与试衣部位，并返回服装视觉细节描述）
app.post("/api/recognize", async (req, res) => {
  const { image } = req.body || {};
  if (!image) {
    return res.status(400).json({ ok: false, error: "缺少 image（商品图片）" });
  }
  if (!visionConfigured) {
    return res
      .status(503)
      .json({ ok: false, code: "NO_VISION", error: "未配置视觉识别模型（VISION_API_KEY / VISION_MODEL）" });
  }
  try {
    const rec = await recognizeProductImage(image);
    // 识别到任意有效服装信息（标题或细节描述其一存在即视为识别成功）。
    // region 缺失时默认 upper，避免模型偶尔漏返 region 而被误判为「无法识别」。
    const hasInfo = !!(rec && (rec.title || rec.detail));
    if (!hasInfo) {
      return res.json({ ok: true, recognized: false, garment: null });
    }
    // 识别阶段一次性产出 region + detail（服装视觉细节），前端可编辑后传给 /api/tryon，
    // 省去试衣时的二次视觉提取调用。
    const garment = makeGarment(rec.title || "服装", rec.region || "upper", rec.detail || "");
    res.json({ ok: true, recognized: true, garment });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || "识别失败" });
  }
});

// ⑤ 托管前端构建产物（app 的 `npm run build` 已输出到 server/public）
// 必须放在所有 /api 路由「之后」：静态资源与 SPA fallback 才不会拦截 API 请求
const PUBLIC_DIR = join(__dirname, "public");
if (existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  // SPA fallback：处理前端路由（如 /product/123）的直接访问与刷新，
  // 由前端 Router 接管；非静态文件且非 /api 的请求统一返回 index.html
  app.get("*", (_req, res) => {
    res.sendFile(join(PUBLIC_DIR, "index.html"));
  });
  console.log(`[tryon-backend] 前端静态托管已启用：server/public`);
} else {
  console.log(
    "[tryon-backend] 未检测到 server/public，前端未托管。请先运行：cd app && npm run build",
  );
}

app.listen(PORT, () => {
  console.log(`[tryon-backend] 监听 http://localhost:${PORT}`);
  console.log(
    `[tryon-backend] 淘宝登录态 Cookie: ${
      process.env.TAOBAO_COOKIE && process.env.TAOBAO_COOKIE.trim()
        ? "已配置（将用于淘宝/天猫真实解析）"
        : "未配置（淘宝/天猫将走 OG 抓取 + 手动选服装兜底）"
    }`,
  );
  console.log(
    `[tryon-backend] AI 试衣: ${
      process.env.IMAGE_API_KEY && process.env.IMAGE_MODEL
        ? "已配置 (" + (process.env.IMAGE_MODEL || "") + " @ " + (process.env.IMAGE_BASE_URL || "https://api.openai.com/v1") + ")"
        : "未配置（前端将回退 Canvas 预览）"
    }`,
  );
  console.log(
    `[tryon-backend] 商品图视觉识别: ${
      visionConfigured
        ? "已配置 (" + visionModel + "，用于自动补全标题/价格/服装)"
        : "未配置（解析拿不全时回退手动选择）"
    }`,
  );
});
