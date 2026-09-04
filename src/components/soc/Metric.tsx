import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Metric({
  label,
  value,
  unit,
  delta,
  tone = "default",
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  tone?: "default" | "good" | "warn" | "bad";
  hint?: ReactNode;
}) {
  return (
    <div className="panel p-4">
      <div className="label-mono">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-mono text-2xl font-semibold tabular-nums",
            tone === "good" && "text-success",
            tone === "warn" && "text-warning",
            tone === "bad" && "text-destructive"
          )}
        >
          {value}
        </span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      {delta && <div className="mt-1 text-xs text-muted-foreground">{delta}</div>}
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
