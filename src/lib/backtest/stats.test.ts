import { describe, expect, it } from "vitest";

import {
  breachCurve,
  byVixQuintile,
  byYear,
  describe as summarizeValues,
  histogram,
  quantile,
  summarize,
  worstWindows,
} from "./stats";
import type { AnchorRun } from "./engine";
import type { WindowCore, WindowResult } from "./types";

function core(overrides: Partial<WindowCore> = {}): WindowCore {
  return {
    entryIndex: 0,
    exitIndex: 5,
    entryDate: "2020-01-02",
    exitDate: "2020-01-09",
    s0: 1000,
    sT: 1000,
    pathHigh: 1000,
    pathLow: 1000,
    retPct: 0,
    retLog: 0,
    excursionUpPct: 0,
    excursionDownPct: 0,
    realizedVolAnnual: 0.2,
    vixAnnual: 0.18,
    year: 2020,
    ...overrides,
  };
}

function result(overrides: Partial<WindowResult> = {}): WindowResult {
  return {
    core: core(),
    bepLow: 990,
    bepHigh: 1010,
    rangeWidthPct: 0.02,
    insideAtExpiry: true,
    breachedUp: false,
    breachedDown: false,
    breachPct: 0,
    breachPoints: 0,
    touchedUp: false,
    touchedDown: false,
    touchedButReturned: false,
    marginPct: 0.005,
    lowerBepUnreachable: false,
    ...overrides,
  };
}

describe("percentili", () => {
  const sorted = [1, 2, 3, 4, 5];

  it("interpola linearmente tra i valori", () => {
    expect(quantile(sorted, 0)).toBe(1);
    expect(quantile(sorted, 0.5)).toBe(3);
    expect(quantile(sorted, 1)).toBe(5);
    expect(quantile(sorted, 0.25)).toBe(2);
    expect(quantile([1, 2], 0.5)).toBe(1.5);
  });

  it("gestisce array vuoti e singoletti", () => {
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
    expect(quantile([7], 0.9)).toBe(7);
  });
});

describe("statistiche descrittive", () => {
  it("riproduce media e deviazione standard campionaria calcolate a mano", () => {
    const d = summarizeValues([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(d.n).toBe(8);
    expect(d.mean).toBeCloseTo(5, 12);
    expect(d.median).toBeCloseTo(4.5, 12);
    // varianza campionaria = 32/7
    expect(d.stdDev).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(d.min).toBe(2);
    expect(d.max).toBe(9);
  });

  it("restituisce null su insieme vuoto invece di NaN", () => {
    expect(summarizeValues([])).toBeNull();
  });
});

describe("aggregazione per ancoraggio", () => {
  const run: AnchorRun = {
    anchor: "pct",
    skipped: 3,
    results: [
      result(),
      result({ marginPct: 0.001 }),
      // toccato ma rientrato
      result({ touchedUp: true, touchedButReturned: true, marginPct: 0.002 }),
      // sfondato sopra dell'1.5%
      result({
        insideAtExpiry: false,
        breachedUp: true,
        touchedUp: true,
        breachPct: 0.015,
        breachPoints: 15,
        marginPct: null,
      }),
      // sfondato sotto dell'1%
      result({
        insideAtExpiry: false,
        breachedDown: true,
        touchedDown: true,
        breachPct: 0.01,
        breachPoints: 10,
        marginPct: null,
      }),
    ],
  };

  const s = summarize(run);

  it("calcola le frequenze sulle sole finestre valutate", () => {
    expect(s.n).toBe(5);
    expect(s.skipped).toBe(3);
    expect(s.insideRate).toBeCloseTo(3 / 5, 12);
    expect(s.breachUpRate).toBeCloseTo(1 / 5, 12);
    expect(s.breachDownRate).toBeCloseTo(1 / 5, 12);
    expect(s.insideRate + s.breachUpRate + s.breachDownRate).toBeCloseTo(1, 12);
  });

  it("tiene separato il tocco dallo sfondamento a scadenza", () => {
    expect(s.touchedRate).toBeCloseTo(3 / 5, 12);
    expect(s.neverTouchedRate).toBeCloseTo(2 / 5, 12);
    expect(s.touchedButReturnedRate).toBeCloseTo(1 / 5, 12);
  });

  it("condiziona l'ampiezza degli sfondamenti alle sole finestre sfondate", () => {
    expect(s.breachAll!.n).toBe(2);
    expect(s.breachAll!.mean).toBeCloseTo(0.0125, 12);
    expect(s.breachUp!.mean).toBeCloseTo(0.015, 12);
    expect(s.breachDown!.mean).toBeCloseTo(0.01, 12);
  });

  it("calcola il margine solo sulle finestre chiuse dentro", () => {
    expect(s.margin!.n).toBe(3);
    expect(s.margin!.min).toBeCloseTo(0.001, 12);
  });
});

describe("istogramma", () => {
  it("e' centrato sullo zero e conserva tutte le osservazioni", () => {
    const values = [-0.03, -0.01, 0, 0.005, 0.01, 0.02];
    const bins = histogram(values, 21);

    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(values.length);
    expect(bins.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 12);

    const central = bins[(bins.length - 1) / 2];
    expect(central.from).toBeLessThan(0);
    expect(central.to).toBeGreaterThan(0);
  });

  it("forza un numero dispari di bin per avere lo zero al centro", () => {
    expect(histogram([-0.01, 0.01], 20).length).toBe(21);
  });

  it("restituisce vuoto se non c'e' dispersione", () => {
    expect(histogram([])).toEqual([]);
    expect(histogram([0, 0, 0])).toEqual([]);
  });
});

describe("curva di sfondamento", () => {
  const returns = [-0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04];
  const curve = breachCurve(returns, 20);

  it("parte dalla frequenza dei movimenti non nulli e decresce", () => {
    expect(curve[0].probEither).toBeCloseTo(7 / 8, 12);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].probEither).toBeLessThanOrEqual(curve[i - 1].probEither);
      expect(curve[i].distance).toBeGreaterThan(curve[i - 1].distance);
    }
  });

  it("scompone la probabilita' nelle due direzioni", () => {
    for (const p of curve) {
      expect(p.probEither).toBeCloseTo(p.probUp + p.probDown, 12);
    }
    // la serie ha una coda superiore piu' lunga
    const far = curve[curve.length - 1];
    expect(far.probUp).toBeGreaterThanOrEqual(far.probDown);
  });

  it("legge la distanza corrispondente a una probabilita' data", () => {
    // meta' delle osservazioni supera in valore assoluto lo 0.015
    const p = curve.find((c) => c.probEither <= 0.5)!;
    expect(p.distance).toBeGreaterThan(0.01);
  });
});

describe("raggruppamenti", () => {
  const results = [
    result({ core: core({ year: 2019, vixAnnual: 0.12 }) }),
    result({ core: core({ year: 2019, vixAnnual: 0.14 }) }),
    result({
      core: core({ year: 2020, vixAnnual: 0.8 }),
      insideAtExpiry: false,
      breachedDown: true,
      breachPct: 0.09,
      marginPct: null,
    }),
    result({
      core: core({ year: 2020, vixAnnual: 0.6 }),
      insideAtExpiry: false,
      breachedUp: true,
      breachPct: 0.05,
      marginPct: null,
    }),
    result({ core: core({ year: 2021, vixAnnual: 0.2 }) }),
  ];

  it("aggrega per anno in ordine cronologico", () => {
    const years = byYear(results);
    expect(years.map((g) => g.label)).toEqual(["2019", "2020", "2021"]);
    expect(years[0].insideRate).toBe(1);
    expect(years[1].insideRate).toBe(0);
    expect(years[1].meanBreachPct).toBeCloseTo(0.07, 12);
    expect(years[1].worstBreachPct).toBeCloseTo(0.09, 12);
  });

  it("lascia null la media degli sfondamenti nei gruppi senza sfondamenti", () => {
    expect(byYear(results)[0].meanBreachPct).toBeNull();
  });

  it("esclude dai quintili VIX le finestre senza VIX", () => {
    const withNull = [...results, result({ core: core({ year: 2021, vixAnnual: null }) })];
    const quintiles = byVixQuintile(withNull);
    expect(quintiles.reduce((a, g) => a + g.n, 0)).toBe(results.length);
  });

  it("ordina le finestre peggiori per ampiezza dello sfondamento", () => {
    const worst = worstWindows(results, 5);
    expect(worst.length).toBe(2);
    expect(worst[0].breachPct).toBeCloseTo(0.09, 12);
    expect(worst[1].breachPct).toBeCloseTo(0.05, 12);
  });
});
