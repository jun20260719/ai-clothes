# AI 试衣魔镜 · 后端服务

提供两个能力，前端会优先调用本服务，失败时自动回退到本地 mock / Canvas 预览，
因此**没有后端时静态站点也能正常运行**。

## 1. 商品链接解析 `GET /api/parse?url=...`
- 抓取目标页面，提取 Open Graph / Twitter / JSON-LD 元数据，并兜底解析页面内嵌 `<script>` JSON
- 返回商品标题、主图、价格、店铺、平台，以及服装类目识别结果
- **手机分享短链**（`e.tb.cn/h/xxx`、`m.tb.cn` 等）落地页是 JS 跳转，真实商品链接嵌在 HTML 中；
  后端会先抓落地页、正则提取 `item.taobao.com/item.htm?id=...`、再以登录态 Cookie **二次抓取**拿到真实详情。
- **淘宝 / 天猫强反爬**：配置 `TAOBAO_COOKIE`（见 `.env.example`）后，后端会以你的登录态请求商品页，
  通常能拿到**真实商品标题/主图/价格**；未配置或 Cookie 失效时，自动回退到 OG 抓取 + 前端手动选服装兜底。
- Cookie 获取：浏览器登录淘宝/天猫 → F12 → Network → 复制任意商品页请求的 `Cookie` 头整段 → 填入 `TAOBAO_COOKIE`。
  Cookie 会过期（几天~几周），失效后重新复制即可。该凭证仅用于你本地解析，请勿泄露或提交 git。
- **判定规则**：`未知平台`（非购物站，如 example.com）才返回 `isClothing:false`；
  只要是**购物平台链接**（淘宝/天猫/京东/拼多多等），一律当作可试衣——标题命中服装关键词则自动识别，
  未命中（如标题是"图片/自定义"类商品）则标记 `incomplete`，由前端**手动选服装**继续，绝不直接判"非服装"。

## 2. AI 试衣 `POST /api/tryon`
请求体：
```json
{
  "selfie": "<dataURL 自拍照>",
  "garment": { "type": "tshirt", "color": "red", "region": "upper" },
  "measurements": { "gender": "female", "height": "165", "weight": "52", "...": "..." },
  "productImage": "<商品主图 URL 或 dataURL，可选>"
}
```
- **换脸式试衣（提供 productImage 时）**：保留商品图里模特的**姿势/服装/背景**，
  把**用户自拍的脸**合成上去。后端把商品图（服务端拉取转 dataURL，规避跨域）与自拍一起作为多图输入，
  prompt 指示「保留第一张图的构图与服装，仅替换人脸」。
- **描述式试衣（无 productImage 时）**：后端把**自拍照作为基础图像**、配合**描述服装的文本 prompt**，
  由模型把服装「穿」到用户身上并生成合成图返回。
- **默认对接 Agnes Image 2.0 Flash**（文档 https://agnes-ai.com/zh-Hans/docs/agnes-image-20-flash）：
  - 端点 `POST /images/generations`（JSON 体），`Authorization: Bearer <key>`
  - 图生图：自拍照放进 `extra_body.image`（数组，支持 Data URI）
  - 输出格式：`extra_body.response_format = "b64_json" | "url"`
  - 模型名 `agnes-image-2.0-flash`，基地址 `https://apihub.agnes-ai.com/v1`
- 配置（见 `.env.example`），默认值已按 Agnes 填好，按需改 `base_url` / `api_key` / `model`：
  - `IMAGE_BASE_URL`：接口基地址（兼容 OpenAI 风格）
  - `IMAGE_API_KEY`：API Key
  - `IMAGE_MODEL`：模型名（如 `agnes-image-2.0-flash`）
  - 可选：`IMAGE_ENDPOINT`（默认 `/images/generations`）、`IMAGE_SIZE`、`IMAGE_INPUT_IMAGE`
- 未配置 `IMAGE_API_KEY` / `IMAGE_MODEL` 时返回 `503`，前端回退到本地 Canvas 预览。

## 运行
```bash
cd server
npm install
cp .env.example .env   # 填写 token / 模型版本
npm start              # 默认 http://localhost:8787
```

前端开发时通过 Vite 代理把 `/api` 转发到本服务（见 app/vite.config.ts），
生产部署时把本服务与前端放在同源或由 `VITE_API_BASE` 指定地址即可。
