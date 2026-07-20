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
 *
 * 未配置 IMAGE_API_KEY / IMAGE_MODEL 时抛出明确错误，前端回退到本地 Canvas 预览。
 */

// 服装类型/颜色已不再作为 garment 字段；试衣由商品原图直接驱动，
// 款式/颜色由「识别阶段一次性产出的 garment.detail」描述（前端可编辑），
// region 决定覆盖部位。试衣时不再二次调用视觉模型提取细节，节省一次 AI 调用。


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
 * 构造给图像生成模型的 prompt。
 *
 * 双图试衣工作流（按用户要求的描述方式）：
 *   ① 根据两张图片生成一张新图片
 *   ② 第一张 = 用户上传照片（身份来源，必须完整保留）
 *   ③ 第二张 = 商品图片（仅取服装）
 *   ④ 只提取第二张的衣服，替换到第一张人物身上，输出新图
 *   ⑤ 新图要自然贴合身材，褶皱与光影真实，边缘无缝融合
 */
function buildPrompt(garment = {}, m = {}, opts = {}) {
  const region = garment.region || "full"; // upper / lower / full
  const name = garment.name || "";

  // 用户累积的「修正建议 / 补充要求」（多次重新生成时不断追加到整体上下文）
  const feedback = (opts.feedback || "").toString().trim();

  // 身体数据
  const fit = [];
  if (m.gender) fit.push(m.gender === "male" ? "男性" : m.gender === "female" ? "女性" : m.gender);
  if (m.height) fit.push(`身高${m.height}cm`);
  if (m.weight) fit.push(`体重${m.weight}kg`);
  if (m.bust) fit.push(`胸围${m.bust}cm`);
  if (m.waist) fit.push(`腰围${m.waist}cm`);
  if (m.hips) fit.push(`臀围${m.hips}cm`);
  if (m.shoulder) fit.push(`肩宽${m.shoulder}cm`);
  const fitText = fit.length ? `身材参考：${fit.join("，")}。` : "";

  const garmentDetail = opts.garmentDetail || "";

  // 区域：只提取图 2 的哪个部位服装
  const REGION_GUIDE = {
    upper: { scope: "只提取第二张图中的【上身服装】（颈部/肩膀到腰臀之间），替换第一张人物的上身服装", keep: "下半身服装（裤子/裙子/鞋）必须与原图完全一致，禁止改动。" },
    lower: { scope: "只提取第二张图中的【下身服装】（腰部到脚踝），替换第一张人物的下身服装", keep: "上半身服装（上衣/外套）必须与原图完全一致，禁止改动。" },
    full:  { scope: "提取第二张图中的整套服装（或连体款式），替换第一张人物的全身服装", keep: "" },
  };
  const guide = REGION_GUIDE[region] || REGION_GUIDE.full;

  // ── 双图模式：有商品图 ──
  if (opts.productImage) {
    return [
      `你将根据两张图片生成一张新图片。`,
      `第一张：用户本人照片，必须完整保留其脸、发型、体型、姿势、背景。`,
      `第二张：商品（服装）图片。`,
      `任务：${guide.scope}，输出这张新图片。`,
      ``,
      `身份锁定：输出的人物必须与第一张图是同一人，脸型 / 五官 / 发型 / 肤色 / 体型 / 姿势 / 背景 100% 保持原样，严禁参考第二张图中模特的任何特征。`,
      guide.keep ? `区域保持：${guide.keep}` : ``,
      `质量：${garmentDetail ? "目标服装参考：" + garmentDetail + "。" : `目标服装类型：服装，主色：未指定颜色。`}${fitText}自然贴合身材，褶皱与光影真实，边缘与皮肤无缝融合。`,
    ].filter(Boolean).join("\n");

    return [
      `基于两张参考图进行真实人像换装编辑:`,
      `以图1作为唯一人物底图和场景底图：`,
      `图1中的人物身份、脸部五官、脸型、肤色、发型、发际线、表情、头部角度、身体姿势、肢体动作、站姿、体型比例、背景环境、画面构图、光线方向、色调和景深必须完整保留，不允许重新生成、不允许美化、不允许微调五官、不允许改变脸型、不允许改变发型、不允许改变姿势、不允许改变背景。人物皮肤质感保持原图真实自然。`,
      // `${fitText}自然贴合身材，褶皱与光影真实，边缘与皮肤无缝融合。`,
      `以图2作为服装参考图：`,
      `${guide.scope}, 忽略图 2 模特`,
      `编辑目标：`,
      `将图1人物身上的原有服装替换为图2中的全套服装。`,
      `${garmentDetail ? "图 2 服装描述：" + garmentDetail + "。" : (name ? `图 2 服装描述：${name}。` : "")}`,
      `服装融合要求：`,
      `服装边缘必须与脖颈、肩膀、手臂、腰部、腿部自然贴合，袖口、领口、裙腰、裙摆位置合理，布料褶皱跟随图1人物动作产生，阴影、高光、反光、色温与图1原图环境光一致。服装不能浮空，不能穿模，不能有白边，不能像贴图，不能出现两套衣服重叠。`,
      `画质要求：`,
      `真实人像摄影质感，高清写实，细节清晰，面料纹理、刺绣花纹、布料垂坠感清楚自然。整体画面保持图1原有真实摄影风格，不改变原图氛围。`,

      // `你需要根据两张图片生成一张新图片。`,
      // `第一张：用户本人照片，必须完整保留其脸、发型、体型、姿势、背景。`,
      // `第二张：商品（服装）图片。`,
      // `任务：${guide.scope}，输出这张新图片。`,
      // `身份锁定：输出的人物必须与图 1  是同一人，脸型 / 五官 / 发型 / 肤色 / 体型 / 姿势 / 背景 100% 保持原样，严禁参考图 2 中模特的任何特征。`,
      // guide.keep ? `区域保持：${guide.keep}` : ``,
      // `${garmentDetail ? "目标服装描述：" + garmentDetail + "。" : (name ? `目标服装描述：${name}。` : "")}${fitText}自然贴合身材，褶皱与光影真实，边缘与皮肤无缝融合。`,
      feedback ? `用户修正建议(这个优先级最高)：\n${feedback}` : "",
    ].filter(Boolean).join("\n");
  }

  // ── 单图兜底：无商品图，仅文字标签 ──
  return [
    `你将修改这张用户照片：把人物服装替换为目标服装，其余（脸、发型、体型、姿势、背景）100% 保持原样。`,
    `目标服装：${name || "服装"}。${fitText}只替换服装，自然贴合身材，褶皱与光影真实，边缘无缝融合。`,
    feedback ? `用户修正建议(优先级最高)：\n${feedback}` : "",
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

  const headers = {
    Authorization: `Bearer ${process.env.IMAGE_API_KEY}`,
    "Content-Type": "application/json",
  };

  // 负面提示：强化身份锁定（图 1  的人不被图 2 的模特替换）
  const negativePrompt = [
    "改变人物身份",
    "替换为第二张图的模特脸/发型/肤色/身材",
    "改变背景或姿势",
    "服装与身材不贴合",
    "白边、拼接痕迹、浮空服装",
  ].join("，");

  // Agnes / OpenAI 兼容网关风格：图生图走 extra_body.image（数组，支持多张）
  // 真试衣模式图序：[自拍照(底图/主体), 商品图(服装参考)]
  // 图 1  是用户本人（需完整保留脸/身体/姿势/背景），第二张仅提取服装款式
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
      image: images,
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
 * 运行 AI 试衣
 * @param {{selfie:string, garment?:object, measurements?:object, productImage?:string, feedback?:string}} params
 *   productImage 为商品主图（URL 或 dataURL）。提供时走「真试衣」：以自拍为底，把商品服装穿到用户身上。
 *   garment.detail 为识别阶段产出的服装视觉细节描述（前端可编辑），直接作为试衣 prompt 参考，
 *   不再在试衣阶段二次调用视觉模型提取，节省一次 AI 调用。
 *   feedback 为用户累积的「修正建议 / 补充要求」（多次重新生成时不断追加），会并入 prompt 整体上下文。
 * @returns {Promise<{image:string}>}
 */
export async function runTryOn({ selfie, garment, measurements, productImage, feedback }) {
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

  // ★ 服装细节：直接复用识别阶段产出、经用户确认/编辑的 garment.detail，
  //   不再在试衣阶段调用视觉模型二次提取（原 extractGarmentDetail 已移除）。
  const region = garment?.region || "full";
  const garmentDetail = typeof garment?.detail === "string" ? garment.detail.trim() : "";
  if (garmentDetail) console.log(`[tryon] 商品服装细节 [${region}]: ${garmentDetail}`);
  else console.log(`[tryon] 无服装细节描述，将退回 garment.name 兜底`);
  log("准备 prompt");

  const prompt = buildPrompt(garment, measurements, { productImage: !!productB64, garmentDetail, feedback });
  console.log(`[tryon] 生成图像 prompt: ${prompt}`);
  const image = await callImageApi({ selfie, productImage: productB64, prompt, region });
  log("图像生成完成");
  return { image };
}
