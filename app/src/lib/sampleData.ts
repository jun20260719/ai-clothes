// 示例数据：用于「一键体验」，无需自备链接与照片

/** 示例自拍（矢量人物插画，透明背景，试衣引擎会在此人身上合成服装） */
export const SAMPLE_SELFIE = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560">
  <g fill="#e5e7eb" stroke="#cbd5e1" stroke-width="2">
    <!-- 腿 -->
    <path d="M150,360 q-6,90 -8,180 l34,0 q4,-90 10,-180 Z"/>
    <path d="M250,360 q6,90 8,180 l-34,0 q-4,-90 -10,-180 Z"/>
    <!-- 躯干 -->
    <path d="M140,150 q60,-26 120,0 l18,80 q10,60 -2,130 l-30,0 q-12,-70 -26,-110 l-60,0 q-14,40 -26,110 l-30,0 q-12,-70 -2,-130 Z"/>
    <!-- 手臂 -->
    <path d="M138,152 q-30,10 -38,70 q-4,40 6,80 l20,0 q-8,-44 -2,-80 q8,-44 28,-56 Z"/>
    <path d="M262,152 q30,10 38,70 q4,40 -6,80 l-20,0 q8,-44 2,-80 q-8,-44 -28,-56 Z"/>
  </g>
  <!-- 颈 -->
  <rect x="184" y="118" width="32" height="40" rx="10" fill="#f1c9a5"/>
  <!-- 头发 -->
  <path d="M152,96 q0,-58 48,-58 q48,0 48,58 q0,18 -8,30 q-10,-30 -40,-30 q-30,0 -40,30 q-8,-12 -8,-30 Z" fill="#3f3f46"/>
  <!-- 脸 -->
  <circle cx="200" cy="96" r="46" fill="#f1c9a5"/>
  <!-- 五官 -->
  <circle cx="184" cy="92" r="4" fill="#3f3f46"/>
  <circle cx="216" cy="92" r="4" fill="#3f3f46"/>
  <path d="M188,112 q12,10 24,0" fill="none" stroke="#9a6a4f" stroke-width="3" stroke-linecap="round"/>
</svg>`)}`;

/** 示例购物链接（淘宝商品页格式） */
export const SAMPLE_LINK = "https://item.taobao.com/item.htm?id=732190000001";
