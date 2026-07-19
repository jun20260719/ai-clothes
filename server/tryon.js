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
export async function resolveToDataUrl(src, { retries = 3, timeoutMs = 15000 } = {}) {
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
      const dataUrl = `data:${ct};base64,${Buffer.from(ab).toString("base64")}`;
      // 缓存：同一外链下次直接命中，避免 /api/tryon 再次冷拉（手机网络下首次拉取常超时）
      cacheImage(src, dataUrl);
      return dataUrl;
    } catch (e) {
      clearTimeout(timer);
      console.log(`[resolveToDataUrl] 第${attempt + 1}/${retries + 1}次拉取失败: ${e.message} | ${src.slice(0, 80)}`);
      if (attempt === retries) return null; // 重试用尽，放弃商品图，回退「按描述添加服装」模式
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1))); // 退避后重试
    }
  }
  return null;
}

/**
 * 商品图内存缓存：URL → dataURL。
 * /api/parse 预取成功后缓存，/api/tryon 时直接命中，避免手机网络下重复冷拉超时。
 * 进程级缓存，重启失效（够用：单次会话内同一商品图只需拉一次）。
 */
const IMAGE_CACHE = new Map();
/** 缓存上限，避免内存无限增长 */
const IMAGE_CACHE_MAX = 40;
function cacheImage(key, dataUrl) {
  if (!key || !dataUrl) return;
  if (IMAGE_CACHE.size >= IMAGE_CACHE_MAX) {
    // 淘汰最早的条目
    const firstKey = IMAGE_CACHE.keys().next().value;
    IMAGE_CACHE.delete(firstKey);
  }
  IMAGE_CACHE.set(key, dataUrl);
}
/** 先查缓存，缓存未命中再走 resolveToDataUrl */
async function resolveToDataUrlCached(src) {
  if (!src) return null;
  if (src.startsWith("data:")) return src;
  const hit = IMAGE_CACHE.get(src);
  if (hit) {
    console.log(`[resolveToDataUrl] 缓存命中 ✓ | ${src.slice(0, 60)}`);
    return hit;
  }
  return resolveToDataUrl(src);
}

/**
 * 根据服装信息与身体数据，构造给图像模型的 prompt。
 *
 * 迭代经验：
 *   v1 "摄影师生成" → 人物被替换成模特
 *   v2 "EDIT + 身份锁定" → 人物保住了，但服装变纯色（描述太弱）
 *   v3 双锁（身份+服装细节）→ 服装保真，但商品只有上/下衣时会脑补另一半
 *   v4 区域约束（upper/lower/full）+ 强化脸部锁定，解决两个问题：
 *      ① 商品图带模特时合成脸偏向模特
 *      ② 商品只有上/下衣时脑补不存在的部位
 */
function buildPrompt(garment = {}, m = {}, opts = {}) {
  const color = COLOR_CN[garment.color] || garment.color || "未指定颜色";
  const type = TYPE_CN[garment.type] || garment.type || "服装";
  const region = garment.region || "full"; // upper / lower / full

  // 身体数据（两种模式共用）
  const fit = [];
  if (m.gender) fit.push(m.gender === "male" ? "男性" : m.gender === "female" ? "女性" : m.gender);
  if (m.height) fit.push(`身高约 ${m.height}cm`);
  if (m.weight) fit.push(`体重约 ${m.weight}kg`);
  if (m.bust) fit.push(`胸围约 ${m.bust}cm`);
  if (m.waist) fit.push(`腰围约 ${m.waist}cm`);
  if (m.hips) fit.push(`臀围约 ${m.hips}cm`);
  if (m.shoulder) fit.push(`肩宽约 ${m.shoulder}cm`);
  const fitText = fit.length ? `\n体型参考：${fit.join("，")}，据此调整服装合身度和褶皱分布。` : "";

  const faceLock = opts.faceDescription || "";
  const garmentDetail = opts.garmentDetail || "";

  // ── 区域约束：明确只替换哪个部位，其它部位保持原图 ──
  // 解决"商品只有上衣/下衣时脑补不存在的部分"
  const REGION_GUIDE = {
    upper: {
      label: "上身",
      scope: "只替换上半身服装（从颈部/肩膀到腰臀之间）",
      keep: "下半身（裤子、裙子、鞋子、袜子）必须与原图完全一致：同样的款式、颜色、长度、褶皱。禁止修改、禁止替换、禁止脑补新的下装。",
      keepHint: "例如原图穿牛仔裤，结果图必须仍是同一条牛仔裤（同色、同裤型、同位置），不可添加裙摆或改变裤型。",
    },
    lower: {
      label: "下身",
      scope: "只替换下半身服装（从腰部到脚踝）",
      keep: "上半身（上衣、外套、领口）必须与原图完全一致：同样的款式、颜色、图案、纽扣。禁止修改、禁止替换、禁止脑补新的上衣。",
      keepHint: "例如原图穿白色T恤，结果图必须仍是同一件白色T恤（同色、同领型、同图案），不可改变上衣颜色或款式。",
    },
    full: {
      label: "全身",
      scope: "替换整体服装（上装和下装，或连体款式）",
      keep: "全身服装都替换为目标服装。但脸部、发型、体型、姿势、背景必须与原图一致。",
      keepHint: "",
    },
  };
  const guide = REGION_GUIDE[region] || REGION_GUIDE.full;

  // ── 模式 A：有商品主图 ──
  if (opts.productImage) {
    return [
      `【任务】IMAGE EDIT — 把第一张图中人物的${guide.label}服装，替换为第二张图的目标服装。${guide.scope}。`,
      "",
      `【身份锁定 — 最高优先级，不可违反】`,
      `- 人物的脸型、五官（眼/鼻/嘴/眉）、表情 — 必须与第一张图像素级一致，禁止任何改动`,
      `- 发型（长短/直卷/刘海/发色）、发际线 — 与第一张图完全一致`,
      `- 肤色、肤质、体型、手臂位置、手势、站姿 — 与第一张图完全一致`,
      `- 背景环境、光线方向、画面构图、人物在画面中的位置和比例 — 完全不变`,
      faceLock ? `- 人物外貌锚点（必须严格匹配）：${faceLock}` : "",
      `- ⚠️ 严禁参考第二张图中模特的任何特征。第二张图仅供提取服装款式，其中人物的脸、发型、肤色、身材、姿势全部忽略。最终输出的人物必须是第一张图中的同一个人。`,
      "",
      `【区域约束 — 必须遵守】`,
      `- 本次只替换：${guide.label}服装`,
      `- 保留不变：${guide.keep}`,
      guide.keepHint ? `- ${guide.keepHint}` : "",
      "",
      `【目标服装 — 严格还原以下视觉细节】`,
      garmentDetail
        ? `${garmentDetail}`
        : `- 类型：${type}\n- 主色调：${color}`,
      fitText,
      "",
      `【质量要求】`,
      `- 服装贴合此人的真实身材（不是把人改成适合衣服）`,
      `- 自然褶皱、垂坠感、布料光影、缝线细节`,
      `- 服装边缘与皮肤无缝融合，无白边、无拼接痕迹、无浮空感`,
      `- 照片级真实质感，光照与原图一致`,
      "",
      `【图序说明】第一张图=用户本人（需完整保留脸/身体/姿势/背景${region === "upper" ? "/下装" : region === "lower" ? "/上装" : ""}），第二张图=目标服装参考（只取服装款式，忽略模特）。`,
    ].filter(Boolean).join("\n");
  }

  // ── 模式 B：无商品主图 ──
  return [
    `【任务】IMAGE EDIT — 把图中人物的${guide.label}服装替换为目标服装。${guide.scope}。`,
    "",
    `【身份锁定】人物的脸、五官、发型、肤色、体型、姿势、背景 — 100%保持原图不变。`,
    faceLock ? `\n人物外貌锚点：${faceLock}` : "",
    "",
    `【区域约束】`,
    `- 本次只替换：${guide.label}服装`,
    `- 保留不变：${guide.keep}`,
    guide.keepHint ? `- ${guide.keepHint}` : "",
    "",
    `【目标服装】类型=${type}，主色=${color}${fitText}`,
    "",
    `【质量要求】贴合真实身材，自然褶皱，边缘无缝融合，照片级真实。`,
  ].filter(Boolean).join("\n");
}

/**
 * 从 dataURL 中提取图片原始宽高。
 *
 * 历史 bug 教训：PNG 签名是 89 50 4E 47（即 \x89 'P' 'N' 'G'），
 * 'N'=0x4e、'G'=0x47 容易写反。曾经把 buf[2]/buf[3] 的判断值颠倒，
 * 导致所有 PNG 都识别失败 → pickBestSize fallback 到 1024x1024。
 * 现用字符常量避免再次混淆。
 *
 * @param {string} dataUrl 图片 dataURL（data:image/...;base64,...）
 * @returns {{width:number, height:number, format:string}|null}
 */
function getImageDimensions(dataUrl) {
  try {
    // dataURL 格式：data:<mime>;base64,<base64数据>
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    const buf = Buffer.from(base64, "base64");
    if (buf.length < 24) return null;

    // PNG: 签名 89 50 4E 47 0D 0A 1A 0A；宽高在 IHDR chunk 的第 16-23 字节（大端 32 位）
    // 用 'P' 'N' 'G' 字符常量，避免 0x47/0x4e 写反
    if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 && // 'P'
      buf[2] === 0x4e && // 'N'
      buf[3] === 0x47 && // 'G'
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
    ) {
      return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
        format: "png",
      };
    }
    // JPEG: 从 SOF 标记读取（FF C0 / FF C2）
    // SOF 段结构：FF + marker(1B) + 长度(2B) + 精度(1B) + 高度(2B) + 宽度(2B)
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) break;
        const marker = buf[offset + 1];
        // RST 标记无段长，跳过
        if (marker >= 0xd0 && marker <= 0xd7) { offset += 2; continue; }
        // SOI/EOI 也无段长
        if (marker === 0xd8 || marker === 0xd9) break;
        // SOF0 (C0) / SOF2 (C2) 包含宽高
        if (marker === 0xc0 || marker === 0xc2) {
          return {
            width: buf.readUInt16BE(offset + 7),  // 宽度在 offset+7
            height: buf.readUInt16BE(offset + 5), // 高度在 offset+5
            format: "jpeg",
          };
        }
        // 其他标记：读段长并跳过
        const segLen = buf.readUInt16BE(offset + 2);
        if (segLen < 2) break; // 异常段长，避免死循环
        offset += 2 + segLen;
      }
    }
    // WebP / GIF / SVG / 其他格式：返回 null，走默认方形
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
  if (process.env.IMAGE_SIZE) {
    console.log(`[tryon] pickBestSize: IMAGE_SIZE 覆盖 = ${process.env.IMAGE_SIZE}`);
    return process.env.IMAGE_SIZE;
  }

  const dim = getImageDimensions(selfieDataUrl);
  if (!dim || !dim.width || !dim.height) {
    // 解析失败（SVG / WebP / GIF / 异常格式）→ 回退通用方形
    // 注意：此处会打印 dataURL 前缀，便于排查格式问题
    const prefix = (selfieDataUrl || "").slice(0, 40);
    console.log(`[tryon] pickBestSize: 尺寸解析失败，回退 1024x1024 | dataURL前缀=${prefix}`);
    return "1024x1024";
  }

  let { width, height } = dim;
  console.log(`[tryon] pickBestSize: 原图=${width}x${height} (${dim.format})`);
  const longest = Math.max(width, height);
  if (longest > MAX_EDGE) {
    const k = MAX_EDGE / longest;
    width = Math.round(width * k);
    height = Math.round(height * k);
    console.log(`[tryon] pickBestSize: 长边>${MAX_EDGE}，等比缩放至 ${width}x${height}`);
  }
  return `${width}x${height}`;
}

/** 调用图像生成接口（默认 Agnes：JSON 体 + extra_body.image 图生图） */
async function callImageApi({ selfie, productImage, prompt, region = "full" }) {
  const base = (process.env.IMAGE_BASE_URL || "https://apihub.agnes-ai.com/v1").replace(/\/$/, "");
  const endpoint = process.env.IMAGE_ENDPOINT || "/images/generations";
  const url = `${base}${endpoint}`;
  const model = process.env.IMAGE_MODEL || "agnes-image-2.0-flash";
  const size = pickBestSize(selfie);  // ← 根据自拍实际比例自动选择
  console.log(`[tryon] callImageApi: 最终输出 size=${size}`);
  const useInputImage = (process.env.IMAGE_INPUT_IMAGE ?? "true").toLowerCase() !== "false";

  // 负面提示词：按区域动态调整，明确禁止复制模特特征和脑补其它部位
  // 解决两个核心问题：
  //   ① 商品图带模特 → 合成脸偏向模特
  //   ② 商品只有上/下衣 → 脑补不存在的部位
  const negativeItems = [
    "改变人物面部或五官",
    "复制或参考商品图模特的脸、发型、肤色、身材",
    "改变发型或发色",
    "改变体型或姿势",
    "改变背景环境",
    "拼接痕迹、白边、伪影、浮空服装",
  ];
  if (region === "upper") {
    negativeItems.push("修改或替换下半身服装（裤子/裙子/鞋子）");
    negativeItems.push("脑补生成新的下装");
  } else if (region === "lower") {
    negativeItems.push("修改或替换上半身服装（上衣/外套）");
    negativeItems.push("脑补生成新的上衣");
  } else {
    negativeItems.push("服装类型偏离目标商品");
  }
  const negativePrompt = negativeItems.join("，");

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

  // 超时控制：AI 图像生成通常 10-40s，给 90s 上限避免无限挂起
  // （手机网络下若无限挂起，前端 fetch 会被浏览器/移动网络中间节点掐断 → 静默失败）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error("图像接口超时（90s），请重试");
    throw new Error(`图像接口网络错误: ${e.message}`);
  }
  clearTimeout(timer);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`图像接口调用失败 (${res.status}): ${text.slice(0, 400)}`);
  }
  const json = await res.json();
  const item = Array.isArray(json.data) ? json.data[0] : json.data || json;
  return await normalizeImage(item);
}

/**
 * 用视觉模型提取自拍照中人物的"身份锚点"特征。
 *
 * 关键：只提取不会因换衣而改变的特征（脸/五官/发型/肤色/体型），
 * 不描述当前穿着 —— 因为穿着会被替换，描述了反而可能让模型
 * 把原穿着"锁定"或与目标服装混淆。
 *
 * @param {string} selfieDataUrl 自拍的 dataURL
 * @returns {Promise<string>} 身份锚点描述，失败返回空字符串
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
              { type: "text", text: "请仔细观察这张照片中的人物，只描述其【不因换衣而改变】的身份特征，用于后续换装时锁定身份。必须包含：①脸型（圆脸/方脸/瓜子脸/鹅蛋脸等）②五官明显特征（如双眼皮、浓眉、高鼻梁、厚嘴唇等，没有则说『普通』）③发型（长短/直卷/刘海/发色）④肤色（白皙/偏黄/小麦色/偏黑等）⑤体型（偏瘦/标准/偏胖）⑥明显的脸部特征（眼镜/胡须/痣/酒窝等，没有则不写）。禁止描述任何穿着、服装、配饰、姿势、背景。输出格式：纯中文，分号分隔，不超过80字。" },
              { type: "image_url", image_url: { url: selfieDataUrl } },
            ],
          },
        ],
        max_tokens: 220,
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
    const cleaned = text.replace(/```[\s\S]*?```/g, "").trim().slice(0, 150);
    return cleaned || "";
  } catch (e) {
    console.log("[tryon] 身份锚点提取跳过:", e.message);
    return ""; // 失败不阻塞主流程
  }
}

/**
 * 用视觉模型提取商品图中目标服装的精确视觉细节。
 *
 * 关键改进：传入 region，让视觉模型只描述目标区域的服装，
 * 忽略模特身上的其它服装（避免描述了模特的整套穿搭，
 * 导致换装时把没买的部位也一起换掉）。
 *
 * @param {string} productDataUrl 商品图的 dataURL
 * @param {string} region 目标区域 upper/lower/full
 * @returns {Promise<string>} 服装细节描述，失败返回空字符串
 */
async function extractGarmentDetail(productDataUrl, region = "full") {
  try {
    const visionBase = (process.env.VISION_BASE_URL || process.env.IMAGE_BASE_URL || "https://apihub.agnes-ai.com/v1").replace(/\/$/, "");
    const visionKey = process.env.VISION_API_KEY || process.env.IMAGE_API_KEY;
    const visionModel = process.env.VISION_MODEL || "agnes-2.0-flash";
    if (!visionKey) return "";

    const regionHint = {
      upper: "只描述模特【上半身】穿的服装（上衣/外套等），忽略下半身",
      lower: "只描述模特【下半身】穿的服装（裤子/裙子等），忽略上半身",
      full: "描述模特穿的整套服装或连体款式",
    }[region] || "描述图中主要服装";

    const res = await fetch(`${visionBase}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${visionKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: visionModel,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: `请仔细观察这张图片中的服装（${regionHint}），用简洁中文描述其视觉细节。必须包含：①主色调和图案（印花/条纹/纯色/格子等）②款式类别（T恤/衬衫/裤子/连衣裙/套装/外套等）③版型特征（领型、袖长、衣长、裤长、宽松/修身）④面料质感观感（棉质/丝绸/牛仔/针织/雪纺等）⑤可见的装饰细节（扣子/刺绣/蕾丝/拉链等）。禁止描述模特的脸、发型、肤色、身材、姿势、背景。输出格式：分条列出，每条一句话，总共不超过120字。` },
            { type: "image_url", image_url: { url: productDataUrl } },
          ],
        }],
        max_tokens: 350,
      }),
    });
    if (!res.ok) return "";
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || json.choices?.[0]?.message?.reasoning_content || "";
    const text = typeof content === "string" ? content : JSON.stringify(content);
    const cleaned = text.replace(/```[\s\S]*?```/g, "").trim().slice(0, 250);
    return cleaned || "";
  } catch (e) {
    console.log("[tryon] 商品服装细节提取跳过:", e.message);
    return "";
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
  const t0 = Date.now();
  const log = (label) => console.log(`[tryon] ⏱ ${label} +${Date.now() - t0}ms`);

  // 商品主图：跨域 URL 在服务端转 base64（带缓存，避免手机网络下重复冷拉超时）
  // 缓存命中场景：/api/parse 预取虽失败但本次会话内曾成功拉过同一图
  log("开始");
  const productB64 = productImage ? await resolveToDataUrlCached(productImage) : null;
  log(productB64 ? `商品图已就绪 (${productB64.startsWith("data:") ? "dataURL" : "其他"})` : "商品图拉取失败，走模式 B");

  // ★ 关键步骤：用视觉模型提取
  //   ① 自拍中的"身份锚点"（脸/五官/发型/肤色/体型，不描述穿着）
  //   ② 商品图中目标区域的服装细节（按 region 聚焦，避免描述整套穿搭）
  // 并行提取，降低总耗时
  const region = garment?.region || "full";
  const [faceDescription, garmentDetail] = await Promise.all([
    extractFaceDescription(selfie),
    productB64 ? extractGarmentDetail(productB64, region) : Promise.resolve(""),
  ]);
  log("视觉提取完成");
  if (faceDescription) console.log(`[tryon] 身份锚点: ${faceDescription}`);
  if (garmentDetail) console.log(`[tryon] 商品服装细节 [${region}]: ${garmentDetail}`);

  const prompt = buildPrompt(garment, measurements, { productImage: !!productB64, faceDescription, garmentDetail });
  const image = await callImageApi({ selfie, productImage: productB64, prompt, region });
  log("图像生成完成");
  return { image };
}
