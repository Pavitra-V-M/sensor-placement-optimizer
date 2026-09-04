// Synthetic SoC design-artefact model + CSV ingestion.
// Represents the post-synthesis / early-floorplan artefacts described in the
// problem statement: netlist hierarchy, timing paths, floorplan, sensor cost model.

export type Block = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Relative switching activity 0..1 — drives the thermal profile. */
  activity: number;
  /** Process corner skew of this region (-1 slow .. +1 fast). */
  processSkew: number;
};

export type TimingPath = {
  id: string;
  block: string;
  /** Launch point (floorplan coords, µm-normalised units). */
  x: number;
  y: number;
  /** Capture point. */
  x2: number;
  y2: number;
  /** Setup slack in ns at the signoff corner. */
  slack: number;
  /** Logic depth — deeper paths degrade faster with temperature. */
  depth: number;
  /** Per-degree delay sensitivity (ns/°C). */
  tempSens: number;
  /** Delay sensitivity to process skew (ns per unit skew). */
  procSens: number;
  /** Toggle rate contribution to dynamic power. */
  activity: number;
};

export type SensorModel = {
  /** Area cost per sensor, µm². */
  tdetArea: number;
  pdetArea: number;
  /** Static power per sensor, µW. */
  tdetPower: number;
  pdetPower: number;
  /** Routing/ports overhead per sensor (arbitrary congestion units). */
  routingCost: number;
};

export type Design = {
  name: string;
  width: number;
  height: number;
  /** Nominal clock period, ns. */
  clockPeriod: number;
  /** Nominal supply, V. */
  vdd: number;
  /** Baseline signoff guard-band, ns (temperature + process margin). */
  baseGuardBand: number;
  /** Total dynamic power at nominal, mW. */
  basePower: number;
  blocks: Block[];
  paths: TimingPath[];
  sensors: SensorModel;
};

export const DEFAULT_SENSOR_MODEL: SensorModel = {
  tdetArea: 420,
  pdetArea: 610,
  tdetPower: 38,
  pdetPower: 55,
  routingCost: 1,
};

/* ------------------------------------------------------------------ */
/* Deterministic PRNG so results are reproducible per seed             */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BLOCK_LIBRARY = [
  { name: "CPU_CLUSTER", activity: 0.92, hot: true },
  { name: "NPU_ARRAY", activity: 0.86, hot: true },
  { name: "NAND_CTRL", activity: 0.61, hot: false },
  { name: "DDR_PHY", activity: 0.74, hot: true },
  { name: "PCIE_MAC", activity: 0.48, hot: false },
  { name: "SRAM_BANK", activity: 0.33, hot: false },
  { name: "ECC_ENGINE", activity: 0.57, hot: false },
  { name: "IO_RING", activity: 0.21, hot: false },
  { name: "SEC_ENCLAVE", activity: 0.4, hot: false },
];

export type GenOptions = {
  seed: number;
  pathCount: number;
  criticality: number; // 0..1 — how tight the design is
};

export function generateDesign(opts: GenOptions): Design {
  const rnd = mulberry32(opts.seed);
  const width = 1000;
  const height = 700;

  const cols = 3;
  const rows = 3;
  const blocks: Block[] = BLOCK_LIBRARY.map((bRaw, i) => {
    const b = bRaw!;
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    const cw = width / cols;
    const ch = height / rows;
    const pad = 18;
    return {
      id: `B${i}`,
      name: b.name,
      x: cx * cw + pad,
      y: cy * ch + pad,
      w: cw - pad * 2,
      h: ch - pad * 2,
      activity: Math.min(1, b.activity * (0.85 + rnd() * 0.3)),
      processSkew: (rnd() * 2 - 1) * 0.8,
    };
  });

  const paths: TimingPath[] = [];
  for (let i = 0; i < opts.pathCount; i++) {
    const b = blocks[Math.floor(rnd() * blocks.length)]!;
    const x = b.x + rnd() * b.w;
    const y = b.y + rnd() * b.h;
    // Most captures are local; some cross the die.
    const crossDie = rnd() < 0.15;
    const x2 = crossDie ? rnd() * width : Math.min(width, Math.max(0, x + (rnd() * 2 - 1) * 90));
    const y2 = crossDie ? rnd() * height : Math.min(height, Math.max(0, y + (rnd() * 2 - 1) * 90));
    const depth = 6 + Math.floor(rnd() * 34);
    // Slack distribution: skewed toward zero for high criticality designs.
    const u = rnd();
    const slack = Math.max(
      -0.05,
      (1 - opts.criticality) * 0.55 * Math.pow(u, 0.55) + 0.012 * u - 0.02
    );
    paths.push({
      id: `P${i.toString().padStart(4, "0")}`,
      block: b.name,
      x,
      y,
      x2,
      y2,
      slack: Number(slack.toFixed(4)),
      depth,
      tempSens: Number((0.0006 * depth * (0.7 + rnd() * 0.7)).toFixed(5)),
      procSens: Number((0.012 * depth * (0.6 + rnd() * 0.8)).toFixed(4)),
      activity: Number((b.activity * (0.5 + rnd() * 0.5)).toFixed(3)),
    });
  }

  return {
    name: `soc_top_seed${opts.seed}`,
    width,
    height,
    clockPeriod: 1.25,
    vdd: 0.75,
    baseGuardBand: 0.16,
    basePower: 2450,
    blocks,
    paths,
    sensors: DEFAULT_SENSOR_MODEL,
  };
}

/* ------------------------------------------------------------------ */
/* Thermal / process field derived from the floorplan                  */
/* ------------------------------------------------------------------ */

export type Field = {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  /** Temperature in °C per cell. */
  temp: number[];
  /** Process skew per cell (-1..1). */
  proc: number[];
};

export function computeField(design: Design, cols = 40, rows = 28): Field {
  const cellW = design.width / cols;
  const cellH = design.height / rows;
  const temp: number[] = new Array(cols * rows).fill(0);
  const proc: number[] = new Array(cols * rows).fill(0);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = (c + 0.5) * cellW;
      const py = (r + 0.5) * cellH;
      let t = 42; // ambient junction floor
      let p = 0;
      let pw = 0;
      for (const b of design.blocks) {
        const bx = b.x + b.w / 2;
        const by = b.y + b.h / 2;
        const d = Math.hypot(px - bx, py - by);
        const sigma = Math.max(b.w, b.h) * 0.85;
        const g = Math.exp(-(d * d) / (2 * sigma * sigma));
        t += 52 * b.activity * g;
        p += b.processSkew * g;
        pw += g;
      }
      // Global process gradient across the die (systematic within-die variation).
      const grad = (px / design.width - 0.5) * 0.6 + (py / design.height - 0.5) * 0.25;
      temp[r * cols + c] = t;
      proc[r * cols + c] = Math.max(-1, Math.min(1, (pw ? p / pw : 0) * 0.7 + grad));
    }
  }
  return { cols, rows, cellW, cellH, temp, proc };
}

export function sampleField(field: Field, arr: number[], x: number, y: number): number {
  const c = Math.max(0, Math.min(field.cols - 1, Math.floor(x / field.cellW)));
  const r = Math.max(0, Math.min(field.rows - 1, Math.floor(y / field.cellH)));
  return arr[r * field.cols + c]!;
}

/* ------------------------------------------------------------------ */
/* CSV ingestion of real timing reports                                */
/* ------------------------------------------------------------------ */

export type ParseResult = { design: Design | null; error?: string; rows: number };

/**
 * Accepts a timing-report CSV export. Recognised columns (case-insensitive):
 * path/id, block/instance, x, y, x2, y2, slack, depth/levels, temp_sens,
 * proc_sens, activity. Missing columns are derived with safe defaults.
 */
export function parseTimingCsv(text: string, name = "uploaded_design"): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { design: null, error: "CSV needs a header and at least one row.", rows: 0 };

  const first = lines[0]!;
  const delim = first.includes("\t") ? "\t" : first.split(";").length > first.split(",").length ? ";" : ",";
  const header = lines[0]!.split(delim).map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "_"));
  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const iSlack = idx("slack", "setup_slack", "worst_slack");
  if (iSlack < 0) return { design: null, error: "No 'slack' column found in the CSV.", rows: 0 };

  const iId = idx("path", "path_id", "id", "endpoint");
  const iBlock = idx("block", "instance", "module", "hier", "hierarchy");
  const iX = idx("x", "start_x", "launch_x");
  const iY = idx("y", "start_y", "launch_y");
  const iX2 = idx("x2", "end_x", "capture_x");
  const iY2 = idx("y2", "end_y", "capture_y");
  const iDepth = idx("depth", "levels", "logic_depth", "num_cells");
  const iTs = idx("temp_sens", "tempsens", "dt");
  const iPs = idx("proc_sens", "procsens", "dp");
  const iAct = idx("activity", "toggle", "toggle_rate");

  const rnd = mulberry32(7);
  const raw = lines.slice(1).map((l) => l.split(delim).map((v) => v.trim()));
  const num = (v: string | undefined, fb: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };

  const hasCoords = iX >= 0 && iY >= 0;
  const xs = hasCoords ? raw.map((r) => num(r[iX], 0)) : [];
  const ys = hasCoords ? raw.map((r) => num(r[iY], 0)) : [];
  const maxX = hasCoords ? Math.max(1, ...xs) : 1;
  const maxY = hasCoords ? Math.max(1, ...ys) : 1;
  const W = 1000;
  const H = 700;

  const blockNames = new Map<string, { sx: number; sy: number; n: number; act: number }>();
  const paths: TimingPath[] = [];

  raw.forEach((r, i) => {
    const blockName = (iBlock >= 0 && r[iBlock]) || "TOP";
    const x = hasCoords ? (num(r[iX], 0) / maxX) * W : rnd() * W;
    const y = hasCoords ? (num(r[iY], 0) / maxY) * H : rnd() * H;
    const x2 = iX2 >= 0 ? (num(r[iX2], 0) / maxX) * W : Math.min(W, x + (rnd() * 2 - 1) * 80);
    const y2 = iY2 >= 0 ? (num(r[iY2], 0) / maxY) * H : Math.min(H, y + (rnd() * 2 - 1) * 80);
    const depth = Math.max(1, num(r[iDepth], 8 + Math.floor(rnd() * 24)));
    const activity = Math.min(1, Math.max(0.05, num(r[iAct], 0.3 + rnd() * 0.5)));
    paths.push({
      id: (iId >= 0 && r[iId]) || `P${i}`,
      block: blockName,
      x,
      y,
      x2,
      y2,
      slack: num(r[iSlack], 0),
      depth,
      tempSens: num(r[iTs], 0.0006 * depth),
      procSens: num(r[iPs], 0.012 * depth),
      activity,
    });
    const agg = blockNames.get(blockName) ?? { sx: 0, sy: 0, n: 0, act: 0 };
    agg.sx += x;
    agg.sy += y;
    agg.n += 1;
    agg.act += activity;
    blockNames.set(blockName, agg);
  });

  if (!paths.length) return { design: null, error: "No data rows parsed.", rows: 0 };

  const blocks: Block[] = [...blockNames.entries()].slice(0, 24).map(([nm, a], i) => {
    const cx = a.sx / a.n;
    const cy = a.sy / a.n;
    const w = Math.min(260, Math.max(120, W / 4));
    const h = Math.min(200, Math.max(90, H / 4));
    return {
      id: `B${i}`,
      name: nm,
      x: Math.max(0, Math.min(W - w, cx - w / 2)),
      y: Math.max(0, Math.min(H - h, cy - h / 2)),
      w,
      h,
      activity: Math.min(1, a.act / a.n),
      processSkew: (mulberry32(i + 3)() * 2 - 1) * 0.8,
    };
  });

  const periodGuess = Math.max(0.4, Math.max(...paths.map((p) => p.slack)) * 1.6 + 0.4);

  return {
    rows: paths.length,
    design: {
      name,
      width: W,
      height: H,
      clockPeriod: Number(periodGuess.toFixed(3)),
      vdd: 0.75,
      baseGuardBand: 0.16,
      basePower: 2450,
      blocks,
      paths,
      sensors: DEFAULT_SENSOR_MODEL,
    },
  };
}

export const SAMPLE_CSV = `path_id,block,x,y,x2,y2,slack,depth,activity
P0001,CPU_CLUSTER,120,88,164,101,0.012,31,0.91
P0002,CPU_CLUSTER,142,110,151,140,0.031,26,0.88
P0003,NPU_ARRAY,470,120,505,150,0.008,34,0.85
P0004,DDR_PHY,820,140,842,131,0.045,18,0.72
P0005,SRAM_BANK,140,470,190,468,0.180,11,0.31
`;
