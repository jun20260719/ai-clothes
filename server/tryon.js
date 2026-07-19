/* AI 试衣 · 图像生成接入（OpenAI 兼容风格）
 *
 * 当前默认对接 Agnes Image 2.0 Flash：
 *   POST {IMAGE_BASE_URL}/images/generations  （JSON 请求体）
 *   - 文生图：仅传 model / prompt / size
 *   - 图生图：把自拍照放进 extra_body.image（数组，支持 Data URI）
 *   - 输出格式：extra_body.response_format = "b64_json" | "url"
 * 详见 https://agnes-ai.com/zh-Hans/docs/agnes-image-20-flash
 *
 * 也兼容其它 OpenAI 风格网关：调整 IMAGE_BASE_URL / IMAGE_MODEL /
 * IMAGE_ENDPOINT 即可；若你的服务用 multipart 的 /images/edits 而非
 * extra_body.image，请参考代码注释里的改动点。
 *
 * 配置（见 .env.example）：
 *   IMAGE_BASE_URL    接口基地址，默认 https://apihub.agnes-ai.com/v1
 *   IMAGE_API_KEY     API Key
 *   IMAGE_MODEL       模型名，默认 agnes-image-2.0-flash
 *   IMAGE_ENDPOINT    端点路径，默认 /images/generations
 *   IMAGE_SIZE        生成尺寸，默认 1024x1024（Agnes 支持 1024x768/1024x1024/768x1024）
 *   IMAGE_INPUT_IMAGE 是否把自拍照作为图像输入传给模型（图生图，默认 true）
 *
 * 未配置 IMAGE_API_KEY / IMAGE_MODEL 时抛出明确错误，前端回退到本地 Canvas 预览。
 */

const COLOR_CN = {
  white: "白色", black: "黑色", red: "红色", blue: "蓝色", green: "绿色",
  yellow: "黄色", pink: "粉色", gray: "灰色", grey: "灰色", purple: "紫色",
  orange: "橙色", brown: "棕色", navy: "藏青色", beige: "米色",
};
const TYPE_CN = {
  tshirt: "T恤", shirt: "衬衫", dress: "连衣裙", coat: "大衣/外套",
  jacket: "夹克", hoodie: "卫衣", sweater: "毛衣", pants: "裤子",
  jeans: "牛仔裤", skirt: "半身裙", shorts: "短裤", suit: "西装",
};
const REGION_CN = { upper: "上身", lower: "下身", full: "全身" };


/** 把图像接口返回（b64 或 url）统一规范成可直接 <img> 使用的字符串 */
async function normalizeImage(item) {
  if (!item) throw new Error("图像接口未返回图像数据");
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item.url) {
    // 拉取一次转成 dataURL，避免前端跨域 / 临时链接失效问题
    const r = await fetch(item.url);
    if (!r.ok) throw new Error(`图像地址拉取失败 (${r.status})`);
    const ab = await r.arrayBuffer();
    const ct = r.headers.get("content-type") || "image/png";
    return `data:${ct};base64,${Buffer.from(ab).toString("base64")}`;
  }
  throw new Error("图像接口返回格式无法解析（缺少 b64_json / url）");
}

/** 把商品主图（可能是跨域 URL）在服务端拉取并转成 dataURL，供模型作为输入 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function resolveToDataUrl(src) {
  try {
    if (!src) return null;
    if (src.startsWith("data:")) return src; // 已是 dataURL，直接复用
    const r = await fetch(src, {
      headers: { "User-Agent": UA, Referer: src, Accept: "image/*,*/*" },
    });
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    return `data:${ct};base64,${Buffer.from(ab).toString("base64")}`;
  } catch {
    return null; // 拉取失败则放弃商品图，回退到「按描述添加服装」模式
  }
}

/** 根据服装信息与身体数据，构造给图像模型的 prompt */
function buildPrompt(garment = {}, m = {}, opts = {}) {
  const color = COLOR_CN[garment.color] || garment.color || "未指定颜色";
  const type = TYPE_CN[garment.type] || garment.type || "服装";
  const region = REGION_CN[garment.region] || "全身";

  // ── 模式 A：有商品主图 → 换脸式试衣 ──
  // 保留商品图里模特的姿势/服装/背景，仅把用户自拍的脸合成上去
  if (opts.productImage) {
    return [
      "以下是两张图片。",
      "第一张是商品展示图：图中模特正穿着待试穿的服装。请务必完整保留第一张图的构图、人物姿势、服装款式、背景、灯光与整体质感，不要做任何改动。",
      "第二张是用户本人照片：请提取该用户真实的脸部特征、五官、发型与肤色。",
      "请仅将用户本人的脸自然、无缝地替换到第一张图人物的脸上，使两张面容融为一体，光影自然、皮肤质感真实，不出现重影或拼接痕迹；",
      "保持第一张图原本的姿势、服装、背景与灯光完全不变。",
      "输出一张高分辨率、照片级真实感的图片。",
    ].join("\n");
  }

  // ── 模式 B：无商品主图 → 在自拍照上按描述添加服装 ──
  const fit = [];
  if (m.gender) fit.push(m.gender === "male" ? "男性" : m.gender === "female" ? "女性" : m.gender);
  if (m.height) fit.push(`身高约 ${m.height}cm`);
  if (m.weight) fit.push(`体重约 ${m.weight}kg`);
  if (m.bust) fit.push(`胸围约 ${m.bust}cm`);
  if (m.waist) fit.push(`腰围约 ${m.waist}cm`);
  if (m.hips) fit.push(`臀围约 ${m.hips}cm`);
  if (m.shoulder) fit.push(`肩宽约 ${m.shoulder}cm`);
  const fitText = fit.length ? `体型参考：${fit.join("，")}。` : "";

  return [
    "你是一名专业的虚拟试衣 AI。下面是用户本人的真实照片。",
    "请严格保留照片中人物的脸部特征、身份、发型、体型、姿势与原有背景，",
    "仅在其身上添加/更换一件服装，不要改变人物的外貌与姿态。",
    "",
    `请让人物穿上：一件${color}的${type}（覆盖${region}）。`,
    "服装应自然贴合身形，符合人体结构与光影，呈现真实布料质感与合理褶皱。",
    fitText,
    "",
    "输出一张高分辨率、照片级真实感的试衣效果图，整体风格与输入照片保持一致。",
  ].join("\n");
}

/** 调用图像生成接口（默认 Agnes：JSON 体 + extra_body.image 图生图） */
async function callImageApi({ selfie, productImage, prompt }) {
  const base = (process.env.IMAGE_BASE_URL || "https://apihub.agnes-ai.com/v1").replace(/\/$/, "");
  const endpoint = process.env.IMAGE_ENDPOINT || "/images/generations";
  const url = `${base}${endpoint}`;
  const model = process.env.IMAGE_MODEL || "agnes-image-2.0-flash";
  const size = process.env.IMAGE_SIZE || "1024x1024";
  const useInputImage = (process.env.IMAGE_INPUT_IMAGE ?? "true").toLowerCase() !== "false";

  const headers = {
    Authorization: `Bearer ${process.env.IMAGE_API_KEY}`,
    "Content-Type": "application/json",
  };

  // Agnes / OpenAI 兼容网关风格：图生图走 extra_body.image（数组，支持多张）
  // 顺序：[商品主图（保留姿势/服装）, 用户自拍（提供脸）]
  // （若你的服务使用 multipart 的 /images/edits，可在此改为 FormData 并 append("image", ...)）
  const images = [];
  if (productImage) images.push(productImage);
  images.push(selfie);

  const body = {
    model,
    prompt,
    size,
    extra_body: {
      response_format: "b64_json",
      ...(useInputImage && images.length ? { image: images } : {}),
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`图像接口调用失败 (${res.status}): ${text.slice(0, 400)}`);
  }
  const json = await res.json();
  const item = Array.isArray(json.data) ? json.data[0] : json.data || json;
  return await normalizeImage(item);
}

/**
 * 运行 AI 试衣
 * @param {{selfie:string, garment?:object, measurements?:object, productImage?:string}} params
 *   productImage 为商品主图（URL 或 dataURL）。提供时走「换脸式」：保留商品图姿势/服装，仅合成用户脸。
 * @returns {Promise<{image:string}>}
 */
export async function runTryOn({ selfie, garment, measurements, productImage }) {
  if (!process.env.IMAGE_API_KEY) {
    const e = new Error("后端未配置 IMAGE_API_KEY，无法调用 AI 试衣（已回退本地预览）");
    e.code = "NO_TOKEN";
    throw e;
  }
  if (!process.env.IMAGE_MODEL) {
    const e = new Error("后端未配置 IMAGE_MODEL");
    e.code = "NO_MODEL";
    throw e;
  }
  // 商品主图：跨域 URL 在服务端转 base64；转换失败则回退模式 B
  const productB64 = productImage ? await resolveToDataUrl(productImage) : null;
  const prompt = buildPrompt(garment, measurements, { productImage: !!productB64 });
  const image = await callImageApi({ selfie, productImage: productB64, prompt });
  return { image };
}
