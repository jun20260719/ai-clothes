import { Download, Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GARMENT_LABELS } from "@/lib/garments";
import type { TryOnResult } from "@/types";

export function TryOnResult({
  selfieUrl,
  result,
  onReset,
}: {
  selfieUrl: string;
  result: TryOnResult;
  onReset: () => void;
}) {
  function download() {
    const url = result.dataUrl || result.imageUrl || "";
    const a = document.createElement("a");
    a.href = url;
    a.download = `试衣-${GARMENT_LABELS[result.garment.type]}-${Date.now()}.png`;
    a.click();
  }

  const resultSrc = result.dataUrl || result.imageUrl || "";

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <figure className="overflow-hidden rounded-2xl border border-border/60">
          <img src={selfieUrl} alt="原图" className="aspect-[3/4] w-full object-cover" />
          <figcaption className="bg-muted/40 px-3 py-2 text-center text-xs text-muted-foreground">
            原图
          </figcaption>
        </figure>
        <figure className="overflow-hidden rounded-2xl border border-primary/40 shadow-md">
          <img
            src={resultSrc}
            alt="试衣结果"
            className="aspect-[3/4] w-full object-cover"
          />
          <figcaption className="flex items-center justify-center gap-2 bg-primary/10 px-3 py-2 text-center text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" /> 试衣效果
          </figcaption>
        </figure>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          逼真度 {result.quality}/100
        </Badge>
        <Badge variant="outline">{GARMENT_LABELS[result.garment.type]}</Badge>
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
    </div>
  );
}
