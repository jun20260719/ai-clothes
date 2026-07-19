import { useState } from "react";
import { Store, Tag, Shirt, RefreshCw, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { GARMENT_LABELS, REGION_MAP, COLOR_PALETTE } from "@/lib/garments";
import type { Garment, GarmentType, ParsedProduct } from "@/types";
import { cn } from "@/lib/utils";

const PLATFORM_NAME: Record<string, string> = {
  taobao: "淘宝",
  tmall: "天猫",
  jd: "京东",
  pinduoduo: "拼多多",
  xianyu: "闲鱼",
  douyin: "抖音",
  unknown: "其他",
};

const MANUAL_TYPES: GarmentType[] = [
  "tshirt", "shirt", "hoodie", "sweater", "jacket", "coat",
  "dress", "skirt", "pants", "shorts", "tanktop",
];

export function ProductCard({
  product,
  selectedId,
  onSelect,
  onReset,
  onAddManual,
}: {
  product: ParsedProduct;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReset: () => void;
  onAddManual: (g: Garment) => void;
}) {
  const [pickType, setPickType] = useState<GarmentType>("tshirt");
  const [pickColor, setPickColor] = useState<string>(COLOR_PALETTE[0]);

  // 未识别到具体服装（被反爬拦截、或平台无详情）→ 引导手动选择
  const needManual = product.garments.length === 0;

  function confirmManual() {
    const g: Garment = {
      id: `manual-${Date.now().toString(36)}`,
      type: pickType,
      name: GARMENT_LABELS[pickType],
      color: pickColor,
      accentColor: pickColor,
      region: REGION_MAP[pickType],
    };
    onAddManual(g);
  }

  return (
    <Card className="overflow-hidden border-border/60 shadow-sm">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <Store className="h-3 w-3" />
            {PLATFORM_NAME[product.platform]}
          </Badge>
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <Store className="h-3 w-3" />
            {product.shop || "未知店铺"}
          </Badge>
          <Badge
            variant={product.mock ? "outline" : "default"}
            className="gap-1"
          >
            {product.incomplete ? "需手动确认" : product.mock ? "示例数据" : "真实解析"}
          </Badge>
          {product.cookieUsed && (
            <Badge variant="secondary" className="gap-1 bg-orange-100 text-orange-700">
              登录态识别
            </Badge>
          )}
          <span className="ml-auto text-lg font-bold text-primary">
            {product.price ? `¥${product.price}` : "价格未知"}
          </span>
        </div>

        <div className="mt-3 flex gap-3">
          {product.imageUrl && (
            <img
              src={product.imageUrl}
              alt={product.title}
              className="h-20 w-20 shrink-0 rounded-lg border border-border/60 object-cover"
            />
          )}
          <p className="line-clamp-3 text-sm font-medium leading-relaxed">
            {product.title}
          </p>
        </div>

        <Separator className="my-4" />

        {product.isClothing ? (
          needManual ? (
            <div className="space-y-4">
              {product.incomplete && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <Tag className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    未能自动获取完整商品信息（已识别标题，但主图缺失或服装类型未自动识别）。
                    请手动选择服装类型与颜色，即可继续试衣。
                  </span>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <Shirt className="h-4 w-4 text-primary" /> 手动选择服装
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {MANUAL_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setPickType(t)}
                      className={cn(
                        "rounded-lg border px-2 py-2 text-xs transition-colors",
                        pickType === t
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/50",
                      )}
                    >
                      {GARMENT_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium">颜色</div>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      onClick={() => setPickColor(c)}
                      className={cn(
                        "h-7 w-7 rounded-full border-2 transition-all",
                        pickColor === c
                          ? "border-primary ring-2 ring-primary/30"
                          : "border-black/10",
                      )}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>

              <Button onClick={confirmManual} className="w-full">
                <Plus className="mr-1.5 h-4 w-4" /> 确认并试衣
              </Button>
            </div>
          ) : (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <Shirt className="h-4 w-4 text-primary" />
                识别到 {product.garments.length} 件服装
              </div>
              <div className="flex flex-wrap gap-2">
                {product.garments.map((g) => {
                  const active = g.id === selectedId;
                  return (
                    <button
                      key={g.id}
                      onClick={() => onSelect(g.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/50",
                      )}
                    >
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-black/10"
                        style={{ background: g.color }}
                      />
                      {GARMENT_LABELS[g.type]}
                      <span className="max-w-[140px] truncate text-xs text-muted-foreground">
                        {g.name.replace(GARMENT_LABELS[g.type], "")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
            <Tag className="h-4 w-4" />
            该商品不是服装类，暂不支持虚拟试衣。
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="mt-4 text-muted-foreground"
          onClick={onReset}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          换一个链接
        </Button>
      </CardContent>
    </Card>
  );
}
