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
import { ANCHOR_MODES, type AnchorMode, type Sampling } from "@/lib/backtest/types";
import { getDataset, listSymbols } from "@/lib/data";
import type {
  AnalysisRequest,
  AnalysisResponse,
  AnchorPayload,
  SymbolMeta,
  WorstRow,
} from "@/lib/analysis";

export async function getSymbols() {
  return listSymbols();
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
