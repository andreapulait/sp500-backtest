import type { AnchorMode, WindowResult } from "./types";
import type { AnchorRun } from "./engine";

export type Distribution = {
  n: number;
  mean: number;
  median: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  stdDev: number;
};

/** Percentile con interpolazione lineare su array gia' ordinato crescente. */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function describe(values: number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance =
    n > 1 ? sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1) : 0;

  return {
    n,
    mean,
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    min: sorted[0],
    max: sorted[n - 1],
    stdDev: Math.sqrt(variance),
  };
}

export type AnchorStats = {
  anchor: AnchorMode;
  n: number;
  skipped: number;

  /** frequenze relative sulle finestre valutate */
  insideRate: number;
  breachUpRate: number;
  breachDownRate: number;

  /** mai violato un BEP nemmeno durante la vita */
  neverTouchedRate: number;
  /** ha violato un BEP a un certo punto, a prescindere dall'esito finale */
  touchedRate: number;
  /** ha violato durante la vita ma e' rientrato entro la scadenza */
  touchedButReturnedRate: number;

  /**
   * Ampiezza degli sfondamenti a scadenza, in % dello spot d'ingresso,
   * calcolata solo sulle finestre sfondate: e' la media condizionata,
   * cioe' "quando esce dai BEP, di quanto esce".
   */
  breachAll: Distribution | null;
  breachUp: Distribution | null;
  breachDown: Distribution | null;

  /** margine residuo dal BEP piu' vicino, sulle sole finestre chiuse dentro */
  margin: Distribution | null;

  /** escursioni massime durante la vita, su tutte le finestre */
  excursionUp: Distribution | null;
  excursionDown: Distribution | null;

  /** distribuzione dei rendimenti a scadenza */
  returns: Distribution | null;

  avgRangeWidthPct: number;
  /** finestre in cui il BEP inferiore risulta <= 0 e quindi non e' violabile */
  unreachableLowerCount: number;
};

const rate = (count: number, total: number) => (total > 0 ? count / total : 0);

export function summarize(run: AnchorRun): AnchorStats {
  const r = run.results;
  const n = r.length;

  const breachedUp = r.filter((w) => w.breachedUp);
  const breachedDown = r.filter((w) => w.breachedDown);
  const inside = r.filter((w) => w.insideAtExpiry);
  const touched = r.filter((w) => w.touchedUp || w.touchedDown);

  return {
    anchor: run.anchor,
    n,
    skipped: run.skipped,

    insideRate: rate(inside.length, n),
    breachUpRate: rate(breachedUp.length, n),
    breachDownRate: rate(breachedDown.length, n),

    neverTouchedRate: rate(n - touched.length, n),
    touchedRate: rate(touched.length, n),
    touchedButReturnedRate: rate(r.filter((w) => w.touchedButReturned).length, n),

    breachAll: describe([...breachedUp, ...breachedDown].map((w) => w.breachPct)),
    breachUp: describe(breachedUp.map((w) => w.breachPct)),
    breachDown: describe(breachedDown.map((w) => w.breachPct)),

    margin: describe(inside.map((w) => w.marginPct as number)),

    excursionUp: describe(r.map((w) => w.core.excursionUpPct)),
    excursionDown: describe(r.map((w) => w.core.excursionDownPct)),

    returns: describe(r.map((w) => w.core.retPct)),

    avgRangeWidthPct: n > 0 ? r.reduce((a, w) => a + w.rangeWidthPct, 0) / n : 0,
    unreachableLowerCount: r.filter((w) => w.lowerBepUnreachable).length,
  };
}

export type HistogramBin = {
  from: number;
  to: number;
  count: number;
  share: number;
};

/** Istogramma dei rendimenti a scadenza, con bin simmetrici attorno allo zero. */
export function histogram(values: number[], binCount = 41): HistogramBin[] {
  if (values.length === 0) return [];

  const maxAbs = Math.max(...values.map(Math.abs));
  if (maxAbs === 0) return [];

  // bin dispari centrati sullo zero, cosi' lo zero cade a meta' del bin centrale
  const bins = binCount % 2 === 0 ? binCount + 1 : binCount;
  const half = (bins - 1) / 2;
  const width = maxAbs / (half + 0.5);
  const start = -width * (half + 0.5);

  const counts = new Array<number>(bins).fill(0);
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - start) / width)));
    counts[idx]++;
  }

  return counts.map((count, i) => ({
    from: start + i * width,
    to: start + (i + 1) * width,
    count,
    share: count / values.length,
  }));
}

export type BreachCurvePoint = {
  /** distanza dallo spot d'ingresso, in % */
  distance: number;
  /** frequenza storica di chiusura oltre +distance */
  probUp: number;
  /** frequenza storica di chiusura oltre -distance */
  probDown: number;
  /** frequenza storica di uscita da una banda simmetrica di ampiezza +/- distance */
  probEither: number;
};

/**
 * Per ogni distanza, la frequenza storica con cui il sottostante ha chiuso oltre.
 * Serve a leggere direttamente dove piazzare i BEP per una data probabilita'.
 */
export function breachCurve(returns: number[], points = 80): BreachCurvePoint[] {
  if (returns.length === 0) return [];

  const sortedAbs = [...returns.map(Math.abs)].sort((a, b) => a - b);
  const maxDistance = quantile(sortedAbs, 0.995);
  if (!(maxDistance > 0)) return [];

  const up = returns.filter((v) => v > 0).sort((a, b) => a - b);
  const down = returns.filter((v) => v < 0).map(Math.abs).sort((a, b) => a - b);
  const n = returns.length;

  const countAbove = (sorted: number[], threshold: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= threshold) lo = mid + 1;
      else hi = mid;
    }
    return sorted.length - lo;
  };

  const out: BreachCurvePoint[] = [];
  for (let i = 0; i <= points; i++) {
    const distance = (maxDistance * i) / points;
    const probUp = countAbove(up, distance) / n;
    const probDown = countAbove(down, distance) / n;
    out.push({ distance, probUp, probDown, probEither: probUp + probDown });
  }
  return out;
}

export type GroupStats = {
  label: string;
  n: number;
  insideRate: number;
  breachUpRate: number;
  breachDownRate: number;
  /** ampiezza media degli sfondamenti nel gruppo, condizionata allo sfondamento */
  meanBreachPct: number | null;
  worstBreachPct: number;
};

function groupStats(label: string, results: WindowResult[]): GroupStats {
  const n = results.length;
  const breached = results.filter((w) => !w.insideAtExpiry);
  return {
    label,
    n,
    insideRate: rate(results.filter((w) => w.insideAtExpiry).length, n),
    breachUpRate: rate(results.filter((w) => w.breachedUp).length, n),
    breachDownRate: rate(results.filter((w) => w.breachedDown).length, n),
    meanBreachPct: breached.length
      ? breached.reduce((a, w) => a + w.breachPct, 0) / breached.length
      : null,
    worstBreachPct: breached.length ? Math.max(...breached.map((w) => w.breachPct)) : 0,
  };
}

export function byYear(results: WindowResult[]): GroupStats[] {
  const groups = new Map<number, WindowResult[]>();
  for (const w of results) {
    const list = groups.get(w.core.year);
    if (list) list.push(w);
    else groups.set(w.core.year, [w]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, list]) => groupStats(String(year), list));
}

/**
 * Suddivide per quintile di VIX al giorno d'ingresso. Le finestre senza VIX
 * (prima del 1990) vengono escluse anziche' finire in un quintile arbitrario.
 */
export function byVixQuintile(results: WindowResult[]): GroupStats[] {
  const withVix = results.filter((w) => w.core.vixAnnual != null);
  if (withVix.length < 5) return [];

  const sortedVix = withVix.map((w) => w.core.vixAnnual as number).sort((a, b) => a - b);
  const cuts = [0.2, 0.4, 0.6, 0.8].map((p) => quantile(sortedVix, p));

  const buckets: WindowResult[][] = [[], [], [], [], []];
  for (const w of withVix) {
    const v = w.core.vixAnnual as number;
    let idx = 0;
    while (idx < cuts.length && v > cuts[idx]) idx++;
    buckets[idx].push(w);
  }

  const bounds = [0, ...cuts, Infinity];
  const fmt = (v: number) => (v * 100).toFixed(1).replace(".", ",");
  return buckets.map((list, i) => {
    const label =
      bounds[i + 1] === Infinity
        ? `VIX > ${fmt(bounds[i])}`
        : `VIX ${fmt(bounds[i])}–${fmt(bounds[i + 1])}`;
    return groupStats(label, list);
  });
}

/** Le finestre con lo sfondamento maggiore, per ispezione puntuale. */
export function worstWindows(results: WindowResult[], k = 10): WindowResult[] {
  return results
    .filter((w) => !w.insideAtExpiry)
    .sort((a, b) => b.breachPct - a.breachPct)
    .slice(0, k);
}
