/**
 * 图片压缩工具：统一处理上传/拍照/试衣合成前的图片尺寸与格式。
 *
 * 背景：手机拍照原图动辄 3000x4000+（几 MB），
 * - iOS Safari 对 canvas 总像素数有严格限制（大图 toDataURL 会抛异常或返回空字符串）
 * - PNG 无损压缩对照片极不友好，3024x4032 的 PNG 可能 20MB+
 * - 直接把原图 dataURL 发给后端会拖慢请求、甚至超时
 *
 * 因此在前端统一把图片压到长边 ≤ MAX_EDGE、JPEG quality 0.85，
 * 既保证画质（AI 试衣模型本身输入分辨率有限），又彻底规避大图导致的各类问题。
 */

/** 默认最大长边：试衣模型输入 1024 量级足够，1280 留余量兼顾清晰度 */
const DEFAULT_MAX_EDGE = 1280;
/** 默认 JPEG 质量 */
const DEFAULT_QUALITY = 0.85;

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

/**
 * 把已加载的 HTMLImageElement 压缩为 JPEG dataURL。
 * 长边超过 maxEdge 时按比例缩放；不超过则保持原尺寸。
 */
export function imgElToCompressedDataUrl(
  img: HTMLImageElement | HTMLCanvasElement,
  maxEdge: number = DEFAULT_MAX_EDGE,
  quality: number = DEFAULT_QUALITY,
): string {
  const naturalW =
    (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width;
  const naturalH =
    (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height;
  if (!naturalW || !naturalH) {
    throw new Error("无法读取图片尺寸");
  }

  let w = naturalW;
  let h = naturalH;
  const longest = Math.max(w, h);
  if (longest > maxEdge) {
    const k = maxEdge / longest;
    w = Math.round(w * k);
    h = Math.round(h * k);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d 上下文不可用");
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  // 照片统一用 JPEG：体积小、兼容性好；PNG 仅适合含透明通道的图形
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * 把任意 dataURL（JPEG/PNG/HEIC 转换后的 JPEG 等）压缩为标准 JPEG dataURL。
 * 用于 SelfieUpload 上传/拍照后立即压缩，保证状态里存的是小图。
 */
export async function compressDataUrl(
  dataUrl: string,
  maxEdge: number = DEFAULT_MAX_EDGE,
  quality: number = DEFAULT_QUALITY,
): Promise<string> {
  const img = await loadImageEl(dataUrl);
  return imgElToCompressedDataUrl(img, maxEdge, quality);
}
