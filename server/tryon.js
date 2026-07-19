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

/**
 * 拉取图片外链并转 dataURL。
 * 关键：带超时 + 自动重试 + 合理 Referer（防盗链），
 * 避免「首次拉取失败 → 回退通用衣服（mock），再试一次才用真实商品图」的问题。
 * @param {string} src 图片 URL（或已是 dataURL 时直接复用）
 * @param {{retries?:number, timeoutMs?:number}} [opts]
 */
export async function resolveToDataUrl(src, { retries = 2, timeoutMs = 10000 } = {}) {
  if (!src) return null;
  if (src.startsWith("data:")) return src; // 已是 dataURL，直接复用

  // 用图片所在站点根域作为 Referer（alicdn 等 CDN 接受同域 referer，避免防盗链 403）
  let referer = "";
  try {
    const u = new URL(src);
    referer = `${u.protocol}//${u.host}/`;
  } catch {
    /* 非法 URL 时不带 referer */
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(src, {
        headers: {
          "User-Agent": UA,
          ...(referer ? { Referer: referer } : {}),
          Accept: "image/*,*/*",
        },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ab = await r.arrayBuffer();
      if (!ab || ab.byteLength === 0) throw new Error("空响应");
      const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
      return `data:${ct};base64,${Buffer.from(ab).toString("base64")}`;
    } catch {
      clearTimeout(timer);
      if (attempt === retries) return null; // 重试用尽，放弃商品图，回退「按描述添加服装」模式
      await new Promise((res) => setTimeout(res, 300 * (attempt + 1))); // 退避后重试
    }
  }
  return null;
}

/** 根据服装信息与身体数据，构造给图像模型的 prompt */
function buildPrompt(garment = {}, m = {}, opts = {}) {
  const color = COLOR_CN[garment.color] || garment.color || "未指定颜色";
  const type = TYPE_CN[garment.type] || garment.type || "服装";
  const region = REGION_CN[garment.region] || "全身";

  // ── 身体数据描述（两种模式共用）──
  const fit = [];
  if (m.gender) fit.push(m.gender === "male" ? "男性" : m.gender === "female" ? "女性" : m.gender);
  if (m.height) fit.push(`身高约 ${m.height}cm`);
  if (m.weight) fit.push(`体重约 ${m.weight}kg`);
  if (m.bust) fit.push(`胸围约 ${m.bust}cm`);
  if (m.waist) fit.push(`腰围约 ${m.waist}cm`);
  if (m.hips) fit.push(`臀围约 ${m.hips}cm`);
  if (m.shoulder) fit.push(`肩宽约 ${m.shoulder}cm`);
  const fitText = fit.length ? `\n人物体型数据：${fit.join("，")}。请根据这些数据调整服装的合身度与褶皱分布，使版型贴合真实身材。` : "";

  // ── 模式 A：有商品主图 → 以用户自拍为底的真试衣 ──
  // 图序：[自拍(底图), 商品图(服装参考)]
  // 提示词风格：仿 OpenAI 图像生成方法论——分层描述式（Subject/Environment/
  // Lighting/Style/Composition），用正向语言描述「画面里有什么」，而非禁令式。
  if (opts.productImage) {
    return [
      "你是一名专业时尚摄影师，正在为图1中的人物拍摄一组虚拟试穿照片。",
      "",
      "【画面主体 · 图1人物】",
      "这张照片的主体是图1中的真实人物。画面中该人物呈现以下可辨识的视觉特征，请精确复现、原样保留：",
      "- 面部：特定的五官比例、脸型轮廓、肤色与表情——保留图1样貌，不做美化或瘦脸",
      "- 发型：图1中的发色、长度、层次与刘海样式原样保留",
      "- 体型：图1中的身高比例、肩宽与身形轮廓原样保留",
      "- 姿态：图1中人物特定的身体朝向、重心与头部角度原样保留",
      "- 手部：图1中双臂与双手所处的位置与姿态原样保留（例如自然垂落于身体两侧）",
      "- 背景：图1中的环境场景、光线方向与阴影原样保留",
      "",
      "【待试穿服装 · 图2】",
      "图2是一件服装单品。请从中提取视觉属性，用于图1人物身上的服装：",
      `- 款式：${type} 的具体版型与剪裁`,
      `- 颜色：${color}，含图案与纹理细节`,
      "- 面料：依图2判断材质质感（棉/丝/麻/牛仔/针织等）",
      "- 细节：领型、袖型、腰线、下摆、门襟等设计元素",
      "",
      "【拍摄说明】",
      `以图1为取景基准，将图2的${color}${type}穿在图1人物身上。服装随人物身材自然起伏，呈现真实褶皱、垂坠与布料光影；领口、袖口、下摆与皮肤自然衔接，无拼接痕迹、无白边、无半透明伪影。`,
      "",
      "【画面规格】",
      "- 风格：照片级真实，类似专业人像摄影棚出品，皮肤纹理与布料质感清晰",
      "- 构图：与图1完全一致——相同视角、相同景别、人物在画面中的占比与位置不变",
      "- 比例：画面宽高比等于图1原图",
      "- 光照：服装受光方向与图1光线一致，阴影自然",
      "- 范围：画面中唯一的变化是服装本身，人物外貌与背景一切保持图1原貌",
      fitText,
      "",
      "输出这张照片级真实的虚拟试穿效果图，观感如同「此人真实试穿该服装后拍摄的照片」。",
    ].join("\n");
  }

  // ── 模式 B：无商品主图 → 在自拍照上按文字描述添加服装 ──
  // 同样采用分层描述式结构，用正向语言锁定人物、描述新增服装
  return [
    "你是一名专业时尚摄影师，正在为图1中的人物拍摄虚拟试穿照片。",
    "",
    "【画面主体 · 图1人物】",
    "画面主体是图1中的真实人物。请精确复现并原样保留以下视觉特征：",
    "- 面部：五官比例、脸型、肤色与表情保持图1样貌",
    "- 发型：发色、长度、层次与图1一致",
    "- 体型：身高比例、肩宽与身形轮廓与图1一致",
    "- 姿态：身体朝向、重心、头部角度与图1一致",
    "- 手部：双臂与双手的位置、姿态与图1一致",
    "- 背景：环境场景、光线方向与图1一致",
    "",
    "【拍摄说明】",
    `让图1人物穿上：一件${color}的${type}（覆盖${region}）。服装随人物身材自然贴合，呈现真实褶皱、垂坠与布料光影，与皮肤自然衔接。`,
    fitText,
    "",
    "【画面规格】",
    "- 风格：照片级真实，类似专业人像摄影",
    "- 构图：与图1完全一致（视角、景别、人物占比与位置不变）",
    "- 比例：画面宽高比等于图1原图",
    "- 范围：画面中唯一的变化是服装本身，人物外貌与背景一切保持图1原貌",
    "",
    "输出这张照片级真实的虚拟试穿效果图，观感如同「此人真实穿上该服装后拍摄的照片」。",
  ].join("\n");
}

/**
 * 从 dataURL 中提取图片原始宽高。
 * @param {string} dataUrl 图片 dataURL（data:image/...;base64,...）
 * @returns {{width:number, height:number}|null}
 */
function getImageDimensions(dataUrl) {
  try {
    // dataURL 格式：data:<mime>;base64,<base64数据>
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    const buf = Buffer.from(base64, "base64");
    // PNG: 宽高在第 16-23 字节（大端 32 位整数）
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x47 && buf[3] === 0x4e) {
      return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
      };
    }
    // JPEG: 从 SOF 标记读取（FF C0 / FF C2）
    // SOF 段结构：FF + marker(1B) + 长度(2B) + 精度(1B) + 高度(2B) + 宽度(2B)
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2;
      while (offset < buf.length) {
        if (buf[offset] !== 0xff) break;
        const marker = buf[offset + 1];
        // RST 标记跳过
        if (marker >= 0xd0 && marker <= 0xd7) { offset += 2; continue; }
        // SOF0 (C0) / SOF2 (C2) 包含宽高
        if (marker === 0xc0 || marker === 0xc2) {
          return {
            width: buf.readUInt16BE(offset + 7),  // 宽度在 offset+7
            height: buf.readUInt16BE(offset + 5), // 高度在 offset+5
          };
        }
        // 其他标记：读段长并跳过
        const segLen = buf.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      }
    }
    // WebP / GIF / 其他格式：返回 null，走默认方形
    return null;
  } catch {
    return null;
  }
}

/**
 * 根据输入图片的实际宽高比，选择最匹配的模型输出尺寸。
 * Agnes 支持三种尺寸：
 *   768x1024  （竖版 3:4，适合全身照、竖拍）
 *   1024x1024 （正方形 1:1，适合近景/半身照）
 *   1024x768  （横版 4:3，适合横拍）
 *
 * @param {string} selfieDataUrl 用户自拍照的 dataURL
 * @returns {string} 尺寸字符串如 "768x1024"
 */
function pickBestSize(selfieDataUrl) {
  // 优先使用环境变量手动覆盖
  if (process.env.IMAGE_SIZE) return process.env.IMAGE_SIZE;

  const dim = getImageDimensions(selfieDataUrl);
  if (!dim || !dim.width || !dim.height) return "1024x1024";

  const ratio = dim.width / dim.height;
  // 竖图（高 > 宽）：用 768x1024
  if (ratio < 0.85) return "768x1024";
  // 横图（宽 > 高很多）：用 1024x768
  if (ratio > 1.15) return "1024x768";
  // 接近正方形：用 1024x1024
  return "1024x1024";
}

/** 调用图像生成接口（默认 Agnes：JSON 体 + extra_body.image 图生图） */
async function callImageApi({ selfie, productImage, prompt }) {
  const base = (process.env.IMAGE_BASE_URL || "https://apihub.agnes-ai.com/v1").replace(/\/$/, "");
  const endpoint = process.env.IMAGE_ENDPOINT || "/images/generations";
  const url = `${base}${endpoint}`;
  const model = process.env.IMAGE_MODEL || "agnes-image-2.0-flash";
  const size = pickBestSize(selfie);  // ← 根据自拍实际比例自动选择
  console.log(`[tryon] 原图尺寸检测: 输出size=${size}`);
  const useInputImage = (process.env.IMAGE_INPUT_IMAGE ?? "true").toLowerCase() !== "false";

  // 负面提示词（保留以兼容支持该参数的模型如 agnes；OpenAI 官方不推荐负面提示，
  // 因此正向描述已在 prompt 中承担主要约束职责，这里仅作兜底）
  const negativePrompt = [
    "改变人物面部或身份",
    "改变发型或体型",
    "改变身体姿势或手势",
    "改变背景环境",
    "使用商品模特指代用户",
    "改变画面构图或比例",
    "服装类型偏离商品",
    "拼接痕迹或伪影",
  ].join("，");

  const headers = {
    Authorization: `Bearer ${process.env.IMAGE_API_KEY}`,
    "Content-Type": "application/json",
  };

  // Agnes / OpenAI 兼容网关风格：图生图走 extra_body.image（数组，支持多张）
  // 真试衣模式图序：[自拍照(底图/主体), 商品图(服装参考)]
  // 第一张图是用户本人（需完整保留脸/身体/姿势/背景），第二张仅提取服装款式
  // （若你的服务使用 multipart 的 /images/edits，可在此改为 FormData 并 append("image", ...)）
  const images = [selfie];
  if (productImage) images.push(productImage);

  const body = {
    model,
    prompt,
    size,
    negative_prompt: negativePrompt,
    extra_body: {
      response_format: "b64_json",
      ...(useInputImage && images.length ? { image: images } : {}),
    },
  };

  console.log(`[tryon] 调用模型=${model} size=${size} 图数量=${images.length} 有商品图=${!!productImage}`);

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
 *   productImage 为商品主图（URL 或 dataURL）。提供时走「真试衣」：以自拍为底，把商品服装穿到用户身上。
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
