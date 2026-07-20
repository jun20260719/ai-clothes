import { useRef, useState } from "react";
import { Link2, Sparkles, Loader2, Upload, ImageIcon, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseProduct } from "@/lib/parseLink";
import { compressDataUrl, isImageFile, readImageFileAsDataUrl } from "@/lib/image";
import { recognizeProductImageApi } from "@/lib/api";
import { SAMPLE_LINK } from "@/lib/sampleData";
import type { Garment, ParsedProduct } from "@/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ImageLightbox } from "@/components/ImageLightbox";

type Mode = "link" | "image";

export function LinkInput({
  onParsed,
  onStart,
}: {
  onParsed: (p: ParsedProduct) => void;
  onStart?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("link");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [zoomPreview, setZoomPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function runParse(value: string) {
    const raw = (value || "").trim();
    if (!raw) {
      toast.error("请先粘贴商品链接");
      return;
    }
    // 从分享文案 / 淘口令中尝试提取出 http(s) 链接
    const urlMatch = raw.match(/https?:\/\/[^\s，。、）)]+/i);
    const url = urlMatch ? urlMatch[0] : raw;
    if (!/^https?:\/\//i.test(url)) {
      const looksTaobao =
        /￥|tb\.cn|淘宝|天猫|复制打开|长按复制|口令|item\.taobao|detail\.tmall/i.test(raw);
      toast.error(
        looksTaobao
          ? "检测到淘口令或分享文案，请粘贴以 http(s) 开头的完整商品链接（在 App 内「分享 → 复制链接」获取）"
          : "请输入有效的商品链接（以 http/https 开头）",
      );
      return;
    }
    setLoading(true);
    onStart?.();
    try {
      const product = await parseProduct(url);
      onParsed(product);
      if (!product.isClothing) {
        toast.warning("该链接商品不是服装类，暂不支持试衣");
      } else {
        toast.success(
          product.mock
            ? "已识别为服装（示例数据，接后端后为真实解析）"
            : "已解析真实商品并识别为服装",
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "解析失败");
    } finally {
      setLoading(false);
    }
  }

  /** 直接上传服装图片：压缩后调用视觉模型自动识别服装类型与颜色 */
  async function handleImage(file: File) {
    if (!isImageFile(file)) {
      toast.error("请选择图片文件");
      return;
    }
    setLoading(true);
    onStart?.();
    try {
      const raw = await readImageFileAsDataUrl(file);
      const compressed = await compressDataUrl(raw, 1280, 0.85);
      setPreview(compressed);

      // 自动识别：把压缩后的图发给后端视觉模型，识别服装类型与颜色
      const rec = await recognizeProductImageApi(compressed);
      if (!rec.recognized || !rec.garment) {
        toast.error("无法自动识别这件服装，请更换更清晰、仅含服装的图片后重试");
        return;
      }
      const g = rec.garment as Garment;
      const product: ParsedProduct = {
        url: `file://${file.name}`,
        platform: "unknown",
        title: g.name || file.name.replace(/\.[^.]+$/, ""),
        imageUrl: compressed, // 上传图即商品主图，也是试衣时的服装参考图
        price: 0,
        shop: "",
        isClothing: true,
        garments: [g],
        mock: false,
        incomplete: false,
        aiRecognized: true,
      };
      onParsed(product);
      toast.success("已自动识别服装信息，可直接试衣");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "图片处理失败";
      const code = (e as Error & { code?: string }).code;
      if (code === "NO_VISION") {
        toast.error("后端未配置视觉识别模型，无法自动识别上传的图片");
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      {/* 模式切换：粘贴链接 / 上传图片 */}
      <div className="mb-3 flex gap-1 rounded-lg bg-muted p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode("link")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
            mode === "link"
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Link2 className="h-3.5 w-3.5" /> 粘贴链接
        </button>
        <button
          type="button"
          onClick={() => setMode("image")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
            mode === "image"
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Upload className="h-3.5 w-3.5" /> 上传图片
        </button>
      </div>

      {mode === "link" ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text");
                  if (/^https?:\/\//i.test(text.trim())) {
                    setTimeout(() => runParse(text), 0);
                  }
                }}
                placeholder="粘贴淘宝 / 天猫 / 京东 / 拼多多 商品链接…"
                className="h-12 pl-10 text-base"
              />
            </div>
            <Button
              size="lg"
              className="h-12 px-6"
              onClick={() => runParse(url)}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              识别服装
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <span>没有链接？试试</span>
            <button
              className="font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setUrl(SAMPLE_LINK);
                runParse(SAMPLE_LINK);
              }}
              disabled={loading}
            >
              示例商品
            </button>
            <span>一键体验完整流程</span>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImage(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : (
              <ImageIcon className="h-6 w-6" />
            )}
            <span>点击选择服装图片（支持 JPG / PNG / WEBP）</span>
            <span className="text-xs text-muted-foreground/80">
              上传后将自动识别服装类型与颜色
            </span>
          </button>
          {preview && (
            <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
              <button
                type="button"
                onClick={() => setZoomPreview(preview)}
                className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border/60"
                title="点击放大查看"
              >
                <img
                  src={preview}
                  alt="已上传的服装"
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/30 group-hover:opacity-100">
                  <Maximize2 className="h-4 w-4 text-white" />
                </span>
              </button>
              <div className="text-xs text-muted-foreground">
                已载入服装图片，正在/已自动识别服装信息。
              </div>
            </div>
          )}
        </div>
      )}

      <ImageLightbox
        src={zoomPreview}
        alt="已上传的服装"
        open={!!zoomPreview}
        onClose={() => setZoomPreview(null)}
      />
    </div>
  );
}
