import { describe, expect, it } from "vitest";

import {
  bepFromPct,
  bepFromPoints,
  bepFromSd,
  buildWindows,
  evaluateWindow,
  projectBep,
  runBacktest,
} from "./engine";
import { computeRealizedVol, alignVix, deriveXsp, scaleSigma } from "./series";
import type { Series } from "./types";

/** Serie sintetica: prezzi arbitrari con OHLC coerente e date consecutive fittizie. */
function makeSeries(closes: number[], spread = 0): Series {
  const date = closes.map((_, i) => {
    const d = new Date(Date.UTC(2000, 0, 3) + i * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
  return {
    symbol: "TEST",
    label: "Serie di test",
    date,
    o: closes.slice(),
    h: closes.map((c) => c + spread),
    l: closes.map((c) => c - spread),
    c: closes.slice(),
  };
}

/** Prezzi che realizzano esattamente i rendimenti logaritmici richiesti. */
function seriesFromLogReturns(start: number, logReturns: number[]): Series {
  const closes = [start];
  for (const r of logReturns) closes.push(closes[closes.length - 1] * Math.exp(r));
  return makeSeries(closes);
}

describe("conversione dei BEP", () => {
  const spot = 6842;
  const sigmaN = scaleSigma(0.15, 5);

  it("le tre rappresentazioni sono reciprocamente invertibili", () => {
    const fromPoints = bepFromPoints(-82, spot, sigmaN);

    expect(bepFromPct(fromPoints.pct, spot, sigmaN).points).toBeCloseTo(-82, 9);
    expect(bepFromSd(fromPoints.sd, spot, sigmaN).points).toBeCloseTo(-82, 9);
    expect(bepFromSd(fromPoints.sd, spot, sigmaN).pct).toBeCloseTo(fromPoints.pct, 12);
  });

  it("usa il rendimento logaritmico per il conteggio in sigma", () => {
    // un BEP a +1 sigma deve stare a spot * exp(sigmaN), non a spot * (1 + sigmaN)
    const oneSigma = bepFromSd(1, spot, sigmaN);
    expect(spot + oneSigma.points).toBeCloseTo(spot * Math.exp(sigmaN), 9);
    expect(spot + oneSigma.points).not.toBeCloseTo(spot * (1 + sigmaN), 2);
  });

  it("i due ancoraggi coincidono sulla finestra di riferimento", () => {
    const spec = bepFromPoints(-82, spot, sigmaN);
    for (const anchor of ["pct", "sigma"] as const) {
      expect(projectBep(spec, anchor, spot, sigmaN)).toBeCloseTo(spot - 82, 6);
    }
  });

  it("divergono su spot e volatilita' diversi", () => {
    const spec = bepFromPoints(-82, spot, sigmaN);
    const oldSpot = 1000;
    const oldSigmaN = scaleSigma(0.3, 5); // volatilita' doppia

    const byPct = projectBep(spec, "pct", oldSpot, oldSigmaN)!;
    const bySigma = projectBep(spec, "sigma", oldSpot, oldSigmaN)!;

    // l'ancoraggio percentuale riscala con lo spot e ignora la volatilita'
    expect(byPct).toBeCloseTo(1000 * (1 - 82 / 6842), 6);
    // a volatilita' doppia l'ancoraggio a sigma allarga il BEP rispetto al percentuale
    expect(bySigma).toBeLessThan(byPct);
  });

  it("l'ancoraggio a sigma non e' calcolabile senza sigma", () => {
    const spec = bepFromPoints(-82, spot, sigmaN);
    expect(projectBep(spec, "sigma", 1000, null)).toBeNull();
    expect(projectBep(spec, "pct", 1000, null)).toBeCloseTo(1000 * (1 - 82 / 6842), 6);
  });
});

describe("volatilita' realizzata", () => {
  it("riproduce la deviazione standard campionaria annualizzata calcolata a mano", () => {
    const returns = [0.01, -0.01, 0.02, -0.02];
    const series = seriesFromLogReturns(100, returns);
    const vol = computeRealizedVol(series, 4);

    // media 0, varianza campionaria = (1e-4 + 1e-4 + 4e-4 + 4e-4) / 3
    const expected = Math.sqrt(0.001 / 3) * Math.sqrt(252);
    expect(vol[4]).toBeCloseTo(expected, 12);
    expect(expected).toBeCloseTo(0.2898, 4);
  });

  it("lascia null le barre senza storia sufficiente", () => {
    const series = seriesFromLogReturns(100, [0.01, -0.01, 0.02, -0.02]);
    const vol = computeRealizedVol(series, 4);
    expect(vol.slice(0, 4).every((v) => v === null)).toBe(true);
  });

  it("una serie a rendimento costante ha volatilita' nulla", () => {
    const series = seriesFromLogReturns(100, [0.01, 0.01, 0.01, 0.01]);
    expect(computeRealizedVol(series, 4)[4]).toBeCloseTo(0, 12);
  });
});

describe("costruzione delle finestre", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const series = makeSeries(closes, 2);
  const realized = new Array(60).fill(0.2);
  const vix = new Array(60).fill(0.18);

  it("entra al close di t e scade al close di t+N", () => {
    const w = buildWindows({
      series,
      realizedVol: realized,
      vixAnnual: vix,
      days: 5,
      sampling: { kind: "overlapping" },
    });
    expect(w[0].entryIndex).toBe(30); // warmup della volatilita' realizzata
    expect(w[0].exitIndex).toBe(35);
    expect(w[0].s0).toBe(closes[30]);
    expect(w[0].sT).toBe(closes[35]);
  });

  it("esclude dal percorso l'escursione del giorno d'ingresso", () => {
    const w = buildWindows({
      series,
      realizedVol: realized,
      vixAnnual: vix,
      days: 5,
      sampling: { kind: "overlapping" },
    })[0];
    // i massimi/minimi vanno da t+1 a t+5: high = close[35]+2, low = close[31]-2
    expect(w.pathHigh).toBe(closes[35] + 2);
    expect(w.pathLow).toBe(closes[31] - 2);
    expect(w.pathLow).toBeGreaterThan(closes[30] - 2); // il low di t non entra
  });

  it("non genera finestre che sforano i dati disponibili", () => {
    const w = buildWindows({
      series,
      realizedVol: realized,
      vixAnnual: vix,
      days: 5,
      sampling: { kind: "overlapping" },
    });
    expect(w[w.length - 1].exitIndex).toBe(59);
  });

  it("il campionamento disgiunto avanza di N giorni", () => {
    const w = buildWindows({
      series,
      realizedVol: realized,
      vixAnnual: vix,
      days: 5,
      sampling: { kind: "disjoint" },
    });
    expect(w[1].entryIndex - w[0].entryIndex).toBe(5);
    expect(w[0].exitIndex).toBe(w[1].entryIndex);
  });

  it("il campionamento per giorno della settimana filtra correttamente", () => {
    const w = buildWindows({
      series,
      realizedVol: realized,
      vixAnnual: vix,
      days: 5,
      sampling: { kind: "weekday", weekday: 1 },
    });
    expect(w.length).toBeGreaterThan(0);
    for (const win of w) {
      expect(new Date(`${win.entryDate}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });

  it("rispetta gli estremi del periodo richiesto", () => {
    const from = series.date[40];
    const to = series.date[45];
    const w = buildWindows({
      series,
      realizedVol: realized,
      vixAnnual: vix,
      days: 5,
      from,
      to,
      sampling: { kind: "overlapping" },
    });
    expect(w[0].entryDate).toBe(from);
    expect(w[w.length - 1].entryDate).toBe(to);
  });
});

describe("valutazione di una finestra", () => {
  const base = {
    entryIndex: 0,
    exitIndex: 5,
    entryDate: "2020-01-02",
    exitDate: "2020-01-09",
    s0: 1000,
    retPct: 0,
    retLog: 0,
    realizedVolAnnual: 0.2,
    vixAnnual: 0.18,
    year: 2020,
  };

  it("riconosce la chiusura dentro i BEP e misura il margine", () => {
    const core = { ...base, sT: 1005, pathHigh: 1008, pathLow: 995, excursionUpPct: 0.008, excursionDownPct: -0.005 };
    const r = evaluateWindow(core, 990, 1010);

    expect(r.insideAtExpiry).toBe(true);
    expect(r.breachPct).toBe(0);
    // il BEP piu' vicino e' quello superiore: 1010 - 1005 = 5 punti su 1000
    expect(r.marginPct).toBeCloseTo(0.005, 12);
    expect(r.rangeWidthPct).toBeCloseTo(0.02, 12);
  });

  it("misura lo sfondamento verso l'alto", () => {
    const core = { ...base, sT: 1025, pathHigh: 1030, pathLow: 999, excursionUpPct: 0.03, excursionDownPct: -0.001 };
    const r = evaluateWindow(core, 990, 1010);

    expect(r.breachedUp).toBe(true);
    expect(r.breachedDown).toBe(false);
    expect(r.breachPoints).toBeCloseTo(15, 12);
    expect(r.breachPct).toBeCloseTo(0.015, 12);
    expect(r.marginPct).toBeNull();
  });

  it("misura lo sfondamento verso il basso", () => {
    const core = { ...base, sT: 980, pathHigh: 1002, pathLow: 975, excursionUpPct: 0.002, excursionDownPct: -0.025 };
    const r = evaluateWindow(core, 990, 1010);

    expect(r.breachedDown).toBe(true);
    expect(r.breachPoints).toBeCloseTo(10, 12);
    expect(r.breachPct).toBeCloseTo(0.01, 12);
  });

  it("distingue il tocco rientrato dallo sfondamento a scadenza", () => {
    const core = { ...base, sT: 1000, pathHigh: 1020, pathLow: 985, excursionUpPct: 0.02, excursionDownPct: -0.015 };
    const r = evaluateWindow(core, 990, 1010);

    expect(r.touchedUp).toBe(true);
    expect(r.touchedDown).toBe(true);
    expect(r.insideAtExpiry).toBe(true);
    expect(r.touchedButReturned).toBe(true);
    expect(r.breachPct).toBe(0);
  });

  it("segnala un BEP inferiore non raggiungibile", () => {
    const core = { ...base, sT: 1000, pathHigh: 1002, pathLow: 998, excursionUpPct: 0.002, excursionDownPct: -0.002 };
    const r = evaluateWindow(core, -50, 1010);

    expect(r.lowerBepUnreachable).toBe(true);
    expect(r.breachedDown).toBe(false);
  });

  it("il tocco esatto del BEP non conta come violazione", () => {
    const core = { ...base, sT: 1010, pathHigh: 1010, pathLow: 990, excursionUpPct: 0.01, excursionDownPct: -0.01 };
    const r = evaluateWindow(core, 990, 1010);

    expect(r.breachedUp).toBe(false);
    expect(r.touchedUp).toBe(false);
    expect(r.insideAtExpiry).toBe(true);
    expect(r.marginPct).toBeCloseTo(0, 12);
  });
});

describe("serie derivate e allineamento", () => {
  it("XSP e' un decimo di SPX su ogni campo", () => {
    const spx = makeSeries([6842, 6900], 10);
    const xsp = deriveXsp(spx);
    expect(xsp.c).toEqual([684.2, 690]);
    expect(xsp.h).toEqual([685.2, 691]);
    expect(xsp.date).toEqual(spx.date);
  });

  it("il VIX non viene riportato in avanti sulle date mancanti", () => {
    const series = makeSeries([100, 101, 102]);
    const vix = {
      ...makeSeries([0.2, 0.25]),
      date: [series.date[0], series.date[2]],
      c: [20, 25],
    } as Series;

    const aligned = alignVix(series, vix);
    expect(aligned).toEqual([20, null, 25]);
  });
});

describe("backtest completo", () => {
  const closes = Array.from({ length: 200 }, (_, i) => 1000 * Math.exp(0.0005 * i));
  const series = makeSeries(closes, 1);
  const realizedVol = computeRealizedVol(series);
  const vixAnnual = new Array(200).fill(0.18);

  const params = {
    symbol: "TEST",
    days: 5,
    bepLowPoints: -20,
    bepHighPoints: 20,
    referenceSpot: closes[closes.length - 1],
    referenceSigmaAnnual: 0.15,
    sigmaSource: "realized" as const,
    sampling: { kind: "overlapping" as const },
  };

  it("produce i due ancoraggi sullo stesso insieme di finestre", () => {
    const out = runBacktest({ series, realizedVol, vixAnnual, params });
    expect(out.runs.pct.results.length).toBe(out.windows.length);
    expect(out.runs.sigma.results.length + out.runs.sigma.skipped).toBe(out.windows.length);
  });

  it("scarta le finestre senza sigma solo per l'ancoraggio a sigma", () => {
    const noVix = new Array(200).fill(null);
    const out = runBacktest({
      series,
      realizedVol,
      vixAnnual: noVix,
      params: { ...params, sigmaSource: "vix" },
    });

    expect(out.runs.sigma.results.length).toBe(0);
    expect(out.runs.sigma.skipped).toBe(out.windows.length);
    expect(out.runs.pct.results.length).toBe(out.windows.length);
  });

  it("stima le finestre indipendenti dividendo per la durata", () => {
    const out = runBacktest({ series, realizedVol, vixAnnual, params });
    expect(out.diagnostics.effectiveIndependentWindows).toBe(
      Math.floor(out.windows.length / 5)
    );
    expect(out.diagnostics.effectiveIndependentWindows).toBeLessThan(out.windows.length);
  });

  it("su una serie a crescita costante e BEP stretti sfonda sempre verso l'alto", () => {
    // +0.0005 al giorno per 5 giorni = +0.25%, cioe' oltre 20 punti su ~1000
    const out = runBacktest({
      series,
      realizedVol,
      vixAnnual,
      params: { ...params, bepLowPoints: -1, bepHighPoints: 1 },
    });
    const r = out.runs.pct.results;
    expect(r.every((w) => w.breachedUp)).toBe(true);
    expect(r.every((w) => w.touchedDown === false)).toBe(true);
  });
});
