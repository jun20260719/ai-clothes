import { useEffect, useState } from "react";
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
import { estimateBodyViaApi } from "@/lib/api";
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

const MEASURE_KEY = "tryon:measurements";

/** 从 localStorage 读取已保存的身体数据（解析失败/无数据则回退空值） */
function loadMeasurements(): BM {
  try {
    const raw = localStorage.getItem(MEASURE_KEY);
    if (!raw) return EMPTY_MEASURE;
    const parsed = JSON.parse(raw) as Partial<BM>;
    const gender = parsed.gender === "female" || parsed.gender === "male" ? parsed.gender : "";
    const num = (v: unknown): number | "" =>
      typeof v === "number" && !Number.isNaN(v) ? v : "";
    return {
      gender,
      height: num(parsed.height),
      weight: num(parsed.weight),
      bust: num(parsed.bust),
      waist: num(parsed.waist),
      hips: num(parsed.hips),
      shoulder: num(parsed.shoulder),
    };
  } catch {
    return EMPTY_MEASURE;
  }
}

/** 把身体数据写入 localStorage（刷新/重开页面后可恢复） */
function saveMeasurements(m: BM) {
  try {
    localStorage.setItem(MEASURE_KEY, JSON.stringify(m));
  } catch {
    /* 隐私模式/容量满时静默忽略，不影响主流程 */
  }
}

const FEATURES = [
  { icon: Camera, title: "上传自拍", desc: "上传或拍摄一张照片，即可在线试穿" },
  { icon: Ruler, title: "补充身体数据", desc: "填写身高体重三围，试衣版型更贴合逼真" },
  { icon: Link2, title: "添加商品", desc: "粘贴购物平台链接，或直接上传服装图片" },
];

export default function App() {
  const [product, setProduct] = useState<ParsedProduct | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [selfieImg, setSelfieImg] = useState<HTMLImageElement | null>(null);
  const [measurements, setMeasurements] = useState<BM>(loadMeasurements);

  // 身体数据持久化：任意改动即写入 localStorage，刷新页面不丢失
  useEffect(() => {
    saveMeasurements(measurements);
  }, [measurements]);
  const [result, setResult] = useState<TR | null>(null);
  const [generating, setGenerating] = useState(false);
  const [estimating, setEstimating] = useState(false);

  const selectedGarment: Garment | undefined = product?.garments.find(
    (g) => g.id === selectedId,
  );

  const canGenerate = !!(
    product?.isClothing &&
    selectedGarment &&
    selfieImg &&
    !generating
  );

  // 新流程顺序：① 上传自拍 → ② 身体数据 → ③ 粘贴链接 → ④ 生成试衣
  const step = result
    ? 4
    : canGenerate || generating
      ? 4
      : product?.isClothing && selectedGarment
        ? 3
        : selfieImg
          ? 2
          : 1;

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
    } catch (e) {
      console.error("[generate] 试衣生成失败:", e);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`试衣生成失败：${msg}`);
    } finally {
      setGenerating(false);
    }
  }

  function resetLink() {
    setProduct(null);
    setSelectedId(null);
    setResult(null);
  }

  /** 用户手动修改试衣部位（上半身/下半身/全身）→ 更新选中服装的 region，生成时据此判定 */
  function handleRegionChange(region: "upper" | "lower" | "full") {
    if (!product) return;
    setProduct({
      ...product,
      garments: product.garments.map((g) =>
        g.id === selectedId ? { ...g, region } : g,
      ),
    });
    setResult(null);
  }

  /** AI 识别身体数据：上传全身照后一键估算并回填（已有值不被覆盖，便于微调） */
  async function handleEstimateBody() {
    if (!selfieUrl) return;
    setEstimating(true);
    try {
      const est = await estimateBodyViaApi(selfieUrl);
      setMeasurements((prev) => ({
        gender: est.gender || prev.gender,
        height: est.height ?? prev.height,
        weight: est.weight ?? prev.weight,
        bust: est.bust ?? prev.bust,
        waist: est.waist ?? prev.waist,
        hips: est.hips ?? prev.hips,
        shoulder: est.shoulder ?? prev.shoulder,
      }));
      toast.success("已根据照片估算身体数据，请核对后微调");
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === "NO_VISION") toast.error("未配置视觉识别模型，无法自动识别");
      else toast.error("身体数据识别失败，请手动填写");
    } finally {
      setEstimating(false);
    }
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
            上传一张自拍照并补充身体数据，AI 帮你预览穿上身的效果；再粘贴购物平台的商品链接，
            自动识别服装并试穿，数据越全越逼真。
          </p>

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
          {/* 步骤1+2：上传自拍 + 身体数据（始终可见，先填好再选商品） */}
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
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    onClick={handleEstimateBody}
                    disabled={!selfieUrl || estimating}
                    title={
                      selfieUrl
                        ? "根据上传的照片估算身体数据"
                        : "请先上传一张全身照片"
                    }
                  >
                    {estimating ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1.5 h-4 w-4" />
                    )}
                    AI 识别
                  </Button>
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  可选 · 越全越逼真 · 上传全身照后可点「AI 识别」自动估算（仅供参考，可微调）
                </p>
              </CardHeader>
              <CardContent>
                <BodyMeasurements value={measurements} onChange={setMeasurements} />
              </CardContent>
            </Card>
          </div>

          {/* 步骤3：粘贴商品链接 */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="h-4 w-4 text-primary" />
                添加商品（链接 / 图片）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LinkInput
                onParsed={(p) => {
                  setProduct(p);
                  setSelectedId(p.isClothing ? p.garments[0]?.id ?? null : null);
                  setResult(null);
                }}
              />
            </CardContent>
          </Card>

          {/* 已识别商品 + 服装选择 */}
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
                  onRegionChange={handleRegionChange}
                />
              </CardContent>
            </Card>
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
