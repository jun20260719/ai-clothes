import { useRef, useState } from "react";
import { Upload, ImageIcon, Camera, X, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SAMPLE_SELFIE } from "@/lib/sampleData";
import { compressDataUrl, imgElToCompressedDataUrl } from "@/lib/image";
import { toast } from "sonner";

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 是否为 HEIC/HEIF 格式（iPhone 常见，多数浏览器无法直接显示，需转换） */
function isHeic(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".heic") ||
    name.endsWith(".heif") ||
    file.type === "image/heic" ||
    file.type === "image/heif"
  );
}

/** HEIC → JPEG dataURL（浏览器端利用 heic2any 的 wasm 转换） */
async function convertHeicToDataUrl(file: File): Promise<string> {
  const heic2any = (await import("heic2any")).default;
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  const blob: Blob = Array.isArray(out) ? out[0] : out;
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function SelfieUpload({
  selfieUrl,
  onCaptured,
  onRemove,
}: {
  selfieUrl: string | null;
  onCaptured: (dataUrl: string, img: HTMLImageElement) => void;
  onRemove: () => void;
}) {
  const [drag, setDrag] = useState(false);
  const [showCam, setShowCam] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/") && !isHeic(file)) {
      toast.error("请选择图片文件");
      return;
    }
    setBusy(true);
    try {
      let rawUrl: string;
      if (isHeic(file)) {
        toast.loading("正在转换 HEIC 图片为 JPEG…");
        rawUrl = await convertHeicToDataUrl(file);
        toast.success("HEIC 已成功转换");
      } else {
        rawUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
      }
      // 关键：手机原图可能 3000x4000+ / 几 MB，必须立即压缩为 ≤1280 长边 JPEG，
      // 否则状态里存的大 dataURL 会拖慢渲染、且后续 toDataURL 会触发 iOS canvas 限制。
      const compressed = await compressDataUrl(rawUrl, 1280, 0.85);
      const img = await loadImageEl(compressed);
      onCaptured(compressed, img);
    } catch (e) {
      console.error("[SelfieUpload] 图片处理失败:", e);
      toast.error("图片处理失败：HEIC 转换需浏览器支持（推荐用 Chrome/Edge）");
    } finally {
      setBusy(false);
    }
  }

  function useSample() {
    loadImageEl(SAMPLE_SELFIE).then((img) => onCaptured(SAMPLE_SELFIE, img));
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      setShowCam(true);
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 50);
    } catch {
      toast.error("无法访问摄像头，请改用上传图片");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setShowCam(false);
  }

  function capture() {
    const v = videoRef.current;
    if (!v) return;
    // 拍照得到的 video 帧可能是高分辨率的，直接 toDataURL("image/png") 体积大，
    // 用统一的压缩工具输出 JPEG（长边 ≤1280，quality 0.85）。
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const dataUrl = imgElToCompressedDataUrl(c, 1280, 0.85);
    loadImageEl(dataUrl).then((img) => onCaptured(dataUrl, img));
    stopCamera();
  }

  if (selfieUrl) {
    return (
      <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-border/60 shadow-sm">
        <img src={selfieUrl} alt="自拍" className="aspect-[3/4] w-full object-cover" />
        <Button
          size="sm"
          variant="secondary"
          className="absolute right-2 top-2"
          onClick={onRemove}
        >
          <X className="mr-1 h-3.5 w-3.5" /> 移除
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div
        className={cn(
          "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
          drag ? "border-primary bg-primary/5" : "border-muted-foreground/30",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
      >
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Upload className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium">拖拽照片到此处，或</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="mr-1.5 h-4 w-4" />
          )}
          选择图片
        </Button>
          <Button variant="outline" size="sm" onClick={startCamera}>
            <Camera className="mr-1.5 h-4 w-4" /> 拍照
          </Button>
          <Button variant="ghost" size="sm" onClick={useSample}>
            <Sparkles className="mr-1.5 h-4 w-4" /> 用示例自拍
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          支持 JPG / PNG / HEIC（iPhone 实拍）等格式，建议使用正面、全身或上半身清晰照片
        </p>
      </div>

      {showCam && (
        <div className="mt-4 rounded-2xl border border-border/60 p-3">
          <video ref={videoRef} autoPlay playsInline className="w-full rounded-lg" />
          <div className="mt-3 flex justify-center gap-2">
            <Button size="sm" onClick={capture}>
              <Camera className="mr-1.5 h-4 w-4" /> 拍摄
            </Button>
            <Button size="sm" variant="ghost" onClick={stopCamera}>
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
