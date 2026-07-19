// 全局类型定义

/** 支持识别的服装大类 */
export type GarmentType =
  | "tshirt" // T恤
  | "polo" // POLO衫
  | "shirt" // 衬衫
  | "hoodie" // 卫衣/连帽衫
  | "sweater" // 毛衣
  | "cardigan" // 针织开衫
  | "vest" // 马甲/背心外套
  | "jacket" // 夹克
  | "blazer" // 西装/西服
  | "coat" // 大衣/外套
  | "down" // 羽绒服
  | "windbreaker" // 风衣
  | "dress" // 连衣裙
  | "skirt" // 半身裙
  | "pants" // 裤子
  | "jeans" // 牛仔裤
  | "shorts" // 短裤
  | "tanktop" // 背心/吊带
  | "suit" // 套装（上衣+下衣）
  | "jumpsuit" // 连体裤/连身裤
  | "other"; // 其他/未知

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
  type: GarmentType;
  /** 中文名称，如「纯棉圆领短袖T恤」 */
  name: string;
  /** 主色（HEX），用于试衣合成 */
  color: string;
  /** 副色（HEX），用于装饰 */
  accentColor: string;
  /** 试衣覆盖区域：上半身 / 下半身 / 全身 */
  region: "upper" | "lower" | "full";
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
}
