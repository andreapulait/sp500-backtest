"use server";

import { runBacktest } from "@/lib/backtest/engine";
import { scaleSigma } from "@/lib/backtest/series";
import {
  breachCurve,
  byVixQuintile,
  byYear,
  histogram,
  summarize,
  worstWindows,
} from "@/lib/backtest/stats";
import {
  DEFAULT_GAP_EDGES,
  computeGaps,
  summarizeGaps,
  type GapPeriodStats,
} from "@/lib/backtest/gaps";
import {
  buildResidualRows,
  type ResidualReference,
  type ResidualRow,
} from "@/lib/backtest/residuals";
import {
  buildLegs,
  extractSignals,
  summarizeDirection,
  type DirectionStats,
  type Leg,
} from "@/lib/backtest/swings";
import { ANCHOR_MODES, type AnchorMode, type Sampling } from "@/lib/backtest/types";
import { getDataset, listSymbols } from "@/lib/data";
import type {
  AnalysisRequest,
  AnalysisResponse,
  AnchorPayload,
  GapRequest,
  PeriodSpec,
  SwingRequest,
  SymbolMeta,
  WorstRow,
} from "@/lib/analysis";

export async function getSymbols() {
  return listSymbols();
}

export type SwingResponse = {
  symbol: string;
  label: string;
  dataFrom: string;
  dataTo: string;
  up: DirectionStats;
  down: DirectionStats;
  totalLegs: number;
  /** date dei segnali estratti secondo i criteri della richiesta */
  signals: string[];
  /** ultime fasi in ordine cronologico, per ispezione */
  recentLegs: Leg[];
};

/**
 * Segmenta la serie in fasi alternate di massimi e minimi crescenti/decrescenti
 * ed estrae le date in cui una fase raggiunge il conteggio richiesto.
 */
export async function runSwingAnalysis(req: SwingRequest): Promise<SwingResponse> {
  const { info, series } = await getDataset(req.symbol);

  const legs = buildLegs(series, { from: req.from, to: req.to, outside: req.outside });

  return {
    symbol: info.symbol,
    label: info.label,
    dataFrom: series.date[0],
    dataTo: series.date[series.date.length - 1],
    up: summarizeDirection(legs, "up"),
    down: summarizeDirection(legs, "down"),
    totalLegs: legs.length,
    signals: extractSignals(legs, {
      direction: req.signalDirection,
      atCount: Math.max(1, Math.round(req.atCount)),
      minPrevLegCount: Math.max(0, Math.round(req.minPrevLegCount)),
    }),
    // le fasi possono essere migliaia: ne inviamo solo la coda, con le date
    // degli estremi alleggerite per non gonfiare la risposta
    recentLegs: legs.slice(-40).map((l) => ({ ...l, extremeDates: [] })),
  };
}

export type ResidualRequest = {
  symbol: string;
  from?: string;
  to?: string;
  outside: "flip" | "keep";
  direction: "up" | "down";
  /** da quale prezzo della barra osservata si misura il residuo */
  reference: ResidualReference;
};

export type ResidualResponse = {
  symbol: string;
  direction: "up" | "down";
  reference: ResidualReference;
  rows: ResidualRow[];
};

/**
 * Quanto si muove ancora il prezzo dopo l'N-esimo estremo consecutivo, e in
 * quanto tempo. Calcolato separatamente dalla segmentazione per non gonfiare
 * la risposta principale: i livelli annidati portano anche le singole occorrenze.
 */
export async function runResidualAnalysis(req: ResidualRequest): Promise<ResidualResponse> {
  const { info, series } = await getDataset(req.symbol);
  const legs = buildLegs(series, { from: req.from, to: req.to, outside: req.outside });

  return {
    symbol: info.symbol,
    direction: req.direction,
    reference: req.reference,
    rows: buildResidualRows(series, legs, req.direction, req.reference),
  };
}

export type GapResponse = {
  symbol: string;
  label: string;
  dataFrom: string;
  dataTo: string;
  a: GapPeriodStats;
  b: GapPeriodStats;
};

/**
 * Confronta la distribuzione dei gap di apertura fra due archi temporali.
 *
 * Lo strumento conta: l'open di un indice non e' un prezzo scambiato e
 * comprime i gap. `identicalShare` in ogni periodo segnala quando la serie
 * non ha open realmente rilevati.
 */
export async function runGapAnalysis(req: GapRequest): Promise<GapResponse> {
  const { info, series } = await getDataset(req.symbol);
  const edges = req.edges?.length ? req.edges : DEFAULT_GAP_EDGES;

  const summarize = (p: PeriodSpec) =>
    summarizeGaps(p.label, computeGaps(series, p.from, p.to), edges, p.from, p.to);

  return {
    symbol: info.symbol,
    label: info.label,
    dataFrom: series.date[0],
    dataTo: series.date[series.date.length - 1],
    a: summarize(req.a),
    b: summarize(req.b),
  };
}

/** Riga compatta per il confronto affiancato di piu' strategie. */
export type ComparisonRow = {
  key: string;
  n: number;
  insideRate: number;
  breachUpRate: number;
  breachDownRate: number;
  neverTouchedRate: number;
  touchedButReturnedRate: number;
  meanBreachPct: number | null;
  p90BreachPct: number | null;
  worstBreachPct: number | null;
  medianMarginPct: number | null;
  firstEntry: string | null;
  lastEntry: string | null;
};

export async function runComparison(
  entries: { key: string; request: AnalysisRequest }[]
): Promise<ComparisonRow[]> {
  return Promise.all(
    entries.map(async ({ key, request }) => {
      const res = await runAnalysis(request);
      const a = res.anchors.pct;
      return {
        key,
        n: a.n,
        insideRate: a.insideRate,
        breachUpRate: a.breachUpRate,
        breachDownRate: a.breachDownRate,
        neverTouchedRate: a.neverTouchedRate,
        touchedButReturnedRate: a.touchedButReturnedRate,
        meanBreachPct: a.breachAll?.mean ?? null,
        p90BreachPct: a.breachAll?.p90 ?? null,
        worstBreachPct: a.breachAll?.max ?? null,
        medianMarginPct: a.margin?.median ?? null,
        firstEntry: res.diagnostics.firstEntry,
        lastEntry: res.diagnostics.lastEntry,
      };
    })
  );
}

export async function getSymbolMeta(symbol: string): Promise<SymbolMeta> {
  const { info, series, realizedVol, vixAnnual } = await getDataset(symbol);
  const last = series.c.length - 1;

  return {
    symbol: info.symbol,
    label: info.label,
    derived: Boolean(info.derived),
    bars: series.date.length,
    dataFrom: series.date[0],
    dataTo: series.date[last],
    spot: series.c[last],
    spotDate: series.date[last],
    realizedVolAnnual: realizedVol[last],
    vixAnnual: vixAnnual[last],
  };
}

function toSampling(req: AnalysisRequest): Sampling {
  switch (req.sampling) {
    case "disjoint":
      return { kind: "disjoint" };
    case "weekday":
      return { kind: "weekday", weekday: req.weekday };
    default:
      return { kind: "overlapping" };
  }
}

export async function runAnalysis(req: AnalysisRequest): Promise<AnalysisResponse> {
  const days = Math.max(1, Math.round(req.days));
  const dataset = await getDataset(req.symbol);
  const { series, realizedVol, vixAnnual } = dataset;

  const meta = await getSymbolMeta(req.symbol);

  // Il sigma di riferimento serve solo a tradurre i BEP in deviazioni standard
  // e ad ancorare la modalita' sigma. Se la fonte scelta non e' disponibile
  // (VIX su serie che partono prima del 1990) ricadiamo sulla volatilita'
  // realizzata, segnalandolo nella risposta.
  const preferred = req.sigmaSource === "vix" ? meta.vixAnnual : meta.realizedVolAnnual;
  const fallback = meta.realizedVolAnnual ?? meta.vixAnnual ?? 0.15;
  const sigmaAnnual = preferred ?? fallback;
  const sigmaSource = preferred != null ? req.sigmaSource : "realized";

  const bepLowPoints = req.bepLowPct * meta.spot;
  const bepHighPoints = req.bepHighPct * meta.spot;

  const out = runBacktest({
    series,
    realizedVol,
    vixAnnual,
    params: {
      symbol: req.symbol,
      days,
      bepLowPoints,
      bepHighPoints,
      referenceSpot: meta.spot,
      referenceSigmaAnnual: sigmaAnnual,
      sigmaSource,
      sampling: toSampling(req),
      from: req.from,
      to: req.to,
    },
  });

  const anchors = {} as Record<AnchorMode, AnchorPayload>;
  for (const anchor of ANCHOR_MODES) {
    const run = out.runs[anchor];
    const s = summarize(run);

    const worst: WorstRow[] = worstWindows(run.results, 10).map((w) => ({
      entryDate: w.core.entryDate,
      exitDate: w.core.exitDate,
      s0: w.core.s0,
      sT: w.core.sT,
      retPct: w.core.retPct,
      breachPct: w.breachPct,
      direction: w.breachedUp ? "up" : "down",
      vixAnnual: w.core.vixAnnual,
    }));

    anchors[anchor] = {
      anchor,
      n: s.n,
      skipped: s.skipped,
      insideRate: s.insideRate,
      breachUpRate: s.breachUpRate,
      breachDownRate: s.breachDownRate,
      neverTouchedRate: s.neverTouchedRate,
      touchedRate: s.touchedRate,
      touchedButReturnedRate: s.touchedButReturnedRate,
      breachAll: s.breachAll,
      breachUp: s.breachUp,
      breachDown: s.breachDown,
      margin: s.margin,
      excursionUp: s.excursionUp,
      excursionDown: s.excursionDown,
      avgRangeWidthPct: s.avgRangeWidthPct,
      unreachableLowerCount: s.unreachableLowerCount,
      byYear: byYear(run.results),
      byVix: byVixQuintile(run.results),
      worst,
    };
  }

  const returns = out.windows.map((w) => w.retPct);
  const refSigmaN = scaleSigma(sigmaAnnual, days);

  return {
    meta,
    reference: {
      lowPoints: bepLowPoints,
      highPoints: bepHighPoints,
      lowPct: req.bepLowPct,
      highPct: req.bepHighPct,
      lowSd: out.refLow.sd,
      highSd: out.refHigh.sd,
      sigmaN: refSigmaN,
      sigmaAnnual,
      sigmaSource,
    },
    diagnostics: out.diagnostics,
    anchors,
    histogram: histogram(returns, 61),
    returns: summarize(out.runs.pct).returns,
    curve: breachCurve(returns),
  };
}
