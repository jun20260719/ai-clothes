/**
 * 商品图视觉识别（多模态兜底）
 * --------------------------------------------------
 * 当 HTML 文本提取拿不全（标题/价格/服装类型缺失）但已有商品主图时，
 * 把商品图发给一个「能读图」的多模态模型，结构化识别出：
 *   { title, price, garmentType, color, region }
 * 并回填到解析结果，免去用户手动选择。
 *
 * 默认复用 Agnes 的 agnes-2.0-flash（与画图模型 agnes-image-2.0-flash 同 Key、同 Base URL，
 * 走 OpenAI 兼容 /v1/chat/completions，支持 image_url 输入、可做结构化提取）。
 * 可通过 VISION_BASE_URL / VISION_API_KEY / VISION_MODEL 覆盖。
 */
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env") });
import process from "process";

const VISION_BASE_URL = (
  process.env.VISION_BASE_URL ||
  process.env.IMAGE_BASE_URL ||
  "https://apihub.agnes-ai.com/v1"
).replace(/\/+$/, "");
const VISION_API_KEY = process.env.VISION_API_KEY || process.env.IMAGE_API_KEY || "";
const VISION_MODEL = process.env.VISION_MODEL || "agnes-2.0-flash";

/** 允许的服装类型（与前端 GarmentType 对齐） */
const GARMENT_TYPES = [
  "tshirt", "shirt", "hoodie", "sweater", "jacket", "coat",
  "dress", "skirt", "pants", "shorts", "tanktop", "other",
];

/** 中文颜色词 → HEX（与前端 COLOR_RULES 一致） */
const COLOR_MAP = {
  黑: "#1f2937", 白: "#f3f4f6", 红: "#ef4444", 蓝: "#2563eb", 天蓝: "#0ea5e9",
  绿: "#10b981", 粉: "#ec4899", 紫: "#7c3aed", 灰: "#64748b", 黄: "#f59e0b",
  棕: "#a16207", 橙: "#f97316",
};

function nearestColor(word) {
  if (!word) return "#7c3aed";
  for (const [k, v] of Object.entries(COLOR_MAP)) if (word.includes(k)) return v;
  return "#7c3aed";
}

/**
 * 把图片输入转成 OpenAI 兼容的 image_url 内容块。
 * - 远程 http(s) 图：先服务端下载转 dataURL（规避淘宝/天猫防盗链，让模型直接读字节）；
 *   下载失败或过大（>5MB）则退回原 URL，交给模型侧去拉。
 * - dataURL：原样发出。
 */
async function toImageContent(imageInput) {
  if (typeof imageInput === "string" && /^https?:\/\//i.test(imageInput)) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(imageInput, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Referer: "https://www.taobao.com/",
        },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) return { type: "image_url", image_url: { url: imageInput } };
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 5 * 1024 * 1024) {
        return { type: "image_url", image_url: { url: imageInput } };
      }
      const mime = r.headers.get("content-type") || "image/jpeg";
      return {
        type: "image_url",
        image_url: { url: `data:${mime};base64,${buf.toString("base64")}` },
      };
    } catch {
      return { type: "image_url", image_url: { url: imageInput } };
    }
  }
  return { type: "image_url", image_url: { url: imageInput } };
}

function parseVisionJson(text, reasoningContent) {
  if (!text && !reasoningContent) return null;
  // 优先从正式回答中提取；若为空（推理模型常因 token 不够导致 content 为空），
  // 则从推理内容中尝试提取 JSON 兜底。
  const raw = (text || reasoningContent || "").trim();
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const obj = m ? JSON.parse(m[0]) : null;
    if (!obj || typeof obj !== "object") return null;

    const type = GARMENT_TYPES.includes(obj.garmentType) ? obj.garmentType : "other";
    const colorWord = typeof obj.color === "string" ? obj.color : "";
    const color = nearestColor(colorWord);
    const region =
      obj.region === "upper" || obj.region === "lower" || obj.region === "full"
        ? obj.region
        : type === "dress" || type === "coat"
          ? "full"
          : type === "skirt" || type === "pants" || type === "shorts"
            ? "lower"
            : "upper";
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    const priceRaw = obj.price == null || obj.price === "" ? null : Number(obj.price);
    const price = Number.isFinite(priceRaw) ? priceRaw : null;

    return { title, price, garmentType: type, color, colorWord, region };
  } catch {
    return null;
  }
}

/**
 * 识别商品图 → 结构化结果。失败/未配置时返回 null（调用方回退到手动选择）。
 * @param {string} imageInput 图片 URL 或 dataURL
 */
export async function recognizeProductImage(imageInput, { timeoutMs } = {}) {
  const effectiveTimeout = timeoutMs || Number(process.env.VISION_TIMEOUT) || 20000;
  if (!VISION_API_KEY || !imageInput) {
    console.log(`[vision] SKIP: hasKey=${!!VISION_API_KEY} hasImage=${!!imageInput}`);
    return null;
  }
  console.log(`[vision] Recognizing product image... model=${VISION_MODEL} timeout=${effectiveTimeout}`);
  const imageContent = await toImageContent(imageInput);

  const prompt = `你是一个电商商品识别助手。请仔细观察这张商品主图，提取该商品的结构化信息。
只返回一个 JSON 对象（不要任何解释、不要代码块标记），字段如下：
{
  "title": "商品标题，提炼核心款式/材质/颜色，如「纯棉圆领短袖T恤」，无法判断则填空字符串",
  "price": 数值（单位元），无法判断则填 null,
  "garmentType": "从以下选一：tshirt, shirt, hoodie, sweater, jacket, coat, dress, skirt, pants, shorts, tanktop, other",
  "color": "服装主色的中文词，如 白/黑/红/蓝/粉，无法判断填空字符串",
  "region": "upper（上装）或 lower（下装）或 full（连衣裙/全身）"
}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), effectiveTimeout);
  try {
    const resp = await fetch(`${VISION_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VISION_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          { role: "system", content: "你是电商商品识别助手，只输出 JSON。" },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              imageContent,
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      console.warn(`[vision] HTTP ${resp.status}: ${errBody.substring(0, 300)}`);
      return null;
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || "";
    const reasoning = data?.choices?.[0]?.message?.reasoning_content || "";
    console.log(`[vision] API ${resp.status} content=${text.length}chars reasoning=${reasoning.length}chars`);
    return parseVisionJson(text, reasoning);
  } catch (e) {
    console.warn(`[vision] Failed: ${e?.message || e} (code=${e?.code || 'N/A'})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const visionConfigured = !!VISION_API_KEY;
export const visionModel = VISION_MODEL;
