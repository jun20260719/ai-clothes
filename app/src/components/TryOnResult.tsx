import { useState } from "react";
import { Download, Sparkles, Maximize2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { REGION_LABELS } from "@/lib/garments";
import type { TryOnResult } from "@/types";
import { ImageLightbox } from "@/components/ImageLightbox";

export function TryOnResult({
  selfieUrl,
  results,
  onReset,
}: {
  selfieUrl: string;
  results: TryOnResult[];
  onReset: () => void;
}) {
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);

  const latest = results[results.length - 1];

  function download(result: TryOnResult, index: number) {
    const url = result.dataUrl || result.imageUrl || "";
    const a = document.createElement("a");
    a.href = url;
    a.download = `试衣-${result.garment.name || "效果"}-${index + 1}-${Date.now()}.png`;
    a.click();
  }

  return (
    <div className="w-full">
      {/* 最新结果摘要 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          逼真度 {latest.quality}/100
        </Badge>
        <Badge variant="outline">{REGION_LABELS[latest.garment.region]}</Badge>
        <Badge variant={latest.imageUrl ? "default" : "secondary"}>
          {latest.imageUrl ? "AI 试衣" : "本地预览"}
        </Badge>
        <span className="text-sm text-muted-foreground">{latest.note}</span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={onReset}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> 重新开始
        </Button>
      </div>

      {/* 原图 + 所有试衣结果（追加展示，不删除历史） */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* 原图参考列 */}
        <figure className="group relative overflow-hidden rounded-2xl border border-border/60">
          <button
            type="button"
            onClick={() => setZoomSrc(selfieUrl)}
            className="block w-full"
            title="点击放大查看"
          >
            <img src={selfieUrl} alt="原图" className="aspect-[3/4] w-full object-cover" />
          </button>
          <span className="pointer-events-none absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Maximize2 className="h-4 w-4 text-white" />
          </span>
          <figcaption className="bg-muted/40 px-3 py-2 text-center text-xs text-muted-foreground">
            原图
          </figcaption>
        </figure>

        {/* 每个试衣结果一列 */}
        {results.map((r, i) => {
          const src = r.dataUrl || r.imageUrl || "";
          return (
            <figure
              key={r.createdAt}
              className="group relative overflow-hidden rounded-2xl border border-primary/40 shadow-md"
            >
              <button
                type="button"
                onClick={() => setZoomSrc(src)}
                className="block w-full"
                title="点击放大查看"
              >
                <img
                  src={src}
                  alt={`试衣结果 ${i + 1}`}
                  className="aspect-[3/4] w-full object-cover"
                />
              </button>
              <span className="pointer-events-none absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <Maximize2 className="h-4 w-4 text-white" />
              </span>
              <figcaption className="flex flex-col gap-1 bg-primary/10 px-3 py-2 text-center">
                <span className="flex items-center justify-center gap-1.5 text-xs font-medium text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  {i === 0 ? "试衣效果（初始）" : `试衣效果 #${i + 1}`}
                </span>
                {r.feedback ? (
                  <span
                    className="line-clamp-2 text-[11px] leading-tight text-muted-foreground"
                    title={r.feedback}
                  >
                    基于建议：{r.feedback}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">初始生成</span>
                )}
              </figcaption>
              <div className="flex justify-center px-3 pb-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => download(r, i)}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" /> 下载
                </Button>
              </div>
            </figure>
          );
        })}
      </div>

      <ImageLightbox
        src={zoomSrc}
        alt="放大查看"
        open={!!zoomSrc}
        onClose={() => setZoomSrc(null)}
      />
    </div>
  );
}
