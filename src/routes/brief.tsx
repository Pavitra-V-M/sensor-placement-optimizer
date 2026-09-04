import { createFileRoute } from "@tanstack/react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/brief")({
  head: () => ({
    meta: [
      { title: "Hackathon Brief — TDET/PDET Power-Speed Optimisation" },
      {
        name: "description",
        content:
          "Problem statement, objectives, input artefacts, expected outcomes and evaluation weighting for the one-day university hackathon on SoC silicon telemetry.",
      },
      { property: "og:title", content: "Hackathon Brief — TDET/PDET Power-Speed Optimisation" },
      {
        property: "og:description",
        content:
          "Objectives, inputs, expected outcomes and the evaluation rubric for the distributed silicon telemetry challenge.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BriefPage,
});

const objectives = [
  "Identify high-value regions or paths for TDET/PDET coverage",
  "Maximise timing and process observability with a constrained sensor budget",
  "Translate the available observability into safe power-speed optimisation",
  "Quantify the benefit, risk and implementation overhead of the proposal",
];

const inputs = [
  "Synthesised netlist and design hierarchy",
  "Timing reports and design constraints",
  "Preliminary floorplan information",
  "A basic TDET/PDET cost and capability model",
  "Any additional artefacts and metrics the approach can justify",
];

const outcomes: [string, string][] = [
  ["Recommended TDET/PDET coverage or placement strategy", "Design-analysis and optimisation engine"],
  ["Coverage versus sensor-count trade-off", "Floorplan, path or coverage heatmaps"],
  ["Guard-band, voltage or frequency recommendations", "Power-speed trade-off dashboard"],
  ["Estimated power saving and/or speed improvement", "Graph, clustering, optimisation or ML approach"],
  ["Risk, reliability and overhead metrics", "Before/after comparison with quantified benefits"],
];

const rubric: [string, number][] = [
  ["Quality and justification of the TDET/PDET strategy", 25],
  ["Demonstrated power-speed benefit", 25],
  ["Coverage, observability and risk management", 15],
  ["Identification and effective use of relevant design artefacts", 15],
  ["Technical innovation and scalability", 10],
  ["Clarity of demonstration and presentation", 10],
];

function BriefPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <div className="label-mono">One-day university hackathon · problem statement 2</div>
      <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">
        Transform distributed silicon telemetry into intelligent power-performance optimisation
      </h1>

      <section className="panel mt-8 p-6">
        <h2 className="text-lg font-semibold">Problem statement</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Modern SoCs use Temperature Detection Elements (TDETs) and Process Detection Elements
          (PDETs) to monitor timing margins and process variation. The challenge is to develop an
          algorithm that uses available SoC implementation data to optimise how TDET/PDET
          information is deployed and utilised, improving the power-speed trade-off with minimal
          implementation overhead.
        </p>
      </section>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section className="panel p-6">
          <h2 className="text-lg font-semibold">Objective</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {objectives.map((o) => (
              <li key={o} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                {o}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel p-6">
          <h2 className="text-lg font-semibold">Inputs: available artefacts</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {inputs.map((o) => (
              <li key={o} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                {o}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel mt-6 p-6">
        <h2 className="text-lg font-semibold">Expected outcomes and showcase</h2>
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Expected outcome</TableHead>
              <TableHead>What can be showcased</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {outcomes.map(([a, b]) => (
              <TableRow key={a}>
                <TableCell className="text-sm">{a}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{b}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="panel mt-6 p-6">
        <h2 className="text-lg font-semibold">Evaluation focus</h2>
        <ul className="mt-4 space-y-3">
          {rubric.map(([c, w]) => (
            <li key={c}>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span>{c}</span>
                <span className="font-mono tabular-nums text-primary">{w}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(w / 25) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <blockquote className="panel mt-6 border-l-4 border-l-accent p-6">
        <div className="label-mono">The key judging question</div>
        <p className="mt-2 text-lg">
          “Can the proposed solution justify where sensors are placed and demonstrate measurable
          power-speed optimisation with minimal overhead?”
        </p>
      </blockquote>
    </div>
  );
}
