import { useMemo, useState } from "react";
import type { Design } from "@/lib/soc/model";
import type { Result } from "@/lib/soc/optimizer";

export type Layer = "temp" | "risk" | "coverage" | "process";

/** Two-stop thermal scale built from design tokens (cool cyan -> amber -> red). */
function heat(t: number) {
  const v = Math.max(0, Math.min(1, t));
  return v < 0.5
    ? `color-mix(in oklab, var(--primary) ${Math.round((1 - v * 2) * 100)}%, var(--accent))`
    : `color-mix(in oklab, var(--accent) ${Math.round((1 - (v - 0.5) * 2) * 100)}%, var(--destructive))`;
}

function coolScale(t: number) {
  const v = Math.max(0, Math.min(1, t));
  return `color-mix(in oklab, var(--muted) ${Math.round((1 - v) * 100)}%, var(--success))`;
}

type Props = {
  design: Design;
  result: Result;
  layer: Layer;
  showSensors: boolean;
  showPaths: boolean;
};

export function Floorplan({ design, result, layer, showSensors, showPaths }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const { field, risks, sensors } = result;

  const cells = useMemo(() => {
    const out: { x: number; y: number; w: number; h: number; v: number }[] = [];
    if (layer === "coverage") return out;
    for (let r = 0; r < field.rows; r++) {
      for (let c = 0; c < field.cols; c++) {
        const i = r * field.cols + c;
        let v = 0;
        if (layer === "temp") v = (field.temp[i]! - 40) / 60;
        else if (layer === "process") v = (field.proc[i]! + 1) / 2;
        else v = 0;
        out.push({ x: c * field.cellW, y: r * field.cellH, w: field.cellW + 0.6, h: field.cellH + 0.6, v });
      }
    }
    return out;
  }, [field, layer]);

  const riskCells = useMemo(() => {
    if (layer !== "risk" && layer !== "coverage") return [];
    const acc = new Map<number, { s: number; n: number }>();
    for (const p of risks) {
      const c = Math.min(field.cols - 1, Math.floor(p.x / field.cellW));
      const r = Math.min(field.rows - 1, Math.floor(p.y / field.cellH));
      const k = r * field.cols + c;
      const a = acc.get(k) ?? { s: 0, n: 0 };
      a.s += layer === "risk" ? p.risk : p.observability;
      a.n += 1;
      acc.set(k, a);
    }
    return [...acc.entries()].map(([k, a]) => ({
      x: (k % field.cols) * field.cellW,
      y: Math.floor(k / field.cols) * field.cellH,
      w: field.cellW + 0.6,
      h: field.cellH + 0.6,
      v: a.s / a.n,
    }));
  }, [risks, field, layer]);

  const hotPaths = useMemo(
    () => [...risks].sort((a, b) => b.risk - a.risk).slice(0, 240),
    [risks]
  );

  const hovered = sensors.find((s) => s.id === hover);

  return (
    <div className="relative">
      <svg
        viewBox={`-8 -8 ${design.width + 16} ${design.height + 16}`}
        className="w-full rounded-lg border border-border bg-background"
        role="img"
        aria-label="SoC floorplan with sensor placement heatmap"
      >
        <rect x={-8} y={-8} width={design.width + 16} height={design.height + 16} fill="var(--background)" />

        {(layer === "temp" || layer === "process") &&
          cells.map((c, i) => (
            <rect
              key={i}
              x={c.x}
              y={c.y}
              width={c.w}
              height={c.h}
              fill={layer === "process" ? coolScale(c.v) : heat(c.v)}
              opacity={0.85}
            />
          ))}

        {(layer === "risk" || layer === "coverage") &&
          riskCells.map((c, i) => (
            <rect
              key={i}
              x={c.x}
              y={c.y}
              width={c.w}
              height={c.h}
              fill={layer === "coverage" ? coolScale(c.v) : heat(c.v)}
              opacity={0.9}
            />
          ))}

        {design.blocks.map((b) => (
          <g key={b.id}>
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              fill="none"
              stroke="var(--foreground)"
              strokeOpacity={0.35}
              strokeWidth={1.5}
              rx={4}
            />
            <text
              x={b.x + 8}
              y={b.y + 18}
              fill="var(--foreground)"
              fillOpacity={0.75}
              fontSize={12}
              fontFamily="var(--font-mono)"
            >
              {b.name}
            </text>
          </g>
        ))}

        {showPaths &&
          hotPaths.map((p) => (
            <circle
              key={p.id}
              cx={p.x}
              cy={p.y}
              r={1.8 + p.risk * 3}
              fill="var(--foreground)"
              fillOpacity={0.15 + p.risk * 0.5}
            />
          ))}

        {showSensors &&
          sensors.map((s) => {
            const c = s.kind === "TDET" ? "var(--tdet)" : "var(--pdet)";
            return (
              <g
                key={s.id}
                onMouseEnter={() => setHover(s.id)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}
              >
                <circle cx={s.x} cy={s.y} r={22} fill={c} fillOpacity={0.1} />
                {s.kind === "TDET" ? (
                  <circle cx={s.x} cy={s.y} r={7} fill={c} stroke="var(--background)" strokeWidth={2} />
                ) : (
                  <rect
                    x={s.x - 6.5}
                    y={s.y - 6.5}
                    width={13}
                    height={13}
                    fill={c}
                    stroke="var(--background)"
                    strokeWidth={2}
                    transform={`rotate(45 ${s.x} ${s.y})`}
                  />
                )}
                <text
                  x={s.x + 11}
                  y={s.y - 8}
                  fontSize={11}
                  fontFamily="var(--font-mono)"
                  fill={c}
                >
                  {s.kind[0]}
                  {s.order}
                </text>
              </g>
            );
          })}
      </svg>

      {hovered && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-border bg-popover/95 px-3 py-2 font-mono text-xs text-popover-foreground shadow-lg">
          <div className="text-primary">
            {hovered.kind} #{hovered.order}
          </div>
          <div>site ({hovered.x.toFixed(0)}, {hovered.y.toFixed(0)}) µm</div>
          <div>local T {hovered.temp.toFixed(1)} °C · skew {hovered.proc.toFixed(2)}</div>
          <div>primary observer of {hovered.owned} paths</div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-full bg-tdet" /> TDET (thermal)
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block size-3 rotate-45 bg-pdet" /> PDET (process)
        </span>
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-24 rounded-sm"
            style={{
              backgroundImage:
                layer === "coverage" || layer === "process"
                  ? "linear-gradient(to right, var(--muted), var(--success))"
                  : "linear-gradient(to right, var(--primary), var(--accent), var(--destructive))",
            }}
          />
          {layer === "temp" && "40 → 100 °C"}
          {layer === "risk" && "low → high timing risk"}
          {layer === "coverage" && "unobserved → fully observed"}
          {layer === "process" && "slow → fast corner"}
        </span>
      </div>
    </div>
  );
}
