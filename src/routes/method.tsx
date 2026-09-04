import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/method")({
  head: () => ({
    meta: [
      { title: "Algorithm & Methodology — TDET/PDET Optimiser" },
      {
        name: "description",
        content:
          "How the engine scores timing risk, places sensors by greedy submodular max-coverage, and converts observability into guard-band, voltage and frequency recommendations.",
      },
      { property: "og:title", content: "Algorithm & Methodology — TDET/PDET Optimiser" },
      {
        property: "og:description",
        content:
          "Risk scoring, observability kernels, greedy max-coverage placement and the power-speed translation model.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MethodPage,
});

const stages = [
  {
    n: "01",
    title: "Artefact ingestion",
    body: "Synthesised netlist hierarchy, timing report slacks and logic depth, preliminary floorplan coordinates, and a TDET/PDET area/power/routing cost model. Uploaded CSV timing reports are normalised into the same schema; missing sensitivity columns are derived from logic depth.",
    formula: "delay_sens ≈ 0.6 ps/°C per level · depth",
  },
  {
    n: "02",
    title: "Thermal & process field reconstruction",
    body: "Per-block switching activity is diffused across the die with a Gaussian kernel to build a junction-temperature map, and a systematic within-die gradient is superposed on per-block corner skew to build the process map.",
    formula: "T(x) = 42 + Σ_b 52·act_b·exp(−d²/2σ_b²)",
  },
  {
    n: "03",
    title: "Timing-risk scoring",
    body: "Every path gets a risk weight combining slack tightness, corner degradation from its local temperature and process skew, and switching activity. This is the objective mass the sensor set must observe.",
    formula: "risk = tightness(slack) · (0.35 + 6·degradation) · (0.6 + 0.6·activity)",
  },
  {
    n: "04",
    title: "Observability kernels",
    body: "A sensor at site s observes path p with a correlation kernel over the shorter of the launch/capture distances. Thermal correlation length is shorter than process correlation length, so TDETs and PDETs get separate candidate solutions.",
    formula: "obs(s,p) = exp(−d(s,p)² / 2r²),  r_T = 210 µm, r_P = 260 µm",
  },
  {
    n: "05",
    title: "Greedy submodular max-coverage",
    body: "Coverage is a monotone submodular set function under noisy-OR composition, so the greedy schedule is within (1 − 1/e) of optimal. Sensors are emitted in gain order, which means truncating the schedule at any budget stays near-optimal — that is the trade-off curve.",
    formula: "argmax_s Σ_p risk_p · [1 − (1 − obs_p)(1 − obs(s,p))] − obs_p",
  },
  {
    n: "06",
    title: "Guard-band → power-speed translation",
    body: "A path is de-margined only when both its temperature and its process corner are observable, so combined coverage blends the geometric and max composition. Recovered margin is derated by the risk policy, then split 75/25 into voltage reduction and frequency uplift.",
    formula: "ΔGB = GB₀ · 0.72 · coverage · (1 − derate);  P ∝ 0.78·V²f + 0.22·V^3.1",
  },
  {
    n: "07",
    title: "Overhead & risk accounting",
    body: "Sensor area, static power and scan/routing ports are subtracted from the benefit to give a net saving. Residual risk is the unobserved risk mass — the probability that a hot, slow, critical path escapes adaptive control.",
    formula: "net = (P₀ − P₁ − P_sensors)/P₀;  residual = Σ risk_p(1 − obs_p) / Σ risk_p",
  },
];

function MethodPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <div className="label-mono">Methodology</div>
      <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">
        From design artefacts to a justified sensor plan
      </h1>
      <p className="mt-3 text-muted-foreground">
        Every recommendation in the dashboard is traceable back through these seven stages. Nothing
        is a lookup table — the placement is recomputed from the loaded artefacts on every change.
      </p>

      <ol className="mt-10 space-y-4">
        {stages.map((s) => (
          <li key={s.n} className="panel p-5">
            <div className="flex items-start gap-4">
              <span className="font-mono text-2xl text-primary/60">{s.n}</span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{s.title}</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.body}</p>
                <code className="mt-3 block overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
                  {s.formula}
                </code>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <section className="panel mt-10 p-6">
        <h2 className="text-lg font-semibold">Scalability</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Candidate-to-path visibility is precomputed once per sensor type, so the greedy loop is
          O(|C|·|P|) per pick with no re-evaluation of the kernel. On a real design the path set is
          pruned to the critical and near-critical population first, and candidate sites are
          restricted to legal placement regions from the floorplan — both reduce the constant
          factor without changing the algorithm.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {["Submodular optimisation", "Spatial clustering", "Graph observability", "Corner modelling"].map(
            (t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            )
          )}
        </div>
      </section>
    </div>
  );
}
