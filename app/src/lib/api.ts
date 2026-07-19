import type { ParsedProduct } from "@/types";

/** 后端基地址：默认同源 /api（开发经 Vite 代理；生产可经 VITE_API_BASE 指定） */
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) || "/api";

/** 调用后端真实解析商品链接 */
export async function parseViaApi(url: string): Promise<ParsedProduct> {
  const resp = await fetch(
    `${API_BASE}/parse?url=${encodeURIComponent(url)}`,
    { headers: { Accept: "application/json" } },
  );
  const data = await resp.json();
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || `解析失败 (${resp.status})`);
  }
  return data.product as ParsedProduct;
}

export interface TryOnApiPayload {
  selfie: string; // dataURL 自拍照
  garment: {
    type: string;
    color: string;
    region: "upper" | "lower" | "full";
  };
  measurements: Record<string, string>;
  /** 商品主图（URL 或 dataURL）；提供时后端走「换脸式」试衣，保留商品图姿势/服装 */
  productImage?: string;
}

/** 调用后端 AI 试衣模型 */
export async function tryOnViaApi(
  payload: TryOnApiPayload,
): Promise<{ image: string }> {
  // 超时控制：后端链路较长（拉商品图 + 视觉提取 + 图像生成），手机网络下可能 60-90s。
  // 不设超时的话，移动浏览器/中间网关会在自己的超时阈值悄悄掐断连接 →
  // fetch reject 一个无意义的网络错误，前端误以为"接口没发出去"。
  // 120s 足够覆盖正常生成耗时，超时则明确报错便于重试。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/tryon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("试衣请求超时（120s），请重试");
    }
    throw new Error(`网络错误：${e instanceof Error ? e.message : String(e)}`);
  }
  clearTimeout(timer);
  const data = await resp.json();
  if (!resp.ok || !data.ok) {
    const e = new Error(data.error || `试衣失败 (${resp.status})`);
    (e as Error & { code?: string }).code = data.code;
    throw e;
  }
  return { image: data.image as string };
}

/** AI 识别身体数据：上传人物照片（dataURL），视觉模型估算身高/体重/三围/肩宽 */
export interface BodyEstimate {
  gender: "female" | "male" | "";
  height: number | null;
  weight: number | null;
  bust: number | null;
  waist: number | null;
  hips: number | null;
  shoulder: number | null;
}

export async function estimateBodyViaApi(image: string): Promise<BodyEstimate> {
  const resp = await fetch(`${API_BASE}/estimate-body`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.ok) {
    const e = new Error(data.error || `识别失败 (${resp.status})`);
    (e as Error & { code?: string }).code = data.code;
    throw e;
  }
  return data.measurements as BodyEstimate;
}
