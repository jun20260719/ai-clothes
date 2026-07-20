import { useState } from "react";
import { AlertTriangle, Store, Tag, Shirt, RefreshCw, Maximize2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { GARMENT_LABELS, REGION_OPTIONS } from "@/lib/garments";
import type { ParsedProduct } from "@/types";
import { cn } from "@/lib/utils";
import { ImageLightbox } from "@/components/ImageLightbox";

const PLATFORM_NAME: Record<string, string> = {
  taobao: "淘宝",
  tmall: "天猫",
  jd: "京东",
  pinduoduo: "拼多多",
  xianyu: "闲鱼",
  douyin: "抖音",
  unknown: "其他",
};

export function ProductCard({
  product,
  selectedId,
  onSelect,
  onReset,
  onRegionChange,
}: {
  product: ParsedProduct;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReset: () => void;
  /** 用户手动修改试衣部位（上半身/下半身/全身）时回调 */
  onRegionChange?: (region: "upper" | "lower" | "full") => void;
}) {
  const canRecognize = product.isClothing && product.garments.length > 0;
  const selectedGarment = product.garments.find((g) => g.id === selectedId);
  const [zoomImage, setZoomImage] = useState<string | null>(null);

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
            {product.incomplete ? "需确认" : product.mock ? "示例数据" : "真实解析"}
          </Badge>
          {product.cookieUsed && (
            <Badge variant="secondary" className="gap-1 bg-orange-100 text-orange-700">
              登录态识别
            </Badge>
          )}
          {product.aiRecognized && (
            <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-700">
              AI 识别
            </Badge>
          )}
          <span className="ml-auto text-lg font-bold text-primary">
            {product.price ? `¥${product.price}` : "价格未知"}
          </span>
        </div>

        <div className="mt-3 flex gap-3">
          {product.imageUrl && (
            <button
              type="button"
              onClick={() => setZoomImage(product.imageUrl)}
              className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border/60"
              title="点击放大查看"
            >
              <img
                src={product.imageUrl}
                alt={product.title}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/30 group-hover:opacity-100">
                <Maximize2 className="h-5 w-5 text-white" />
              </span>
            </button>
          )}
          <p className="line-clamp-3 text-sm font-medium leading-relaxed">
            {product.title}
          </p>
        </div>

        <Separator className="my-4" />

        {!product.isClothing ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
            <Tag className="h-4 w-4" />
            该商品不是服装类，暂不支持虚拟试衣。
          </div>
        ) : canRecognize ? (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <Shirt className="h-4 w-4 text-primary" />
              自动识别到 {product.garments.length} 件服装（点击选择）
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

            {/* 试衣部位：自动填充 + 可手动修改 */}
            {selectedGarment && (
              <div className="mt-4">
                <div className="mb-2 text-sm font-medium text-foreground">
                  试衣部位
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    已自动识别，可手动修改
                  </span>
                </div>
                <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
                  {REGION_OPTIONS.map((opt) => {
                    const active = selectedGarment.region === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => onRegionChange?.(opt.value)}
                        className={cn(
                          "flex-1 rounded-md px-3 py-1.5 transition-colors",
                          active
                            ? "bg-background font-medium shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              无法自动识别该服装信息（图片不清晰、非单一服装或识别模型未配置），无法进行下一步。
              请更换更清晰、仅含目标服装的图片，或改用商品链接。
            </span>
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="mt-4 text-muted-foreground"
          onClick={onReset}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          换一个链接 / 图片
        </Button>
      </CardContent>

      <ImageLightbox
        src={zoomImage}
        alt={product.title}
        open={!!zoomImage}
        onClose={() => setZoomImage(null)}
      />
    </Card>
  );
}
