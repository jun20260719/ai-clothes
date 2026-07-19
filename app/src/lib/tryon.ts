import type { BodyMeasurements, Garment, TryOnResult } from "@/types";
import { garmentDataUrl } from "./garments";
import { tryOnViaApi } from "./api";

export interface TryOnOptions {
  selfie: HTMLImageElement | HTMLCanvasElement;
  garment: Garment;
  measurements: BodyMeasurements;
  /** 商品主图（URL / dataURL）；提供时走「换脸式」试衣，保留商品图姿势/服装 */
  productImageUrl?: string | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 依据身体数据计算逼真度评分与缺失项 */
export function scoreQuality(m: BodyMeasurements): { quality: number; missing: string[] } {
  let q = 40;
  const missing: string[] = [];
  if (m.gender) q += 6; else missing.push("性别");
  if (m.height) q += 8; else missing.push("身高");
  if (m.weight) q += 7; else missing.push("体重");
  if (m.bust) q += 9; else missing.push("胸围");
  if (m.waist) q += 8; else missing.push("腰围");
  if (m.hips) q += 8; else missing.push("臀围");
  if (m.shoulder) q += 7; else missing.push("肩宽");
  return { quality: Math.min(100, q), missing };
}

/**
 * 试衣合成引擎（前端 MVP — 智能预览版）
 *
 * 生产环境应替换为基于 AI 模型的真实试衣（保持用户脸/身/姿势）：
 *   - IDM-VTON / OOTDiffusion（开源，需 GPU 后端）
 *   - Replicate 等托管的虚拟试衣模型 API
 *   - WorkBuddy 多模态图像生成能力（图生图，保留人物特征）
 * 本函数用 Canvas 把服装按身体比例贴合到自拍躯干区域，
 * 作为零依赖、可离线运行的预览实现。
 */
export async function tryOn(opts: TryOnOptions): Promise<TryOnResult> {
  const { selfie, garment, measurements } = opts;
  const maxDim = 1000;
  const sw = (selfie as HTMLImageElement).naturalWidth || (selfie as HTMLCanvasElement).width;
  const sh = (selfie as HTMLImageElement).naturalHeight || (selfie as HTMLCanvasElement).height;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const W = Math.round(sw * scale);
  const H = Math.round(sh * scale);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // 1) 绘制自拍
  ctx.drawImage(selfie, 0, 0, W, H);

  // 2) 估算身体区域（假设正面居中肖像）
  const refShoulderW = 0.5; // 占画宽比例（肩部跨度）
  const genderFactor =
    measurements.gender === "male" ? 1.07 : measurements.gender === "female" ? 0.95 : 1;

  let wScale = genderFactor;
  if (garment.region === "upper" || garment.region === "full") {
    if (measurements.shoulder) wScale *= clamp(measurements.shoulder / 38, 0.82, 1.28);
    if (measurements.bust) wScale *= clamp(measurements.bust / 88, 0.85, 1.22);
  }
  if (garment.region === "lower" || garment.region === "full") {
    if (measurements.hips) wScale *= clamp(measurements.hips / 92, 0.82, 1.28);
    if (measurements.waist) wScale *= clamp(measurements.waist / 70, 0.85, 1.2);
  }

  // 垂直分区（占画高比例）
  const shoulderY = 0.24, waistY = 0.5, hipY = 0.62, kneeY = 0.82, ankleY = 0.97;
  let topY: number, bottomY: number;
  if (garment.region === "upper") {
    topY = shoulderY * H - H * 0.02;
    bottomY = hipY * H;
  } else if (garment.region === "lower") {
    topY = waistY * H;
    bottomY = ankleY * H;
  } else {
    topY = shoulderY * H - H * 0.02;
    bottomY = kneeY * H;
  }

  const boxW = W * refShoulderW * wScale;
  const boxH = bottomY - topY;
  const cx = W / 2;

  // 3) 加载服装图（SVG 无固有尺寸，使用已知 viewBox 比例 200:260）
  const gImg = await loadImage(garmentDataUrl(garment.type, garment.color));
  const gAspect = 200 / 260;

  // 4) 投影（让服装"贴"在身上而非悬浮）
  ctx.save();
  ctx.filter = "blur(8px)";
  ctx.globalAlpha = 0.28;
  ctx.drawImage(gImg, cx - boxW / 2 + 6, topY + 10, boxW, boxH * (260 / 200));
  ctx.restore();

  // 5) 绘制服装本体（按宽度贴合，居中）
  let drawW = boxW;
  let drawH = drawW / gAspect;
  if (garment.region === "full") {
    // 全身款拉伸以覆盖到脚踝区域
    drawH = boxH;
    drawW = drawH * gAspect;
  }
  const drawY = topY + (boxH - drawH) / 2;
  ctx.save();
  ctx.globalAlpha = 0.94;
  ctx.drawImage(gImg, cx - drawW / 2, drawY, drawW, drawH);
  ctx.restore();

  const { quality, missing } = scoreQuality(measurements);
  const note =
    missing.length > 0
      ? `已生成智能预览。补充「${missing.join("、")}」可获得更贴合的版型与更逼真的效果。`
      : "身体数据完整，版型贴合度较高。";

  return {
    dataUrl: canvas.toDataURL("image/png"),
    createdAt: Date.now(),
    quality,
    garment,
    note,
  };
}

/** 图像 → PNG dataURL */
function imgToDataUrl(img: HTMLImageElement | HTMLCanvasElement): string {
  const c = document.createElement("canvas");
  c.width = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width;
  c.height = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c.toDataURL("image/png");
}

/**
 * 试衣生成（智能路由）：
 * 优先调用后端 AI 试衣模型（返回照片级效果）；
 * 失败（无后端 / 未配置模型 / 网络异常）自动回退到本地 Canvas 智能预览。
 */
export async function generateTryOn(opts: TryOnOptions): Promise<TryOnResult> {
  const { selfie, garment, measurements, productImageUrl } = opts;
  const { quality, missing } = scoreQuality(measurements);
  try {
    const selfieUrl = imgToDataUrl(selfie);
    const { image } = await tryOnViaApi({
      selfie: selfieUrl,
      garment: { type: garment.type, color: garment.color, region: garment.region },
      measurements: measurements as unknown as Record<string, string>,
      productImage: productImageUrl || undefined,
    });
    return {
      imageUrl: image,
      createdAt: Date.now(),
      quality,
      garment,
      note: missing.length
        ? `AI 试衣完成。补充「${missing.join("、")}」可进一步优化版型贴合度。`
        : "AI 试衣完成，版型贴合度较高。",
    };
  } catch {
    return tryOn(opts);
  }
}
