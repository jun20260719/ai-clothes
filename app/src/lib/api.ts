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
  const resp = await fetch(`${API_BASE}/tryon`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok || !data.ok) {
    const e = new Error(data.error || `试衣失败 (${resp.status})`);
    (e as Error & { code?: string }).code = data.code;
    throw e;
  }
  return { image: data.image as string };
}
