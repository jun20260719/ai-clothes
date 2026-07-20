// 全局类型定义

/** 购物平台 */
export type Platform =
  | "taobao"
  | "tmall"
  | "jd"
  | "pinduoduo"
  | "xianyu"
  | "douyin"
  | "unknown";

/** 识别出的单件服装 */
export interface Garment {
  id: string;
  /** 中文名称，如「纯棉圆领短袖T恤」 */
  name: string;
  /** 试衣覆盖区域：上半身 / 下半身 / 全身 */
  region: "upper" | "lower" | "full";
  /**
   * 服装视觉细节描述（AI 识别阶段一次性产出，合并了原试衣阶段的二次视觉提取）。
   * 前端可在 textarea 中编辑，生成试衣时透传给 /api/tryon 作为 prompt 参考，
   * 省去试衣时再调一次视觉模型。
   */
  detail?: string;
}

/** 链接解析结果 */
export interface ParsedProduct {
  url: string;
  platform: Platform;
  /** 商品标题 */
  title: string;
  /** 主图（MVP 用占位/示例图，真实场景为商品图） */
  imageUrl: string;
  /** 价格（元） */
  price: number;
  /** 店铺名 */
  shop: string;
  /** 是否为服装类 */
  isClothing: boolean;
  /** 识别出的服装列表 */
  garments: Garment[];
  /** 是否为真实解析（false 表示 MVP 示例数据） */
  mock: boolean;
  /** 详情抓取不全（平台反爬拦截，需在端手动确认服装类型） */
  incomplete?: boolean;
  /** 商品 id（从链接提取，如淘宝 num_iid） */
  itemId?: string;
  /** 是否使用淘宝登录态 Cookie 完成识别 */
  cookieUsed?: boolean;
  /** 是否由 AI 视觉模型通过商品图自动识别补全（区别于纯文本解析 / 手动选择） */
  aiRecognized?: boolean;
}

/** 用户身体数据（均可选，越多越逼真） */
export interface BodyMeasurements {
  gender: "female" | "male" | "";
  /** 身高 cm */
  height: number | "";
  /** 体重 kg */
  weight: number | "";
  /** 胸围 cm */
  bust: number | "";
  /** 腰围 cm */
  waist: number | "";
  /** 臀围 cm */
  hips: number | "";
  /** 肩宽 cm */
  shoulder: number | "";
}

/** 试衣结果 */
export interface TryOnResult {
  /** 结果图 dataURL（本地 Canvas 预览） */
  dataUrl?: string;
  /** 结果图 URL（AI 模型返回，优先于 dataUrl 展示） */
  imageUrl?: string;
  /** 生成时间戳 */
  createdAt: number;
  /** 逼真度评分 0-100（依据身体数据完整度与匹配度） */
  quality: number;
  /** 使用的服装 */
  garment: Garment;
  /** 备注（如缺少哪些数据） */
  note: string;
  /** 生成该结果所用的「修正建议 / 补充要求」（首次生成为空，重新生成时记录用户当时填写的反馈） */
  feedback?: string;
}
