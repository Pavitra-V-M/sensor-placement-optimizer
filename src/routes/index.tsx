import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState, useCallback } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  Upload,
  Cpu,
  Gauge,
  Zap,
  ShieldAlert,
  RefreshCw,
  Download,
  ChevronRight,
  Ruler,
  Scale,
  FileSpreadsheet,
} from "lucide-react";

import { Floorplan, type Layer } from "@/components/soc/Floorplan";
import { Metric } from "@/components/soc/Metric";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

import {
  computeField,
  DEFAULT_SENSOR_MODEL,
  generateDesign,
  parseTimingCsv,
  SAMPLE_CSV,
  type Design,
} from "@/lib/soc/model";
import {
  comparePlacements,
  DEFAULT_PARAMS,
  optimise,
  sweepBudget,
  type PlacedSensor,
} from "@/lib/soc/optimizer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TDET/PDET Sensor Optimiser — Power-Speed Engine for SoCs" },
      {
        name: "description",
        content:
          "Interactive engine that places temperature and process detectors on an SoC floorplan, then quantifies guard-band recovery, power saving and speed gain.",
      },
      { property: "og:title", content: "TDET/PDET Sensor Optimiser for Next-Gen SoCs" },
      {
        property: "og:description",
        content:
          "Coverage heatmaps, sensor-budget trade-off curves and a power-speed dashboard driven by a greedy observability-maximisation algorithm.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const [seed, setSeed] = useState(42);
  const [pathCount, setPathCount] = useState(1200);
  const [criticality, setCriticality] = useState(0.55);
  const [tdetBudget, setTdet] = useState(12);
  const [pdetBudget, setPdet] = useState(8);
  const [derate, setDerate] = useState(0.2);
  const [layer, setLayer] = useState<Layer>("temp");
  const [showSensors, setShowSensors] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [uploaded, setUploaded] = useState<Design | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // --- Sensor model (cost + coverage radius). Defaults preserve behaviour. ---
  const [tdetArea, setTdetArea] = useState(DEFAULT_SENSOR_MODEL.tdetArea);
  const [pdetArea, setPdetArea] = useState(DEFAULT_SENSOR_MODEL.pdetArea);
  const [tdetPower, setTdetPower] = useState(DEFAULT_SENSOR_MODEL.tdetPower);
  const [pdetPower, setPdetPower] = useState(DEFAULT_SENSOR_MODEL.pdetPower);
  const [tdetRadius, setTdetRadius] = useState(DEFAULT_PARAMS.thermalRadius);
  const [pdetRadius, setPdetRadius] = useState(DEFAULT_PARAMS.processRadius);
  const [costAware, setCostAware] = useState(false);
  const [tdetCost, setTdetCost] = useState(1);
  const [pdetCost, setPdetCost] = useState(1);
  const [spacingOn, setSpacingOn] = useState(false);
  const [spacing, setSpacing] = useState(120);

  // --- Baseline operating point (reference values only). ---
  const [clockOverride, setClockOverride] = useState<number | null>(null);
  const [vddOverride, setVddOverride] = useState<number | null>(null);

  const baseDesign = useMemo(
    () => uploaded ?? generateDesign({ seed, pathCount, criticality }),
    [uploaded, seed, pathCount, criticality]
  );

  const design = useMemo(
    () => ({
      ...baseDesign,
      clockPeriod: clockOverride ?? baseDesign.clockPeriod,
      vdd: vddOverride ?? baseDesign.vdd,
      sensors: { ...baseDesign.sensors, tdetArea, pdetArea, tdetPower, pdetPower },
    }),
    [baseDesign, clockOverride, vddOverride, tdetArea, pdetArea, tdetPower, pdetPower]
  );

  const field = useMemo(() => computeField(design), [design]);

  const params = useMemo(
    () => ({
      ...DEFAULT_PARAMS,
      tdetBudget,
      pdetBudget,
      safetyDerate: derate,
      thermalRadius: tdetRadius,
      processRadius: pdetRadius,
      costAware,
      tdetCost,
      pdetCost,
      minSpacing: spacingOn ? spacing : 0,
    }),
    [tdetBudget, pdetBudget, derate, tdetRadius, pdetRadius, costAware, tdetCost, pdetCost, spacingOn, spacing]
  );

  const result = useMemo(() => optimise(design, params, field), [design, params, field]);

  const comparison = useMemo(
    () => comparePlacements(design, params, field, result),
    [design, params, field, result]
  );

  const sweep = useMemo(() => sweepBudget(design, params, field, 40, 4), [design, params, field]);

  const baseline = useMemo(
    () => optimise(design, { ...params, tdetBudget: 0, pdetBudget: 0 }, field),
    [design, params, field]
  );

  const scatter = useMemo(
    () =>
      [...result.risks]
        .sort((a, b) => b.risk - a.risk)
        .slice(0, 400)
        .map((p) => ({
          slack: Number(p.slack.toFixed(3)),
          degradation: Number((p.degradation * 1000).toFixed(2)),
          obs: Number((p.observability * 100).toFixed(1)),
          risk: p.risk,
        })),
    [result]
  );

  const blockTable = useMemo(() => {
    const m = new Map<string, { n: number; risk: number; obs: number; temp: number }>();
    for (const p of result.risks) {
      const a = m.get(p.block) ?? { n: 0, risk: 0, obs: 0, temp: 0 };
      a.n++;
      a.risk += p.risk;
      a.obs += p.observability;
      a.temp += p.temp;
      m.set(p.block, a);
    }
    return [...m.entries()]
      .map(([name, a]) => ({
        name,
        paths: a.n,
        risk: a.risk / a.n,
        obs: a.obs / a.n,
        temp: a.temp / a.n,
      }))
      .sort((x, y) => y.risk - x.risk);
  }, [result]);

  const onUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = parseTimingCsv(String(reader.result ?? ""), file.name.replace(/\.[^.]+$/, ""));
      if (!res.design) {
        toast.error(res.error ?? "Could not parse the file");
        return;
      }
      setUploaded(res.design);
      toast.success(`Loaded ${res.rows} timing paths from ${file.name}`);
    };
    reader.readAsText(file);
  }, []);

  const exportJson = () => {
    const payload = {
      design: design.name,
      params,
      recommendation: result.sensors.map((s) => ({
        kind: s.kind,
        order: s.order,
        x: Math.round(s.x),
        y: Math.round(s.y),
        pathsOwned: s.owned,
      })),
      coverage: result.coverage,
      criticalCoverage: result.criticalCoverage,
      guardBand: { before: result.guardBandBefore, after: result.guardBandAfter },
      vdd: { before: result.vddBefore, after: result.vddAfter },
      fmaxMHz: { before: result.fmaxBefore, after: result.fmaxAfter },
      powerMw: { before: result.powerBefore, after: result.powerAfter },
      overhead: result.overhead,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${design.name}_tdet_pdet_plan.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Serialises the already-computed state — no recomputation happens here. */
  const exportCsvReport = () => {
    const esc = (v: unknown) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const rows: string[] = [];
    const push = (...cells: unknown[]) => rows.push(cells.map(esc).join(","));

    push("# TDET/PDET placement report");
    push("design", design.name);
    push("paths", design.paths.length);
    push("clock_period_ns", design.clockPeriod);
    push("vdd_v", design.vdd);
    push("tdet_count", tdetBudget);
    push("pdet_count", pdetBudget);
    push("cost_aware_ranking", costAware ? "on" : "off");
    push("min_spacing_um", spacingOn ? spacing : 0);
    push("");

    push("# Placement schedule");
    push("order", "type", "x_um", "y_um", "local_temp_c", "process_skew", "paths_owned",
      "marginal_gain", "gain_pct_of_risk_mass", "block", "near_critical_paths", "dominant_driver");
    for (const sn of result.sensors) {
      push(sn.order, sn.kind, sn.x.toFixed(1), sn.y.toFixed(1), sn.temp.toFixed(2),
        sn.proc.toFixed(3), sn.owned, sn.gain.toFixed(4), (sn.gainPct ?? 0).toFixed(3),
        sn.block ?? "", sn.nearCritical ?? 0, sn.driver ?? "");
    }
    push("");

    push("# Strategy comparison (identical sensor counts)");
    push("strategy", "risk_weighted_coverage_pct", "critical_coverage_pct",
      "guard_band_recovered_ns", "net_power_benefit_pct", "frequency_benefit_pct");
    for (const c of comparison) {
      push(c.strategy, (c.coverage * 100).toFixed(2), (c.criticalCoverage * 100).toFixed(2),
        c.guardBandRecovered.toFixed(4), c.netPowerSavingPct.toFixed(3), c.speedGainPct.toFixed(3));
    }
    push("");

    push("# Coverage vs sensor count");
    push("sensors", "coverage_pct", "critical_coverage_pct", "gross_power_saving_pct", "net_power_saving_pct");
    for (const d of sweep) push(d.sensors, d.coverage, d.critical, d.power, d.net);

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url2 = URL.createObjectURL(blob);
    const a2 = document.createElement("a");
    a2.href = url2;
    a2.download = `${design.name}_report.csv`;
    a2.click();
    URL.revokeObjectURL(url2);
  };

  const chartAxis = {
    stroke: "var(--muted-foreground)",
    fontSize: 11,
    tickLine: false,
  } as const;

  const tooltipStyle = {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--popover-foreground)",
    fontSize: 12,
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <div className="label-mono">Problem statement 2 · Sandisk university hackathon</div>
        <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">
          Distributed silicon telemetry → power-performance optimisation
        </h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          An observability-driven engine that decides <em>where</em> temperature (TDET) and process
          (PDET) detectors belong on the die, then converts the recovered timing margin into a safe
          voltage and frequency recommendation with quantified overhead.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {design.name}
          </Badge>
          <Badge variant="outline" className="font-mono">
            {design.paths.length.toLocaleString()} paths
          </Badge>
          <Badge variant="outline" className="font-mono">
            {design.blocks.length} blocks
          </Badge>
          {uploaded && (
            <Badge className="font-mono">uploaded artefacts</Badge>
          )}
        </div>
      </header>

      {/* Controls */}
      <section className="panel mb-6 p-5">
        <div className="grid gap-6 lg:grid-cols-4">
          <div className="space-y-4">
            <div className="label-mono flex items-center gap-2">
              <Cpu className="size-3.5" /> Design source
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setUploaded(null);
                  setSeed((s) => s + 1);
                }}
              >
                <RefreshCw className="size-4" /> New synthetic SoC
              </Button>
              <Button variant="outline" size="sm" asChild>
                <label className="cursor-pointer">
                  <Upload className="size-4" /> Upload timing CSV
                  <input
                    type="file"
                    accept=".csv,.txt,.tsv"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onUpload(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              CSV columns recognised: <span className="font-mono">slack</span> (required),{" "}
              <span className="font-mono">block, x, y, x2, y2, depth, activity, temp_sens, proc_sens</span>.
              Missing fields are derived.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "sample_timing_report.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="size-4" /> Sample CSV template
            </Button>
          </div>

          <div className="space-y-5">
            <div className="label-mono">Synthetic design knobs</div>
            <SliderRow
              label="Timing paths"
              value={pathCount}
              display={pathCount.toLocaleString()}
              min={200}
              max={4000}
              step={200}
              disabled={!!uploaded}
              onChange={setPathCount}
            />
            <SliderRow
              label="Design criticality"
              value={criticality}
              display={criticality.toFixed(2)}
              min={0.1}
              max={0.95}
              step={0.05}
              disabled={!!uploaded}
              onChange={setCriticality}
            />
          </div>

          <div className="space-y-5">
            <div className="label-mono">Sensor budget</div>
            <SliderRow
              label="TDET count"
              value={tdetBudget}
              display={String(tdetBudget)}
              min={0}
              max={32}
              step={1}
              onChange={setTdet}
            />
            <SliderRow
              label="PDET count"
              value={pdetBudget}
              display={String(pdetBudget)}
              min={0}
              max={32}
              step={1}
              onChange={setPdet}
            />
          </div>

          <div className="space-y-5">
            <div className="label-mono">Risk policy</div>
            <SliderRow
              label="Safety derate on recovered margin"
              value={derate}
              display={`${(derate * 100).toFixed(0)} %`}
              min={0}
              max={0.6}
              step={0.05}
              onChange={setDerate}
            />
            <div className="grid grid-cols-2 gap-3">
              <NumField
                label="Clock period"
                unit="ns"
                value={clockOverride ?? baseDesign.clockPeriod}
                min={0.2}
                max={20}
                step={0.01}
                title="Target clock period used as the reference for the frequency benefit."
                onChange={setClockOverride}
              />
              <NumField
                label="Current Vdd"
                unit="V"
                value={vddOverride ?? baseDesign.vdd}
                min={0.4}
                max={1.5}
                step={0.01}
                title="Signoff supply used as the reference for the recommended Vmin."
                onChange={setVddOverride}
              />
            </div>
            <Button className="w-full" onClick={exportJson}>
              <Download className="size-4" /> Export placement plan
            </Button>
            <Button variant="secondary" className="w-full" onClick={exportCsvReport}>
              <FileSpreadsheet className="size-4" /> Download report (CSV)
            </Button>
          </div>
        </div>
        {/* Sensor model */}
        <div className="mt-6 border-t pt-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="label-mono flex items-center gap-2">
              <Ruler className="size-3.5" /> Sensor model
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch id="cost-aware" checked={costAware} onCheckedChange={setCostAware} />
                <Label htmlFor="cost-aware" className="text-sm">
                  Cost-aware ranking
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="spacing" checked={spacingOn} onCheckedChange={setSpacingOn} />
                <Label htmlFor="spacing" className="text-sm">
                  Enforce min. spacing
                </Label>
              </div>
            </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-3">
              <div className="font-mono text-xs text-tdet">TDET</div>
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Area" unit="µm²" value={tdetArea} min={0} max={20000} step={100}
                  title="Silicon area of one temperature detector." onChange={setTdetArea} />
                <NumField label="Power" unit="µW" value={tdetPower} min={0} max={2000} step={10}
                  title="Static power of one temperature detector." onChange={setTdetPower} />
              </div>
              <NumField label="Coverage radius" unit="µm" value={tdetRadius} min={40} max={800} step={10}
                title="Thermal correlation length — how far a TDET reliably observes." onChange={setTdetRadius} />
              {costAware && (
                <NumField label="Cost weight" value={tdetCost} min={0.01} max={20} step={0.1}
                  title="Relative cost of a TDET; greedy ranks by gain / cost." onChange={setTdetCost} />
              )}
            </div>
            <div className="space-y-3">
              <div className="font-mono text-xs text-pdet">PDET</div>
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Area" unit="µm²" value={pdetArea} min={0} max={20000} step={100}
                  title="Silicon area of one process detector." onChange={setPdetArea} />
                <NumField label="Power" unit="µW" value={pdetPower} min={0} max={2000} step={10}
                  title="Static power of one process detector." onChange={setPdetPower} />
              </div>
              <NumField label="Coverage radius" unit="µm" value={pdetRadius} min={40} max={800} step={10}
                title="Process correlation length — how far a PDET reliably observes." onChange={setPdetRadius} />
              {costAware && (
                <NumField label="Cost weight" value={pdetCost} min={0.01} max={20} step={0.1}
                  title="Relative cost of a PDET; greedy ranks by gain / cost." onChange={setPdetCost} />
              )}
            </div>
            <div className="space-y-3 lg:col-span-2">
              <div className="font-mono text-xs text-muted-foreground">Placement constraints</div>
              <NumField label="Min. spacing" unit="µm" value={spacing} min={0} max={1200} step={20}
                disabled={!spacingOn}
                title="Minimum centre-to-centre distance between any two placed sensors."
                onChange={setSpacing} />
              <p className="text-xs text-muted-foreground">
                Cost-aware ranking trades marginal observability gain against each sensor type's cost
                weight; spacing rejects candidate sites too close to an already-placed sensor. Both
                leave the risk and physics math untouched.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Headline metrics */}
      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Metric
          label="Risk-weighted coverage"
          value={(result.coverage * 100).toFixed(1)}
          unit="%"
          tone={result.coverage > 0.7 ? "good" : result.coverage > 0.45 ? "warn" : "bad"}
          delta={`critical-path coverage ${(result.criticalCoverage * 100).toFixed(1)} %`}
        />
        <Metric
          label="Guard-band"
          value={result.guardBandAfter.toFixed(3)}
          unit="ns"
          delta={`from ${result.guardBandBefore.toFixed(3)} ns · −${(
            ((result.guardBandBefore - result.guardBandAfter) / result.guardBandBefore) *
            100
          ).toFixed(1)} %`}
          tone="good"
        />
        <Metric
          label="Power saving (net)"
          value={result.netPowerSavingPct.toFixed(2)}
          unit="%"
          tone="good"
          delta={`${result.powerBefore.toFixed(0)} → ${(result.powerAfter + result.overhead.power).toFixed(0)} mW`}
        />
        <Metric
          label="Speed gain"
          value={`+${result.speedGainPct.toFixed(2)}`}
          unit="%"
          tone="good"
          delta={`${result.fmaxBefore.toFixed(0)} → ${result.fmaxAfter.toFixed(0)} MHz`}
        />
        <Metric
          label="Residual risk"
          value={(result.residualRisk * 100).toFixed(1)}
          unit="%"
          tone={result.residualRisk < 0.2 ? "good" : result.residualRisk < 0.4 ? "warn" : "bad"}
          delta="unobserved risk mass (escape probability)"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        {/* Floorplan */}
        <section className="panel p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Floorplan & placement</h2>
              <p className="text-sm text-muted-foreground">
                Greedy submodular max-coverage over a 12×9 candidate site grid.
              </p>
            </div>
            <Tabs value={layer} onValueChange={(v) => setLayer(v as Layer)}>
              <TabsList>
                <TabsTrigger value="temp">Thermal</TabsTrigger>
                <TabsTrigger value="process">Process</TabsTrigger>
                <TabsTrigger value="risk">Risk</TabsTrigger>
                <TabsTrigger value="coverage">Coverage</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <Floorplan
            design={design}
            result={result}
            layer={layer}
            showSensors={showSensors}
            showPaths={showPaths}
          />

          <div className="mt-4 flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <Switch id="sensors" checked={showSensors} onCheckedChange={setShowSensors} />
              <Label htmlFor="sensors" className="text-sm">Sensors</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="paths" checked={showPaths} onCheckedChange={setShowPaths} />
              <Label htmlFor="paths" className="text-sm">Critical path endpoints</Label>
            </div>
          </div>
        </section>

        {/* Trade-off + power-speed */}
        <div className="space-y-6">
          <section className="panel p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Gauge className="size-4 text-primary" /> Coverage vs sensor count
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Diminishing returns identify the knee — the cheapest budget that still covers the
              critical decile.
            </p>
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={sweep} margin={{ left: -18, right: 8, top: 8 }}>
                <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" />
                <XAxis dataKey="sensors" {...chartAxis} />
                <YAxis {...chartAxis} unit="%" />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area
                  type="monotone"
                  dataKey="coverage"
                  name="Weighted coverage"
                  stroke="var(--chart-1)"
                  fill="var(--chart-1)"
                  fillOpacity={0.18}
                />
                <Area
                  type="monotone"
                  dataKey="critical"
                  name="Critical-decile coverage"
                  stroke="var(--chart-2)"
                  fill="var(--chart-2)"
                  fillOpacity={0.12}
                />
              </AreaChart>
            </ResponsiveContainer>
          </section>

          <section className="panel p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Zap className="size-4 text-accent" /> Power-speed trade-off
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Net saving subtracts the sensors' own static power from the recovered budget.
            </p>
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={sweep} margin={{ left: -18, right: 8, top: 8 }}>
                <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" />
                <XAxis dataKey="sensors" {...chartAxis} />
                <YAxis {...chartAxis} unit="%" />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="power"
                  name="Gross power saving"
                  stroke="var(--chart-2)"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="net"
                  name="Net of sensor overhead"
                  stroke="var(--chart-3)"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </section>
        </div>
      </div>

      {/* Before / after */}
      <section className="panel mt-6 p-5">
        <h2 className="text-lg font-semibold">Before / after, quantified</h2>
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={[
                {
                  k: "Guard-band (ps)",
                  before: baseline.guardBandBefore * 1000,
                  after: result.guardBandAfter * 1000,
                },
                { k: "Vmin (mV)", before: result.vddBefore * 1000, after: result.vddAfter * 1000 },
                { k: "Power (10 mW)", before: result.powerBefore / 10, after: (result.powerAfter + result.overhead.power) / 10 },
                { k: "Fmax (10 MHz)", before: result.fmaxBefore / 10, after: result.fmaxAfter / 10 },
              ]}
              margin={{ left: -12, right: 8, top: 8 }}
            >
              <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" />
              <XAxis dataKey="k" {...chartAxis} />
              <YAxis {...chartAxis} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="before" name="Baseline (static margin)" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="after" name="Sensor-informed" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          <div className="grid gap-4 sm:grid-cols-2">
            <Metric
              label="Sensor area overhead"
              value={(result.overhead.area / 1000).toFixed(1)}
              unit="×10³ µm²"
              delta={`${result.overhead.areaPct.toFixed(3)} % of a 12 mm² die`}
            />
            <Metric
              label="Sensor power overhead"
              value={result.overhead.power.toFixed(2)}
              unit="mW"
              delta={`${result.overhead.powerPct.toFixed(3)} % of baseline power`}
            />
            <Metric
              label="Sensors instantiated"
              value={String(result.overhead.sensorCount)}
              delta={`${tdetBudget} TDET + ${pdetBudget} PDET · ${result.overhead.routing} extra scan ports`}
            />
            <Metric
              label="Vmin recommendation"
              value={(result.vddAfter * 1000).toFixed(0)}
              unit="mV"
              tone="good"
              delta={`−${((result.vddBefore - result.vddAfter) * 1000).toFixed(0)} mV vs signoff`}
            />
          </div>
        </div>
      </section>

      {/* Path scatter + block table */}
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="panel p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldAlert className="size-4 text-destructive" /> Path observability map
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            400 highest-risk paths: slack vs corner degradation, coloured by achieved observability.
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ left: -12, right: 8, top: 8 }}>
              <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" />
              <XAxis dataKey="slack" name="slack" unit=" ns" {...chartAxis} />
              <YAxis dataKey="degradation" name="degradation" unit=" ps" {...chartAxis} />
              <ZAxis dataKey="obs" range={[20, 120]} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--border)" }} />
              <Scatter data={scatter} name="paths">
                {scatter.map((d, i) => (
                  <Cell
                    key={i}
                    fill={
                      d.obs > 66
                        ? "var(--success)"
                        : d.obs > 33
                          ? "var(--warning)"
                          : "var(--destructive)"
                    }
                    fillOpacity={0.7}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </section>

        <section className="panel p-5">
          <h2 className="text-lg font-semibold">Block-level report</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Where the risk lives and how well the recommended sensor set observes it.
          </p>
          <div className="max-h-[280px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Block</TableHead>
                  <TableHead className="text-right">Paths</TableHead>
                  <TableHead className="text-right">Avg T</TableHead>
                  <TableHead className="text-right">Risk</TableHead>
                  <TableHead className="text-right">Observed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blockTable.map((b) => (
                  <TableRow key={b.name}>
                    <TableCell className="font-mono text-xs">{b.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.paths}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.temp.toFixed(0)} °C</TableCell>
                    <TableCell className="text-right tabular-nums">{b.risk.toFixed(2)}</TableCell>
                    <TableCell
                      className={
                        b.obs > 0.66
                          ? "text-right tabular-nums text-success"
                          : b.obs > 0.33
                            ? "text-right tabular-nums text-warning"
                            : "text-right tabular-nums text-destructive"
                      }
                    >
                      {(b.obs * 100).toFixed(0)} %
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>

      {/* Placement list */}
      <section className="panel mt-6 p-5">
        <h2 className="text-lg font-semibold">Recommended placement schedule</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Ordered by marginal observability gain — truncate the list at any budget and it stays optimal-greedy.
        </p>
        <div className="max-h-[320px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Site (µm)</TableHead>
                <TableHead className="text-right">Local T</TableHead>
                <TableHead className="text-right">Skew</TableHead>
                <TableHead className="text-right">Paths owned</TableHead>
                <TableHead className="text-right">Marginal gain</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.sensors.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="tabular-nums">{s.order}</TableCell>
                  <TableCell>
                    <span
                      className={
                        s.kind === "TDET"
                          ? "font-mono text-xs text-tdet"
                          : "font-mono text-xs text-pdet"
                      }
                    >
                      {s.kind}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    ({s.x.toFixed(0)}, {s.y.toFixed(0)})
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.temp.toFixed(1)} °C</TableCell>
                  <TableCell className="text-right tabular-nums">{s.proc.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.owned}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.gain.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function NumField({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
  title,
  disabled,
}: {
  label: string;
  unit?: string | undefined;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  title?: string | undefined;
  disabled?: boolean | undefined;
}) {
  return (
    <div title={title} className={disabled ? "opacity-40" : undefined}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        {unit && <span className="font-mono text-muted-foreground">{unit}</span>}
      </div>
      <Input
        type="number"
        className="h-8 font-mono text-xs tabular-nums"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={!!disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
    </div>
  );
}

function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <div className={disabled ? "opacity-40" : undefined}>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={!!disabled}
        onValueChange={(v) => onChange(v[0] ?? min)}
      />
    </div>
  );
}
