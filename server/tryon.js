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

/**
 * 根据服装信息与身体数据，构造给图像模型的 prompt。
 *
 * 核心设计原则（经多次迭代验证）：
 *   ① 角色必须是「编辑器」而非「创作者」——告诉模型这是 EDIT 不是 GENERATE
 *   ② 必须用最简短的语言突出「唯一操作=换衣服」
 *   ③ 人物外貌描述越具体越好（避免模型用商品图模特替换）
 *   ④ 两张图模式时，第二张图的权重需要被压低
 */
function buildPrompt(garment = {}, m = {}, opts = {}) {
  const color = COLOR_CN[garment.color] || garment.color || "未指定颜色";
  const type = TYPE_CN[garment.type] || garment.type || "服装";
  const region = REGION_CN[garment.region] || "全身";

  // 身体数据（两种模式共用）
  const fit = [];
  if (m.gender) fit.push(m.gender === "male" ? "男性" : m.gender === "female" ? "女性" : m.gender);
  if (m.height) fit.push(`身高约 ${m.height}cm`);
  if (m.weight) fit.push(`体重约 ${m.weight}kg`);
  if (m.bust) fit.push(`胸围约 ${m.bust}cm`);
  if (m.waist) fit.push(`腰围约 ${m.waist}cm`);
  if (m.hips) fit.push(`臀围约 ${m.hips}cm`);
  if (m.shoulder) fit.push(`肩宽约 ${m.shoulder}cm`);
  const fitText = fit.length ? `（人物体型：${fit.join("，")}，据此调整服装合身度）` : "";

  // 外貌锁定文本（由 runTryOn 在调用前通过视觉模型自动生成）
  const faceLock = opts.faceDescription || "";

  // ── 模式 A：有商品主图 → 图像编辑操作（EDIT，不是 GENERATE）──
  if (opts.productImage) {
    return [
      `IMAGE EDIT OPERATION — 只执行一个操作：把图中人物的当前衣服换成一件${color}${type}（覆盖${region}）。`,
      "",
      `绝对不可改变的内容（违反即失败）：`,
      `- 人物的脸、发型、体型、姿势、手势、表情 — 100% 保持原图，像素级不变`,
      `- 背景环境、光线方向、构图 — 完全不变`,
      faceLock ? `- 人物外貌特征：${faceLock}` : "",
      "",
      `服装要求：款式=${type}，颜色=${color}${fitText}。衣服必须贴合此人的真实身材，呈现自然的褶皱和垂坠。边缘与皮肤无缝融合。`,
      "",
      `注意：如果第二张输入图包含模特，请完全忽略模特的外貌，仅从该图提取服装的款式、颜色和面料信息。`,
    ].filter(Boolean).join("\n");
  }

  // ── 模式 B：无商品主图 → 纯文字描述换衣（单图编辑）──
  return [
    `IMAGE EDIT OPERATION — 只执行一个操作：把图中人物的当前衣服换成一件${color}${type}（覆盖${region}）。`,
    "",
    `绝对不可改变的内容：人物的脸、发型、体型、姿势、手势、表情、背景 — 100%保持原图不变。`,
    faceLock ? `\n人物外貌特征：${faceLock}` : "",
    "",
    `服装要求：款式=${type}，颜色=${color}${fitText}。贴合此人真实身材，自然褶皱，边缘无缝融合。`,
  ].filter(Boolean).join("\n");
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
 * 根据输入图片的实际宽高，输出与自拍一致的尺寸字符串。
 *
 * 经实测：Agnes 接受任意 "WxH" 尺寸（并非只有 3 种），且会严格保持
 * 请求的宽高比（仅把像素总量归一到自身分辨率区间，不会压扁人物）。
 * 因此直接按自拍真实尺寸生成即可，无需硬凑 768x1024 / 1024x1024 / 1024x768。
 *
 * 为兼容超大原图（如手机直出 4032x3024），长边超过 MAX_EDGE 时按
 * 比例缩放到 MAX_EDGE，避免单次生成过大导致超时/失败。
 *
 * @param {string} selfieDataUrl 用户自拍照的 dataURL
 * @returns {string} 尺寸字符串如 "1280x1707"
 */
const MAX_EDGE = 2048;
function pickBestSize(selfieDataUrl) {
  // 手动覆盖（可选）：在 .env 设 IMAGE_SIZE 可强制指定输出尺寸
  if (process.env.IMAGE_SIZE) return process.env.IMAGE_SIZE;

  const dim = getImageDimensions(selfieDataUrl);
  // 解析失败则回退到通用方形
  if (!dim || !dim.width || !dim.height) return "1024x1024";

  let { width, height } = dim;
  const longest = Math.max(width, height);
  if (longest > MAX_EDGE) {
    const k = MAX_EDGE / longest;
    width = Math.round(width * k);
    height = Math.round(height * k);
  }
  return `${width}x${height}`;
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
 * 用视觉模型提取自拍照中人物的可见外貌特征。
 * 返回一段具体描述（如"短发、圆脸、中等身材、穿绿色套装、双手自然下垂"），
 * 嵌入试衣 prompt 后可大幅降低模型「用商品图模特替换用户」的概率。
 *
 * @param {string} selfieDataUrl 自拍的 dataURL
 * @returns {Promise<string>} 外貌描述文本，失败返回空字符串
 */
async function extractFaceDescription(selfieDataUrl) {
  try {
    const visionBase = (process.env.VISION_BASE_URL || process.env.IMAGE_BASE_URL || "https://apihub.agnes-ai.com/v1").replace(/\/$/, "");
    const visionKey = process.env.VISION_API_KEY || process.env.IMAGE_API_KEY;
    const visionModel = process.env.VISION_MODEL || "agnes-2.0-flash";

    if (!visionKey) return ""; // 未配置视觉模型，跳过

    const res = await fetch(`${visionBase}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${visionKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: visionModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "请仔细观察这张照片中的人物，用一句话描述其可见的外貌特征。只需描述客观可观察到的：发型（长短/颜色/直卷）、脸型（圆/方/椭圆）、体型（偏瘦/标准/偏胖）、当前穿着的大致款式和颜色、姿势（站姿/手的位置）。不要评价美丑。输出格式：纯中文，不超过60字。" },
              { type: "image_url", image_url: { url: selfieDataUrl } },
            ],
          },
        ],
        max_tokens: 200,
      }),
    });

    if (!res.ok) return "";

    const json = await res.json();
    // agnes-2.0-flash 推理模型可能把内容放在 reasoning_content
    const content =
      json.choices?.[0]?.message?.content ||
      json.choices?.[0]?.message?.reasoning_content ||
      "";
    // 提取纯文本（去掉 JSON 包装）
    const text = typeof content === "string" ? content : JSON.stringify(content);
    const cleaned = text.replace(/```[\s\S]*?```/g, "").trim().slice(0, 120);
    return cleaned || "";
  } catch (e) {
    console.log("[tryon] 人物外貌提取跳过:", e.message);
    return ""; // 失败不阻塞主流程
  }
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

  // ★ 关键步骤：用视觉模型提取自拍中人物的可见外貌特征
  // 这段描述嵌入 prompt 后，可大幅降低模型「用商品图模特替换用户」的概率
  const faceDescription = await extractFaceDescription(selfie);
  if (faceDescription) console.log(`[tryon] 人物外貌特征: ${faceDescription}`);

  const prompt = buildPrompt(garment, measurements, { productImage: !!productB64, faceDescription });
  const image = await callImageApi({ selfie, productImage: productB64, prompt });
  return { image };
}
