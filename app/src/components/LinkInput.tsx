import { useState } from "react";
import { Link2, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseProduct } from "@/lib/parseLink";
import { SAMPLE_LINK } from "@/lib/sampleData";
import type { ParsedProduct } from "@/types";
import { toast } from "sonner";

export function LinkInput({
  onParsed,
  onStart,
}: {
  onParsed: (p: ParsedProduct) => void;
  onStart?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="w-full">
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
    </div>
  );
}
