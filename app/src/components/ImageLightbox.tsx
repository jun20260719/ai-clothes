import { useCallback, useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * 图片灯箱（点击放大 + 缩放/平移查看局部细节）。
 * - 暗色背景遮罩，点遮罩空白处（未缩放时）/ 右上角关闭 / 按 ESC 关闭
 * - 鼠标滚轮缩放（以光标为中心）；双指捏合缩放（以中点为中心）
 * - 放大后可拖拽平移查看局部；双击图片切换放大/复位
 * - 底部提供 放大 / 缩小 / 复位 按钮，移动端同样可用
 */
export function ImageLightbox({
  src,
  alt,
  open,
  onClose,
}: {
  src: string | null;
  alt?: string;
  open: boolean;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [panning, setPanning] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // 始终指向最新的缩放状态，避免外部监听（wheel）闭包过期
  const stateRef = useRef({ scale, tx, ty });
  stateRef.current = { scale, tx, ty };

  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDist = useRef<number | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);

  // 打开 / 切换图片时复位
  useEffect(() => {
    if (open) {
      setScale(1);
      setTx(0);
      setTy(0);
      setPanning(false);
      pointers.current.clear();
      pinchDist.current = null;
    }
  }, [open, src]);

  // ESC 关闭 + 锁定背景滚动
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // 把平移量限制在图片不出框（缩放后图片比视口大时才能移动）
  const applyClamp = useCallback((s: number, x: number, y: number) => {
    const img = imgRef.current;
    const cont = containerRef.current;
    if (!img || !cont) return { x, y };
    const baseW = img.offsetWidth;
    const baseH = img.offsetHeight;
    const sW = baseW * s;
    const sH = baseH * s;
    const W = cont.clientWidth;
    const H = cont.clientHeight;
    const maxX = Math.max(0, (sW - W) / 2);
    const maxY = Math.max(0, (sH - H) / 2);
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }, []);

  const applyTransform = useCallback((s: number, x: number, y: number) => {
    const c = applyClamp(s, x, y);
    setScale(s);
    setTx(c.x);
    setTy(c.y);
  }, [applyClamp]);

  // 以 (cx, cy) 屏幕坐标为中心缩放
  const zoomAt = useCallback(
    (targetScale: number, cx: number, cy: number) => {
      const img = imgRef.current;
      if (!img) return;
      const { scale: s0, tx: x0, ty: y0 } = stateRef.current;
      const rect = img.getBoundingClientRect();
      const originX = rect.left + rect.width / 2;
      const originY = rect.top + rect.height / 2;
      const s = clamp(targetScale, MIN_SCALE, MAX_SCALE);
      const ratio = s / s0;
      let nx = x0 - (cx - originX) * (ratio - 1);
      let ny = y0 - (cy - originY) * (ratio - 1);
      if (s === 1) {
        nx = 0;
        ny = 0;
      }
      applyTransform(s, nx, ny);
    },
    [applyTransform]
  );

  // 滚轮缩放（非被动监听，才能 preventDefault）
  useEffect(() => {
    const cont = containerRef.current;
    if (!cont || !open) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const { scale: s0 } = stateRef.current;
      zoomAt(s0 * factor, e.clientX, e.clientY);
    };
    cont.addEventListener("wheel", handler, { passive: false });
    return () => cont.removeEventListener("wheel", handler);
  }, [open, zoomAt]);

  const getTwo = () => Array.from(pointers.current.values()).slice(0, 2);
  const distOf = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  const midOf = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      dragging.current = true;
      setPanning(true);
      last.current = { x: e.clientX, y: e.clientY };
    } else if (pointers.current.size === 2) {
      dragging.current = false;
      setPanning(false);
      const [a, b] = getTwo();
      pinchDist.current = a && b ? distOf(a, b) : null;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 双指捏合缩放
    if (pointers.current.size === 2) {
      const [a, b] = getTwo();
      if (a && b) {
        const d = distOf(a, b);
        const m = midOf(a, b);
        if (pinchDist.current) {
          const { scale: s0 } = stateRef.current;
          zoomAt(s0 * (d / pinchDist.current), m.x, m.y);
        }
        pinchDist.current = d;
      }
      return;
    }

    // 单指 / 鼠标拖拽平移（仅在已放大时）
    if (dragging.current && last.current) {
      const { scale: s0, tx: x0, ty: y0 } = stateRef.current;
      if (s0 > 1) {
        const dx = e.clientX - last.current.x;
        const dy = e.clientY - last.current.y;
        last.current = { x: e.clientX, y: e.clientY };
        applyTransform(s0, x0 + dx, y0 + dy);
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = null;
    if (pointers.current.size === 1) {
      const [p] = Array.from(pointers.current.values());
      last.current = p ?? null;
      dragging.current = stateRef.current.scale > 1;
      setPanning(false);
    }
    if (pointers.current.size === 0) {
      dragging.current = false;
      last.current = null;
      setPanning(false);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { scale: s0 } = stateRef.current;
    if (s0 > 1) zoomAt(1, e.clientX, e.clientY);
    else zoomAt(2.5, e.clientX, e.clientY);
  };

  const reset = () => {
    setScale(1);
    setTx(0);
    setTy(0);
  };

  if (!open || !src) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex select-none items-center justify-center bg-black/85 p-4"
      onClick={() => {
        // 仅在未缩放时，点击空白遮罩关闭（缩放中避免误触关闭）
        if (stateRef.current.scale === 1) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        aria-label="关闭"
      >
        <X className="h-5 w-5" />
      </button>

      {/* 缩放控制条 */}
      <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/10 p-1 backdrop-blur">
        <button
          type="button"
          onClick={() => {
            const { scale: s0 } = stateRef.current;
            zoomAt(s0 / 1.4, window.innerWidth / 2, window.innerHeight / 2);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20"
          aria-label="缩小"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="min-w-[3.5rem] text-center text-xs font-medium text-white/90">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => {
            const { scale: s0 } = stateRef.current;
            zoomAt(s0 * 1.4, window.innerWidth / 2, window.innerHeight / 2);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20"
          aria-label="放大"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={reset}
          className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20"
          aria-label="复位"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      {/* 操作提示 */}
      <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-[11px] text-white/80">
        滚轮 / 双指缩放 · 拖拽平移看局部 · 双击切换
      </div>

      <img
        ref={imgRef}
        src={src}
        alt={alt || "放大查看"}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: "center center",
          touchAction: "none",
          cursor: scale > 1 ? (panning ? "grabbing" : "grab") : "zoom-in",
          maxHeight: "92vh",
          maxWidth: "92vw",
          willChange: "transform",
        }}
        className="rounded-lg object-contain shadow-2xl"
      />
    </div>
  );
}
