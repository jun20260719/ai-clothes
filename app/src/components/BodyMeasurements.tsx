import { Ruler, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BodyMeasurements } from "@/types";

type NumericKey = "height" | "weight" | "bust" | "waist" | "hips" | "shoulder";

const FIELDS: { key: NumericKey; label: string; unit: string; ph: string }[] = [
  { key: "height", label: "身高", unit: "cm", ph: "160" },
  { key: "weight", label: "体重", unit: "kg", ph: "50" },
  { key: "bust", label: "胸围", unit: "cm", ph: "84" },
  { key: "waist", label: "腰围", unit: "cm", ph: "68" },
  { key: "hips", label: "臀围", unit: "cm", ph: "90" },
  { key: "shoulder", label: "肩宽", unit: "cm", ph: "38" },
];

export function BodyMeasurements({
  value,
  onChange,
}: {
  value: BodyMeasurements;
  onChange: (v: BodyMeasurements) => void;
}) {
  function setNum(key: NumericKey, raw: string) {
    const v = raw === "" ? "" : Number(raw);
    onChange({ ...value, [key]: Number.isNaN(v as number) ? "" : v });
  }

  return (
    <div className="w-full">
      <div className="mb-4 flex items-start gap-2 rounded-lg bg-primary/5 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>
          这些数据仅用于本地估算服装版型与贴合度，<b className="text-foreground">不会上传</b>
          ，填得越全试衣越逼真。可随时跳过。
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label className="mb-1.5 block">性别</Label>
          <Select
            value={value.gender || undefined}
            onValueChange={(v) =>
              onChange({ ...value, gender: v as BodyMeasurements["gender"] })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="选择性别（可选）" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="female">女</SelectItem>
              <SelectItem value="male">男</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {FIELDS.map((f) => (
          <div key={f.key}>
            <Label className="mb-1.5 block">
              {f.label}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                （{f.unit}）
              </span>
            </Label>
            <div className="relative">
              <Input
                type="number"
                inputMode="decimal"
                placeholder={f.ph}
                value={value[f.key] as number | ""}
                onChange={(e) => setNum(f.key, e.target.value)}
                className="pr-10"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {f.unit}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Ruler className="h-3.5 w-3.5" />
        提示：若只想看大致效果，可直接跳过本步。
      </div>
    </div>
  );
}
