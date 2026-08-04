import type {
  AnchorMode,
  BacktestParams,
  Sampling,
  Series,
  WindowCore,
  WindowResult,
} from "./types";
import { ANCHOR_MODES } from "./types";
import {
  REALIZED_VOL_LOOKBACK,
  indexAtOrAfter,
  indexAtOrBefore,
  scaleSigma,
} from "./series";

/**
 * Le tre rappresentazioni equivalenti di un BEP, riferite a uno spot e a un sigma.
 *
 * `points` e `pct` sono offset con segno rispetto allo spot: un BEP inferiore
 * ha valori negativi. `sd` usa il rendimento logaritmico, perche' e' di
 * rendimenti logaritmici che sigma e' la deviazione standard; usare la
 * variazione aritmetica introdurrebbe un errore crescente con la distanza.
 */
export type BepSpec = {
  points: number;
  pct: number;
  sd: number;
};

/** Da punti alle altre due rappresentazioni. */
export function bepFromPoints(points: number, spot: number, sigmaN: number): BepSpec {
  const pct = points / spot;
  return { points, pct, sd: sigmaN > 0 ? Math.log(1 + pct) / sigmaN : NaN };
}

/** Da percentuale alle altre due. */
export function bepFromPct(pct: number, spot: number, sigmaN: number): BepSpec {
  return { points: pct * spot, pct, sd: sigmaN > 0 ? Math.log(1 + pct) / sigmaN : NaN };
}

/** Da deviazioni standard alle altre due. */
export function bepFromSd(sd: number, spot: number, sigmaN: number): BepSpec {
  const pct = Math.exp(sd * sigmaN) - 1;
  return { points: pct * spot, pct, sd };
}

/**
 * Proietta un BEP di riferimento sullo spot e sul sigma di una finestra storica.
 * Per costruzione i tre ancoraggi coincidono sulla finestra di riferimento e
 * divergono tanto piu' quanto spot e volatilita' si allontanano da quelli attuali.
 */
export function projectBep(
  spec: BepSpec,
  anchor: AnchorMode,
  spot: number,
  sigmaN: number | null
): number | null {
  switch (anchor) {
    case "pct":
      return spot * (1 + spec.pct);
    case "sigma":
      if (sigmaN == null || !Number.isFinite(spec.sd)) return null;
      return spot * Math.exp(spec.sd * sigmaN);
  }
}

function matchesSampling(sampling: Sampling, dateISO: string): boolean {
  if (sampling.kind !== "weekday") return true;
  return new Date(`${dateISO}T00:00:00Z`).getUTCDay() === sampling.weekday;
}

export type BuildWindowsInput = {
  series: Series;
  realizedVol: (number | null)[];
  vixAnnual: (number | null)[];
  days: number;
  from?: string;
  to?: string;
  sampling: Sampling;
};

/**
 * Costruisce le finestre rolling.
 *
 * Convenzione: si entra al close del giorno t e si scade al close del giorno
 * t+N. Il percorso considerato va da t+1 a t+N inclusi — l'escursione
 * intraday del giorno d'ingresso e' gia' avvenuta quando si apre la posizione,
 * quindi includerla sovrastimerebbe lo stress subito.
 */
export function buildWindows(input: BuildWindowsInput): WindowCore[] {
  const { series, realizedVol, vixAnnual, days, from, to, sampling } = input;
  const n = series.date.length;
  const windows: WindowCore[] = [];

  if (days < 1 || n === 0) return windows;

  // serve storia sufficiente per la volatilita' realizzata al giorno d'ingresso
  const firstEligible = Math.max(indexAtOrAfter(series.date, from), REALIZED_VOL_LOOKBACK);
  // l'ingresso deve cadere nel periodo scelto; la scadenza puo' anche cadere
  // subito dopo, purche' i dati esistano
  const lastEligible = Math.min(indexAtOrBefore(series.date, to), n - 1 - days);

  const step = sampling.kind === "disjoint" ? days : 1;

  for (let i = firstEligible; i <= lastEligible; i += step) {
    if (!matchesSampling(sampling, series.date[i])) continue;

    const j = i + days;
    const s0 = series.c[i];
    const sT = series.c[j];

    let pathHigh = -Infinity;
    let pathLow = Infinity;
    for (let k = i + 1; k <= j; k++) {
      if (series.h[k] > pathHigh) pathHigh = series.h[k];
      if (series.l[k] < pathLow) pathLow = series.l[k];
    }

    windows.push({
      entryIndex: i,
      exitIndex: j,
      entryDate: series.date[i],
      exitDate: series.date[j],
      s0,
      sT,
      pathHigh,
      pathLow,
      retPct: sT / s0 - 1,
      retLog: Math.log(sT / s0),
      excursionUpPct: pathHigh / s0 - 1,
      excursionDownPct: pathLow / s0 - 1,
      realizedVolAnnual: realizedVol[i],
      vixAnnual: vixAnnual[i],
      year: Number(series.date[i].slice(0, 4)),
    });
  }

  return windows;
}

/** Valuta una finestra rispetto a una coppia di BEP gia' proiettati. */
export function evaluateWindow(
  core: WindowCore,
  bepLow: number,
  bepHigh: number
): WindowResult {
  const { s0, sT, pathHigh, pathLow } = core;

  const breachedUp = sT > bepHigh;
  const breachedDown = sT < bepLow;
  const insideAtExpiry = !breachedUp && !breachedDown;

  const breachPoints = breachedUp ? sT - bepHigh : breachedDown ? bepLow - sT : 0;

  const touchedUp = pathHigh > bepHigh;
  const touchedDown = pathLow < bepLow;

  return {
    core,
    bepLow,
    bepHigh,
    rangeWidthPct: (bepHigh - bepLow) / s0,
    insideAtExpiry,
    breachedUp,
    breachedDown,
    breachPct: breachPoints / s0,
    breachPoints,
    touchedUp,
    touchedDown,
    touchedButReturned: (touchedUp || touchedDown) && insideAtExpiry,
    marginPct: insideAtExpiry ? Math.min(bepHigh - sT, sT - bepLow) / s0 : null,
    lowerBepUnreachable: bepLow <= 0,
  };
}

export type AnchorRun = {
  anchor: AnchorMode;
  results: WindowResult[];
  /** finestre scartate perche' il sigma della fonte scelta non era disponibile */
  skipped: number;
};

export type BacktestOutput = {
  params: BacktestParams;
  /** BEP di riferimento nelle tre rappresentazioni */
  refLow: BepSpec;
  refHigh: BepSpec;
  /** sigma della strategia sulla durata scelta, alla data di riferimento */
  refSigmaN: number;
  windows: WindowCore[];
  runs: Record<AnchorMode, AnchorRun>;
  diagnostics: {
    totalWindows: number;
    firstEntry: string | null;
    lastEntry: string | null;
    /** stima di osservazioni non sovrapposte, per pesare la significativita' */
    effectiveIndependentWindows: number;
    /** finestre la cui scadenza cade oltre la fine del periodo richiesto */
    exitsBeyondRange: number;
  };
};

export type RunBacktestInput = {
  series: Series;
  realizedVol: (number | null)[];
  vixAnnual: (number | null)[];
  params: BacktestParams;
};

export function runBacktest(input: RunBacktestInput): BacktestOutput {
  const { series, realizedVol, vixAnnual, params } = input;
  const { days, sigmaSource, referenceSpot, referenceSigmaAnnual } = params;

  const refSigmaN = scaleSigma(referenceSigmaAnnual, days);
  const refLow = bepFromPoints(params.bepLowPoints, referenceSpot, refSigmaN);
  const refHigh = bepFromPoints(params.bepHighPoints, referenceSpot, refSigmaN);

  const windows = buildWindows({
    series,
    realizedVol,
    vixAnnual,
    days,
    from: params.from,
    to: params.to,
    sampling: params.sampling,
  });

  const runs = {} as Record<AnchorMode, AnchorRun>;

  for (const anchor of ANCHOR_MODES) {
    const results: WindowResult[] = [];
    let skipped = 0;

    for (const core of windows) {
      let sigmaN: number | null = null;
      if (anchor === "sigma") {
        const annual = sigmaSource === "vix" ? core.vixAnnual : core.realizedVolAnnual;
        if (annual == null || !(annual > 0)) {
          skipped++;
          continue;
        }
        sigmaN = scaleSigma(annual, days);
      }

      const low = projectBep(refLow, anchor, core.s0, sigmaN);
      const high = projectBep(refHigh, anchor, core.s0, sigmaN);
      if (low == null || high == null) {
        skipped++;
        continue;
      }

      results.push(evaluateWindow(core, low, high));
    }

    runs[anchor] = { anchor, results, skipped };
  }

  const lastDate = series.date[series.date.length - 1];
  const rangeEnd = params.to ?? lastDate;
  const exitsBeyondRange = windows.filter((w) => w.exitDate > rangeEnd).length;

  return {
    params,
    refLow,
    refHigh,
    refSigmaN,
    windows,
    runs,
    diagnostics: {
      totalWindows: windows.length,
      firstEntry: windows.length ? windows[0].entryDate : null,
      lastEntry: windows.length ? windows[windows.length - 1].entryDate : null,
      effectiveIndependentWindows:
        params.sampling.kind === "overlapping"
          ? Math.floor(windows.length / days)
          : windows.length,
      exitsBeyondRange,
    },
  };
}
