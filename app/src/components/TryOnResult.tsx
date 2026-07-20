import { useState } from "react";
import { Download, Sparkles, RotateCcw, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { REGION_LABELS } from "@/lib/garments";
import type { TryOnResult } from "@/types";
import { ImageLightbox } from "@/components/ImageLightbox";

export function TryOnResult({
  selfieUrl,
  result,
  onReset,
}: {
  selfieUrl: string;
  result: TryOnResult;
  onReset: () => void;
}) {
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);

  function download() {
    const url = result.dataUrl || result.imageUrl || "";
    const a = document.createElement("a");
    a.href = url;
    a.download = `试衣-${result.garment.name || "效果"}-${Date.now()}.png`;
    a.click();
  }

  const resultSrc = result.dataUrl || result.imageUrl || "";

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <figure className="group relative overflow-hidden rounded-2xl border border-primary/40 shadow-md">
          <button
            type="button"
            onClick={() => setZoomSrc(resultSrc)}
            className="block w-full"
            title="点击放大查看"
          >
            <img
              src={resultSrc}
              alt="试衣结果"
              className="aspect-[3/4] w-full object-cover"
            />
          </button>
          <span className="pointer-events-none absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Maximize2 className="h-4 w-4 text-white" />
          </span>
          <figcaption className="flex items-center justify-center gap-2 bg-primary/10 px-3 py-2 text-center text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" /> 试衣效果
          </figcaption>
        </figure>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          逼真度 {result.quality}/100
        </Badge>
        <Badge variant="outline">{REGION_LABELS[result.garment.region]}</Badge>
        <Badge variant={result.imageUrl ? "default" : "secondary"}>
          {result.imageUrl ? "AI 试衣" : "本地预览"}
        </Badge>
        <span className="text-sm text-muted-foreground">{result.note}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={download}>
          <Download className="mr-1.5 h-4 w-4" /> 下载试衣图
        </Button>
        <Button variant="outline" onClick={onReset}>
          <RotateCcw className="mr-1.5 h-4 w-4" /> 再试一件
        </Button>
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
