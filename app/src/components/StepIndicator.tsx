import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = ["上传自拍", "身体数据", "粘贴链接", "生成试衣"];

export function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="flex w-full items-center justify-center gap-2 sm:gap-4">
      {STEPS.map((label, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;
        return (
          <li key={label} className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary text-primary ring-4 ring-primary/15",
                  !done && !active && "border-muted-foreground/30 text-muted-foreground",
                )}
              >
                {done ? <Check className="h-4 w-4" /> : idx}
              </span>
              <span
                className={cn(
                  "hidden text-sm font-medium sm:inline",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>
            {idx < STEPS.length && (
              <span
                className={cn(
                  "h-px w-6 sm:w-12",
                  idx < current ? "bg-primary" : "bg-muted-foreground/20",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
