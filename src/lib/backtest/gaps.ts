import type { Series } from "./types";
import { indexAtOrAfter, indexAtOrBefore } from "./series";
import { quantile } from "./stats";

/**
 * Gap di apertura di una singola seduta: dal close della seduta precedente
 * all'open di quella corrente.
 *
 * Attenzione a cosa misura lo strumento scelto. L'open di un indice come SPX
 * non e' un prezzo scambiato: viene calcolato dai primi scambi dei componenti,
 * e quelli non ancora aperti contribuiscono col loro close precedente. L'open
 * dell'indice e' quindi una media fra prezzi nuovi e prezzi fermi, e comprime
 * il gap per costruzione. Uno strumento realmente scambiato (SPY) misura
 * l'intero riprezzamento notturno. Per questo `identicalShare` viene sempre
 * riportato: se e' alta, la serie non e' utilizzabile per questa analisi.
 */
export type GapObservation = {
  date: string;
  prevClose: number;
  open: number;
  gapPct: number;
  /** open identico al close precedente: sintomo di open non realmente rilevato */
  identical: boolean;
};

/** Estremi delle classi, in frazione di prezzo. L'ultima classe e' aperta verso l'alto. */
export const DEFAULT_GAP_EDGES = [0, 0.001, 0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03];

export type GapBucket = {
  from: number;
  /** null nell'ultima classe, aperta verso l'alto */
  to: number | null;
  up: number;
  down: number;
  total: number;
  share: number;
  /** quota di sedute con |gap| oltre l'estremo inferiore di questa classe */
  cumulativeShare: number;
};

export type GapPeriodStats = {
  label: string;
  from: string | null;
  to: string | null;
  n: number;
  buckets: GapBucket[];
  upCount: number;
  downCount: number;
  flatCount: number;
  meanAbs: number;
  medianAbs: number;
  p90Abs: number;
  p95Abs: number;
  p99Abs: number;
  maxUp: number;
  maxDown: number;
  meanSigned: number;
  /** quota di sedute con open identico al close precedente */
  identicalShare: number;
  /** le sedute con il gap piu' ampio, per ispezione */
  extremes: GapObservation[];
};

export function computeGaps(series: Series, from?: string, to?: string): GapObservation[] {
  const out: GapObservation[] = [];
  // il primo indice utile e' 1: serve il close della seduta precedente
  const start = Math.max(1, indexAtOrAfter(series.date, from));
  const end = indexAtOrBefore(series.date, to);

  for (let i = start; i <= end; i++) {
    const prevClose = series.c[i - 1];
    const open = series.o[i];
    if (!(prevClose > 0) || !(open > 0)) continue;

    out.push({
      date: series.date[i],
      prevClose,
      open,
      gapPct: open / prevClose - 1,
      identical: open === prevClose,
    });
  }

  return out;
}

function bucketize(gaps: GapObservation[], edges: number[]): GapBucket[] {
  const n = gaps.length;
  const sorted = [...edges].sort((a, b) => a - b);

  const buckets: GapBucket[] = sorted.map((from, i) => ({
    from,
    to: i === sorted.length - 1 ? null : sorted[i + 1],
    up: 0,
    down: 0,
    total: 0,
    share: 0,
    cumulativeShare: 0,
  }));

  for (const g of gaps) {
    const abs = Math.abs(g.gapPct);
    // ultima classe che contiene il valore: estremo inferiore incluso, superiore escluso
    let idx = 0;
    while (idx + 1 < buckets.length && abs >= (buckets[idx].to as number)) idx++;

    buckets[idx].total++;
    if (g.gapPct > 0) buckets[idx].up++;
    else if (g.gapPct < 0) buckets[idx].down++;
  }

  // la cumulata si costruisce dall'alto: quota di sedute oltre l'estremo inferiore
  let running = 0;
  for (let i = buckets.length - 1; i >= 0; i--) {
    running += buckets[i].total;
    buckets[i].share = n > 0 ? buckets[i].total / n : 0;
    buckets[i].cumulativeShare = n > 0 ? running / n : 0;
  }

  return buckets;
}

export function summarizeGaps(
  label: string,
  gaps: GapObservation[],
  edges: number[] = DEFAULT_GAP_EDGES,
  from?: string,
  to?: string
): GapPeriodStats {
  const n = gaps.length;
  const signed = gaps.map((g) => g.gapPct);
  const abs = signed.map(Math.abs).sort((a, b) => a - b);

  const extremes = [...gaps]
    .sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct))
    .slice(0, 10);

  return {
    label,
    from: from ?? (n > 0 ? gaps[0].date : null),
    to: to ?? (n > 0 ? gaps[n - 1].date : null),
    n,
    buckets: bucketize(gaps, edges),
    upCount: signed.filter((v) => v > 0).length,
    downCount: signed.filter((v) => v < 0).length,
    flatCount: signed.filter((v) => v === 0).length,
    meanAbs: n > 0 ? abs.reduce((a, b) => a + b, 0) / n : 0,
    medianAbs: quantile(abs, 0.5),
    p90Abs: quantile(abs, 0.9),
    p95Abs: quantile(abs, 0.95),
    p99Abs: quantile(abs, 0.99),
    maxUp: n > 0 ? Math.max(...signed) : 0,
    maxDown: n > 0 ? Math.min(...signed) : 0,
    meanSigned: n > 0 ? signed.reduce((a, b) => a + b, 0) / n : 0,
    identicalShare: n > 0 ? gaps.filter((g) => g.identical).length / n : 0,
    extremes,
  };
}
