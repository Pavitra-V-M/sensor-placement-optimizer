// TDET/PDET placement + power-speed optimisation engine.
//
// 1. Score every path for timing risk (slack tightness x thermal/process sensitivity x activity).
// 2. Build candidate sensor sites on a floorplan grid.
// 3. Greedy submodular maximisation of weighted observability under a sensor budget.
// 4. Translate achieved observability into guard-band reduction -> Vmin/Fmax recommendation.

import { computeField, sampleField, type Design, type Field, type TimingPath } from "./model";

export type Candidate = { id: string; x: number; y: number; kind: "TDET" | "PDET" };

export type PlacedSensor = Candidate & {
  order: number;
  /** Marginal weighted observability gained when this sensor was chosen. */
  gain: number;
  /** Number of risk-weighted paths this sensor is the primary observer for. */
  owned: number;
  temp: number;
  proc: number;
  /** Additive explanation metadata (never affects the algorithm). */
  block?: string | undefined;
  nearCritical?: number | undefined;
  driver?: "thermal" | "process" | "slack" | "activity" | undefined;
  gainPct?: number | undefined;
  cost?: number | undefined;
};

export type PathRisk = TimingPath & {
  /** Delay degradation at the hot/slow corner, ns. */
  degradation: number;
  /** 0..1 risk weight. */
  risk: number;
  temp: number;
  procSkew: number;
  /** 0..1 achieved observability after placement. */
  observability: number;
};


export type OptimizerParams = {
  tdetBudget: number;
  pdetBudget: number;
  /** Thermal correlation length in floorplan units. */
  thermalRadius: number;
  /** Process correlation length. */
  processRadius: number;
  /** Fraction of guard-band that is recoverable with perfect observability. */
  maxRecovery: number;
  /** Confidence/safety derate applied to any recovered margin (0..1). */
  safetyDerate: number;
  /** Rank greedy candidates by gain / normalized sensor cost. Off by default. */
  costAware?: boolean | undefined;
  /** Normalized (unitless) cost weights used only when costAware is on. */
  tdetCost?: number | undefined;
  pdetCost?: number | undefined;
  /** Minimum centre-to-centre spacing between placed sensors, µm. 0 = off. */
  minSpacing?: number | undefined;
};


export const DEFAULT_PARAMS: OptimizerParams = {
  tdetBudget: 12,
  pdetBudget: 8,
  thermalRadius: 210,
  processRadius: 260,
  maxRecovery: 0.72,
  safetyDerate: 0.2,
  costAware: false,
  tdetCost: 1,
  pdetCost: 1,
  minSpacing: 0,
};


export type Result = {
  field: Field;
  risks: PathRisk[];
  sensors: PlacedSensor[];
  /** Risk-weighted observability 0..1. */
  coverage: number;
  tempCoverage: number;
  procCoverage: number;
  /** Fraction of the top-decile critical paths that are observed. */
  criticalCoverage: number;
  guardBandBefore: number;
  guardBandAfter: number;
  vddBefore: number;
  vddAfter: number;
  fmaxBefore: number;
  fmaxAfter: number;
  powerBefore: number;
  powerAfter: number;
  powerSavingPct: number;
  speedGainPct: number;
  /** Residual escape probability: unobserved risk mass. */
  residualRisk: number;
  overhead: {
    area: number;
    areaPct: number;
    power: number;
    powerPct: number;
    routing: number;
    sensorCount: number;
  };
  netPowerSavingPct: number;
};

const DIE_AREA_UM2 = 12_000_000; // 12 mm² reference die for overhead %

/** Weighted risk of each path at the hot/slow corner. */
export function computeRisks(design: Design, field: Field): PathRisk[] {
  const worstSlack = Math.min(...design.paths.map((p) => p.slack));
  return design.paths.map((p) => {
    const temp = sampleField(field, field.temp, p.x, p.y);
    const procSkew = sampleField(field, field.proc, p.x, p.y);
    const dT = Math.max(0, temp - 42);
    const degradation = p.tempSens * dT + p.procSens * Math.max(0, -procSkew) * 0.05;
    const tightness = 1 / (1 + Math.max(0, p.slack - worstSlack) * 14);
    const risk = Math.min(1, tightness * (0.35 + degradation * 6) * (0.6 + p.activity * 0.6));
    return { ...p, temp, procSkew, degradation, risk, observability: 0 };
  });
}

function kernel(d: number, radius: number) {
  return Math.exp(-(d * d) / (2 * radius * radius));
}

function buildCandidates(design: Design, kind: "TDET" | "PDET", nx = 12, ny = 9): Candidate[] {
  const out: Candidate[] = [];
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      out.push({
        id: `${kind}-${c}-${r}`,
        x: ((c + 0.5) / nx) * design.width,
        y: ((r + 0.5) / ny) * design.height,
        kind,
      });
    }
  }
  return out;
}

export type GreedyOpts = {
  /** Normalized cost of this sensor type; used only when costAware is true. */
  cost?: number | undefined;
  costAware?: boolean | undefined;
  /** Minimum spacing in floorplan units (0 = disabled). */
  minSpacing?: number | undefined;
  /** Already-placed sensors that the spacing rule must respect. */
  others?: { x: number; y: number }[] | undefined;
};

/** Explanation metadata for a chosen site — derived, never algorithm-affecting. */
function explain(
  risks: PathRisk[],
  v: Float64Array,
  gain: number,
  riskMass: number
): Pick<PlacedSensor, "block" | "nearCritical" | "driver" | "gainPct"> {
  const blockCount = new Map<string, number>();
  let n = 0;
  let nearCritical = 0;
  let thermal = 0;
  let process = 0;
  let slack = 0;
  let activity = 0;
  for (let i = 0; i < risks.length; i++) {
    if (!(v[i]! > 0.5)) continue;
    const p = risks[i]!;
    n++;
    blockCount.set(p.block, (blockCount.get(p.block) ?? 0) + 1);
    if (p.risk >= 0.5) nearCritical++;
    thermal += Math.max(0, p.temp - 42) / 60;
    process += Math.max(0, -p.procSkew);
    slack += 1 / (1 + Math.max(0, p.slack) * 20);
    activity += p.activity;
  }
  let block = "—";
  let bestN = -1;
  for (const [name, c] of blockCount) if (c > bestN) ((bestN = c), (block = name));
  type Driver = Exclude<PlacedSensor["driver"], undefined>;
  const scores: [Driver, number][] = n
    ? [
        ["thermal", thermal / n],
        ["process", process / n],
        ["slack", slack / n],
        ["activity", activity / n],
      ]
    : [["thermal", 0]];
  scores.sort((a, b) => b[1] - a[1]);
  return {
    block,
    nearCritical,
    driver: scores[0]![0],
    gainPct: riskMass ? (gain / riskMass) * 100 : 0,
  };
}

/** Greedy max-coverage: pick the site with the largest marginal observability gain. */
function greedyPlace(
  candidates: Candidate[],
  risks: PathRisk[],
  radius: number,
  budget: number,
  obs: Float64Array,
  field: Field,
  opts: GreedyOpts = {}
): PlacedSensor[] {
  const placed: PlacedSensor[] = [];
  const n = risks.length;
  const cost = opts.costAware ? Math.max(0.01, opts.cost ?? 1) : 1;
  const minSpacing = Math.max(0, opts.minSpacing ?? 0);
  const taken: { x: number; y: number }[] = [...(opts.others ?? [])];
  const riskMass = risks.reduce((s, p) => s + p.risk, 0);
  // Pre-compute candidate -> path visibility once.
  const vis = candidates.map((cand) => {
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = risks[i]!;
      const d = Math.min(
        Math.hypot(p.x - cand.x, p.y - cand.y),
        Math.hypot(p.x2 - cand.x, p.y2 - cand.y)
      );
      v[i] = kernel(d, radius);
    }
    return v;
  });

  const used = new Set<number>();
  for (let k = 0; k < budget; k++) {
    let best = -1;
    let bestGain = 0;
    let bestScore = 0;
    for (let ci = 0; ci < candidates.length; ci++) {
      if (used.has(ci)) continue;
      const cand = candidates[ci]!;
      if (
        minSpacing > 0 &&
        taken.some((t) => Math.hypot(t.x - cand.x, t.y - cand.y) < minSpacing)
      )
        continue;
      const v = vis[ci]!;
      let gain = 0;
      for (let i = 0; i < n; i++) {
        const next = 1 - (1 - obs[i]!) * (1 - v[i]!);
        gain += (next - obs[i]!) * risks[i]!.risk;
      }
      const score = gain / cost;
      if (score > bestScore) {
        bestScore = score;
        bestGain = gain;
        best = ci;
      }
    }
    if (best < 0) break;
    used.add(best);
    const v = vis[best]!;
    let owned = 0;
    for (let i = 0; i < n; i++) {
      if (v[i]! > 0.5) owned++;
      obs[i] = 1 - (1 - obs[i]!) * (1 - v[i]!);
    }
    const c = candidates[best]!;
    taken.push({ x: c.x, y: c.y });
    placed.push({
      ...c,
      order: placed.length + 1,
      gain: bestGain,
      owned,
      temp: sampleField(field, field.temp, c.x, c.y),
      proc: sampleField(field, field.proc, c.x, c.y),
      cost: opts.costAware ? cost : undefined,
      ...explain(risks, v, bestGain, riskMass),
    });
  }
  return placed;
}


export function optimise(design: Design, params: OptimizerParams, fieldIn?: Field): Result {
  const field = fieldIn ?? computeField(design);
  const risks = computeRisks(design, field);
  const n = risks.length;

  const tObs = new Float64Array(n);
  const pObs = new Float64Array(n);
  const tdets = greedyPlace(
    buildCandidates(design, "TDET"),
    risks,
    params.thermalRadius,
    params.tdetBudget,
    tObs,
    field,
    {
      costAware: params.costAware,
      cost: params.tdetCost,
      minSpacing: params.minSpacing,
    }
  );
  const pdets = greedyPlace(
    buildCandidates(design, "PDET"),
    risks,
    params.processRadius,
    params.pdetBudget,
    pObs,
    field,
    {
      costAware: params.costAware,
      cost: params.pdetCost,
      minSpacing: params.minSpacing,
    }
  );

  let riskMass = 0;
  let covT = 0;
  let covP = 0;
  let covAll = 0;
  for (let i = 0; i < n; i++) {
    // A path is de-margined only when both its temperature and its process
    // corner are observable — hence the geometric blend.
    const combined = Math.sqrt(tObs[i]! * pObs[i]!) * 0.65 + Math.max(tObs[i]!, pObs[i]!) * 0.35;
    risks[i]!.observability = Math.min(1, combined);
    const w = risks[i]!.risk;
    riskMass += w;
    covT += tObs[i]! * w;
    covP += pObs[i]! * w;
    covAll += risks[i]!.observability * w;
  }
  const coverage = riskMass ? covAll / riskMass : 0;
  const tempCoverage = riskMass ? covT / riskMass : 0;
  const procCoverage = riskMass ? covP / riskMass : 0;

  const sortedByRisk = [...risks].sort((a, b) => b.risk - a.risk);
  const topN = Math.max(1, Math.round(n * 0.1));
  const criticalCoverage =
    sortedByRisk.slice(0, topN).reduce((s, p) => s + p.observability, 0) / topN;

  // Guard-band recovery
  const recovered = design.baseGuardBand * params.maxRecovery * coverage * (1 - params.safetyDerate);
  const guardBandAfter = Math.max(0.01, design.baseGuardBand - recovered);

  // Two ways to spend the recovered margin. We split it: most into voltage
  // (power) and the remainder into frequency (speed).
  const powerShare = 0.75;
  const dVdT = 0.9; // ns of path delay removed per volt (first-order)
  const dV = (recovered * powerShare) / dVdT;
  const vddAfter = Math.max(0.5, design.vdd - dV);
  const fmaxBefore = 1000 / design.clockPeriod; // MHz
  const periodAfter = design.clockPeriod - recovered * (1 - powerShare);
  const fmaxAfter = 1000 / Math.max(0.2, periodAfter);

  const powerBefore = design.basePower;
  // Dynamic power scales with V², leakage roughly exponentially — approximate blend.
  const vRatio = vddAfter / design.vdd;
  const dyn = 0.78 * powerBefore * vRatio * vRatio * (fmaxAfter / fmaxBefore);
  const leak = 0.22 * powerBefore * Math.pow(vRatio, 3.1);
  const powerAfter = dyn + leak;
  const powerSavingPct = ((powerBefore - powerAfter) / powerBefore) * 100;
  const speedGainPct = ((fmaxAfter - fmaxBefore) / fmaxBefore) * 100;

  const sensorCount = tdets.length + pdets.length;
  const area = tdets.length * design.sensors.tdetArea + pdets.length * design.sensors.pdetArea;
  const sensorPowerUw = tdets.length * design.sensors.tdetPower + pdets.length * design.sensors.pdetPower;
  const sensorPowerMw = sensorPowerUw / 1000;

  const residualRisk = riskMass
    ? risks.reduce((s, p) => s + p.risk * (1 - p.observability), 0) / riskMass
    : 0;

  const netPowerSavingPct = ((powerBefore - (powerAfter + sensorPowerMw)) / powerBefore) * 100;

  return {
    field,
    risks,
    sensors: [...tdets, ...pdets],
    coverage,
    tempCoverage,
    procCoverage,
    criticalCoverage,
    guardBandBefore: design.baseGuardBand,
    guardBandAfter,
    vddBefore: design.vdd,
    vddAfter,
    fmaxBefore,
    fmaxAfter,
    powerBefore,
    powerAfter,
    powerSavingPct,
    speedGainPct,
    residualRisk,
    overhead: {
      area,
      areaPct: (area / DIE_AREA_UM2) * 100,
      power: sensorPowerMw,
      powerPct: (sensorPowerMw / powerBefore) * 100,
      routing: sensorCount * design.sensors.routingCost,
      sensorCount,
    },
    netPowerSavingPct,
  };
}

/** Coverage / benefit as a function of total sensor budget — the trade-off curve. */
export function sweepBudget(
  design: Design,
  params: OptimizerParams,
  field: Field,
  maxTotal = 40,
  step = 2
): { sensors: number; coverage: number; critical: number; power: number; net: number }[] {
  const out: { sensors: number; coverage: number; critical: number; power: number; net: number }[] = [];
  for (let total = 0; total <= maxTotal; total += step) {
    const t = Math.round(total * 0.6);
    const p = total - t;
    const r = optimise(design, { ...params, tdetBudget: t, pdetBudget: p }, field);
    out.push({
      sensors: total,
      coverage: Number((r.coverage * 100).toFixed(2)),
      critical: Number((r.criticalCoverage * 100).toFixed(2)),
      power: Number(r.powerSavingPct.toFixed(2)),
      net: Number(r.netPowerSavingPct.toFixed(2)),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Baseline comparison: greedy vs random vs uniform (additive)          */
/* ------------------------------------------------------------------ */

export type PlacementSummary = {
  strategy: "Greedy" | "Random" | "Uniform";
  coverage: number;
  criticalCoverage: number;
  guardBandRecovered: number;
  powerSavingPct: number;
  netPowerSavingPct: number;
  speedGainPct: number;
};

function lcg(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Score an arbitrary sensor site list with exactly the same physics as optimise(). */
function evaluateSites(
  design: Design,
  params: OptimizerParams,
  risks: PathRisk[],
  tSites: { x: number; y: number }[],
  pSites: { x: number; y: number }[],
  strategy: PlacementSummary["strategy"]
): PlacementSummary {
  const n = risks.length;
  const tObs = new Float64Array(n);
  const pObs = new Float64Array(n);
  const apply = (sites: { x: number; y: number }[], radius: number, obs: Float64Array) => {
    for (const s of sites) {
      for (let i = 0; i < n; i++) {
        const p = risks[i]!;
        const d = Math.min(Math.hypot(p.x - s.x, p.y - s.y), Math.hypot(p.x2 - s.x, p.y2 - s.y));
        obs[i] = 1 - (1 - obs[i]!) * (1 - kernel(d, radius));
      }
    }
  };
  apply(tSites, params.thermalRadius, tObs);
  apply(pSites, params.processRadius, pObs);

  let riskMass = 0;
  let covAll = 0;
  const obsAll = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const combined = Math.sqrt(tObs[i]! * pObs[i]!) * 0.65 + Math.max(tObs[i]!, pObs[i]!) * 0.35;
    obsAll[i] = Math.min(1, combined);
    riskMass += risks[i]!.risk;
    covAll += obsAll[i]! * risks[i]!.risk;
  }
  const coverage = riskMass ? covAll / riskMass : 0;
  const order = risks.map((p, i) => i).sort((a, b) => risks[b]!.risk - risks[a]!.risk);
  const topN = Math.max(1, Math.round(n * 0.1));
  const criticalCoverage = n
    ? order.slice(0, topN).reduce((s, i) => s + obsAll[i]!, 0) / topN
    : 0;

  const recovered = design.baseGuardBand * params.maxRecovery * coverage * (1 - params.safetyDerate);
  const powerShare = 0.75;
  const dVdT = 0.9;
  const vddAfter = Math.max(0.5, design.vdd - (recovered * powerShare) / dVdT);
  const fmaxBefore = 1000 / design.clockPeriod;
  const fmaxAfter = 1000 / Math.max(0.2, design.clockPeriod - recovered * (1 - powerShare));
  const powerBefore = design.basePower;
  const vRatio = vddAfter / design.vdd;
  const powerAfter =
    0.78 * powerBefore * vRatio * vRatio * (fmaxAfter / fmaxBefore) +
    0.22 * powerBefore * Math.pow(vRatio, 3.1);
  const sensorPowerMw =
    (tSites.length * design.sensors.tdetPower + pSites.length * design.sensors.pdetPower) / 1000;

  return {
    strategy,
    coverage,
    criticalCoverage,
    guardBandRecovered: recovered,
    powerSavingPct: ((powerBefore - powerAfter) / powerBefore) * 100,
    netPowerSavingPct: ((powerBefore - (powerAfter + sensorPowerMw)) / powerBefore) * 100,
    speedGainPct: ((fmaxAfter - fmaxBefore) / fmaxBefore) * 100,
  };
}

function pick<T>(arr: T[], k: number, rnd: () => number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  while (out.length < k && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]!);
  return out;
}

function uniformPick<T>(arr: T[], k: number): T[] {
  if (k <= 0 || !arr.length) return [];
  const out: T[] = [];
  for (let i = 0; i < k; i++) out.push(arr[Math.min(arr.length - 1, Math.round((i + 0.5) * (arr.length / k)) - 1 + 0)]!);
  return out;
}

/** Greedy / random / uniform comparison at identical TDET & PDET counts. */
export function comparePlacements(
  design: Design,
  params: OptimizerParams,
  field: Field,
  greedy: Result
): PlacementSummary[] {
  const risks = greedy.risks;
  const tCand = buildCandidates(design, "TDET");
  const pCand = buildCandidates(design, "PDET");
  const nT = greedy.sensors.filter((s) => s.kind === "TDET").length;
  const nP = greedy.sensors.filter((s) => s.kind === "PDET").length;
  const rnd = lcg(1337 + nT * 31 + nP * 17 + design.paths.length);

  return [
    evaluateSites(
      design,
      params,
      risks,
      greedy.sensors.filter((s) => s.kind === "TDET"),
      greedy.sensors.filter((s) => s.kind === "PDET"),
      "Greedy"
    ),
    evaluateSites(design, params, risks, pick(tCand, nT, rnd), pick(pCand, nP, rnd), "Random"),
    evaluateSites(design, params, risks, uniformPick(tCand, nT), uniformPick(pCand, nP), "Uniform"),
  ];
}
