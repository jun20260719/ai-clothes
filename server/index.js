import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env") });
import express from "express";
import cors from "cors";
import { parseProductPage } from "./parse.js";
import { runTryOn, resolveToDataUrl } from "./tryon.js";
import { visionConfigured, visionModel } from "./vision.js";

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

// ① 真实商品链接解析
app.get("/api/parse", async (req, res) => {
  const url = (req.query.url || "").toString().trim();
  if (!url) return res.status(400).json({ ok: false, error: "缺少 url 参数" });
  try {
    const product = await parseProductPage(url);
    // 预取商品主图并转为 dataURL 一并返回：
    // 避免「生成试衣」时才临时拉取外链图，首次拉取失败会回退到通用衣服（mock），
    // 只有再试一次才用真实商品图。解析阶段用户正在填自拍/身体数据，有充足时间。
    if (product?.imageUrl && /^https?:/i.test(product.imageUrl)) {
      const dataUrl = await resolveToDataUrl(product.imageUrl);
      if (dataUrl) product.imageUrl = dataUrl;
    }
    res.json({ ok: true, product, mock: false });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || "解析失败" });
  }
});

// ② AI 试衣（OpenAI 兼容图像生成，需配置 IMAGE_API_KEY / IMAGE_MODEL）
app.post("/api/tryon", async (req, res) => {
  const { selfie, garment, measurements, productImage } = req.body || {};
  if (!selfie) {
    return res.status(400).json({ ok: false, error: "缺少 selfie（自拍照）" });
  }
  try {
    const { image } = await runTryOn({ selfie, garment, measurements, productImage });
    res.json({ ok: true, image });
  } catch (e) {
    res.status(e.code === "NO_TOKEN" || e.code === "NO_MODEL" ? 503 : 502).json({
      ok: false,
      code: e.code,
      error: e.message,
    });
  }
});

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
