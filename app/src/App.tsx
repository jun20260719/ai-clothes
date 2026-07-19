import { useState } from "react";
import {
  Sparkles,
  Link2,
  Camera,
  Ruler,
  Wand2,
  ShieldCheck,
  Loader2,
  ClipboardPaste,
} from "lucide-react";
import "./App.css";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StepIndicator } from "@/components/StepIndicator";
import { LinkInput } from "@/components/LinkInput";
import { ProductCard } from "@/components/ProductCard";
import { SelfieUpload } from "@/components/SelfieUpload";
import { BodyMeasurements } from "@/components/BodyMeasurements";
import { TryOnResult } from "@/components/TryOnResult";
import { generateTryOn } from "@/lib/tryon";
import type {
  BodyMeasurements as BM,
  Garment,
  ParsedProduct,
  TryOnResult as TR,
} from "@/types";
import { toast, Toaster } from "sonner";

const EMPTY_MEASURE: BM = {
  gender: "",
  height: "",
  weight: "",
  bust: "",
  waist: "",
  hips: "",
  shoulder: "",
};

const FEATURES = [
  { icon: Link2, title: "一键粘贴链接", desc: "复制各大平台的商品链接，自动识别是否为服装" },
  { icon: Camera, title: "上传自拍", desc: "上传或拍摄一张照片，即可在线试穿" },
  { icon: Ruler, title: "补充身体数据", desc: "填写身高体重三围，试衣版型更贴合逼真" },
];

export default function App() {
  const [product, setProduct] = useState<ParsedProduct | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [selfieImg, setSelfieImg] = useState<HTMLImageElement | null>(null);
  const [measurements, setMeasurements] = useState<BM>(EMPTY_MEASURE);
  const [result, setResult] = useState<TR | null>(null);
  const [generating, setGenerating] = useState(false);

  const step = result
    ? 4
    : selfieImg
      ? 3
      : product?.isClothing
        ? 2
        : 1;

  const selectedGarment: Garment | undefined = product?.garments.find(
    (g) => g.id === selectedId,
  );

  const canGenerate = !!(
    product?.isClothing &&
    selectedGarment &&
    selfieImg &&
    !generating
  );

  async function generate() {
    if (!selectedGarment || !selfieImg) return;
    setGenerating(true);
    try {
      const res = await generateTryOn({
        selfie: selfieImg,
        garment: selectedGarment,
        measurements,
        productImageUrl: product?.imageUrl || null,
      });
      setResult(res);
      toast.success("试衣图已生成");
    } catch {
      toast.error("试衣生成失败，请重试");
    } finally {
      setGenerating(false);
    }
  }

  function resetLink() {
    setProduct(null);
    setSelectedId(null);
    setResult(null);
  }

  function handleAddManual(g: Garment) {
    setProduct((prev) =>
      prev ? { ...prev, garments: [...prev.garments, g], isClothing: true } : prev,
    );
    setSelectedId(g.id);
    setResult(null);
    toast.success("已添加服装，可继续上传自拍并试衣");
  }

  function resetResult() {
    setResult(null);
  }

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-fuchsia-500 text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="text-lg font-bold tracking-tight">AI 试衣魔镜</span>
          <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
            复制链接 · 上传自拍 · 在线试穿
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="hero-gradient relative overflow-hidden">
        <div className="mx-auto max-w-3xl px-4 py-12 text-center sm:py-16">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Wand2 className="h-3.5 w-3.5" /> 虚拟试衣 · Virtual Try-On
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">
            把心动的衣服，
            <br className="sm:hidden" />
            先穿在<span className="text-primary">自己</span>身上看看
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground sm:text-base">
            粘贴购物平台的商品链接，自动识别服装；上传一张自拍照，AI 帮你预览穿上身的效果，
            补充身体数据还能更逼真。
          </p>

          <div className="mx-auto mt-8 max-w-2xl">
            <Card className="border-border/60 shadow-lg">
              <CardContent className="p-4 sm:p-5">
                <LinkInput
                  onParsed={(p) => {
                    setProduct(p);
                    setSelectedId(p.isClothing ? p.garments[0]?.id ?? null : null);
                    setResult(null);
                  }}
                />
              </CardContent>
            </Card>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-border/60 bg-card/60 p-4 text-left backdrop-blur"
              >
                <f.icon className="h-5 w-5 text-primary" />
                <p className="mt-2 text-sm font-semibold">{f.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 主流程 */}
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8">
          <StepIndicator current={step} />
        </div>

        <div className="space-y-6">
          {/* 步骤2：商品 + 服装选择 */}
          {product && (
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardPaste className="h-4 w-4 text-primary" />
                  已识别商品
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ProductCard
                  product={product}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onReset={resetLink}
                  onAddManual={handleAddManual}
                />
              </CardContent>
            </Card>
          )}

          {/* 步骤3：自拍 + 身体数据 */}
          {product?.isClothing && selectedGarment && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Camera className="h-4 w-4 text-primary" />
                    上传你的自拍
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <SelfieUpload
                    selfieUrl={selfieUrl}
                    onCaptured={(url, img) => {
                      setSelfieUrl(url);
                      setSelfieImg(img);
                    }}
                    onRemove={() => {
                      setSelfieUrl(null);
                      setSelfieImg(null);
                      setResult(null);
                    }}
                  />
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Ruler className="h-4 w-4 text-primary" />
                    身体数据
                    <span className="ml-auto text-xs font-normal text-muted-foreground">
                      可选 · 越全越逼真
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <BodyMeasurements value={measurements} onChange={setMeasurements} />
                </CardContent>
              </Card>
            </div>
          )}

          {/* 生成按钮 */}
          {canGenerate && (
            <div className="flex flex-col items-center gap-3">
              <Button size="lg" className="h-12 px-8 text-base" onClick={generate}>
                <Wand2 className="mr-2 h-5 w-5" /> 生成试衣效果
              </Button>
              <p className="text-xs text-muted-foreground">
                优先调用 AI 试衣模型（需后端配置 base_url / api_key / model），未配置时回退本地预览
              </p>
            </div>
          )}

          {generating && (
            <Card className="border-border/60">
              <CardContent className="flex flex-col items-center gap-3 py-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">正在为你合成试衣效果…</p>
              </CardContent>
            </Card>
          )}

          {/* 步骤4：结果 */}
          {result && selfieUrl && (
            <Card className="border-primary/30 shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-primary" />
                  你的试衣效果
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TryOnResult
                  selfieUrl={selfieUrl}
                  result={result}
                  onReset={resetResult}
                />
              </CardContent>
            </Card>
          )}

          {/* 未识别为服装的提示 */}
          {product && !product.isClothing && (
            <Card className="border-border/60">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                该链接商品不是服装类，暂不支持试衣。换一个服装商品链接试试吧～
              </CardContent>
            </Card>
          )}
        </div>

        {/* 隐私说明 */}
        <div className="mt-10 flex items-start gap-2 rounded-xl border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            隐私说明：本地智能预览完全在浏览器内完成，照片<b>不会上传</b>。
            当你配置了 AI 试衣并点击「生成试衣效果」时，自拍照、商品主图与服装信息会通过你的后端转发给所配置的 AI 模型，用于生成试衣图；
            未配置 AI 试衣时则全程本地处理。
          </span>
        </div>
      </main>

      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        AI 试衣魔镜 · React + shadcn/ui 构建 · 演示版本
      </footer>

      <Toaster position="top-center" richColors closeButton />
    </div>
  );
}
