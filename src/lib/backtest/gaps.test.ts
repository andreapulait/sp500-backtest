import { describe, expect, it } from "vitest";

import { DEFAULT_GAP_EDGES, computeGaps, summarizeGaps } from "./gaps";
import type { Series } from "./types";

/** Serie con open e close controllati riga per riga. */
function makeSeries(rows: { close: number; open: number }[]): Series {
  const date = rows.map((_, i) =>
    new Date(Date.UTC(2020, 0, 2) + i * 86_400_000).toISOString().slice(0, 10)
  );
  return {
    symbol: "TEST",
    label: "Serie di test",
    date,
    o: rows.map((r) => r.open),
    h: rows.map((r) => Math.max(r.open, r.close)),
    l: rows.map((r) => Math.min(r.open, r.close)),
    c: rows.map((r) => r.close),
  };
}

describe("calcolo dei gap", () => {
  const series = makeSeries([
    { close: 100, open: 100 }, // prima seduta: nessun gap calcolabile
    { close: 102, open: 101 }, // +1,00%
    { close: 101, open: 102 }, // 0,00% -> open identico al close precedente
    { close: 99, open: 100.0 }, // -0,99...%
  ]);

  it("misura dal close precedente all'open corrente", () => {
    const gaps = computeGaps(series);
    expect(gaps.length).toBe(3);
    expect(gaps[0].date).toBe(series.date[1]);
    expect(gaps[0].prevClose).toBe(100);
    expect(gaps[0].open).toBe(101);
    expect(gaps[0].gapPct).toBeCloseTo(0.01, 12);
  });

  it("non produce alcun gap per la prima seduta della serie", () => {
    expect(computeGaps(series).some((g) => g.date === series.date[0])).toBe(false);
  });

  it("segnala l'open identico al close precedente", () => {
    const gaps = computeGaps(series);
    expect(gaps[1].identical).toBe(true);
    expect(gaps[1].gapPct).toBe(0);
    expect(gaps[0].identical).toBe(false);
  });

  it("rispetta gli estremi del periodo", () => {
    const gaps = computeGaps(series, series.date[2], series.date[2]);
    expect(gaps.length).toBe(1);
    expect(gaps[0].date).toBe(series.date[2]);
    // il close precedente resta quello della seduta prima, anche se fuori periodo
    expect(gaps[0].prevClose).toBe(102);
  });

  it("scarta le sedute con prezzi non validi", () => {
    const broken = makeSeries([
      { close: 100, open: 100 },
      { close: 0, open: 101 },
      { close: 102, open: 0 },
    ]);
    const gaps = computeGaps(broken);
    expect(gaps.length).toBe(1); // solo la seconda seduta e' calcolabile
    expect(gaps[0].open).toBe(101);
  });
});

describe("classi di ampiezza", () => {
  /** Gap costruiti per cadere in classi note: 0,05% / 0,3% / 0,6% / 1,2% / 4% */
  const pcts = [0.0005, -0.003, 0.006, -0.012, 0.04];
  const rows = [{ close: 100, open: 100 }];
  for (const p of pcts) rows.push({ close: 100, open: 100 * (1 + p) });
  const gaps = computeGaps(makeSeries(rows));
  const s = summarizeGaps("test", gaps);

  it("assegna ogni seduta a una sola classe", () => {
    expect(gaps.length).toBe(5);
    expect(s.buckets.reduce((a, b) => a + b.total, 0)).toBe(5);
    expect(s.buckets.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 12);
  });

  it("colloca i valori nelle classi attese", () => {
    const find = (from: number) => s.buckets.find((b) => b.from === from)!;
    expect(find(0).total).toBe(1); // 0,05% in 0–0,1%
    expect(find(0.0025).total).toBe(1); // 0,3% in 0,25–0,5%
    expect(find(0.005).total).toBe(1); // 0,6% in 0,5–0,75%
    expect(find(0.01).total).toBe(1); // 1,2% in 1–1,5%
    expect(find(0.03).total).toBe(1); // 4% nell'ultima classe aperta
  });

  it("separa la direzione dentro ogni classe", () => {
    const find = (from: number) => s.buckets.find((b) => b.from === from)!;
    expect(find(0.0025).down).toBe(1);
    expect(find(0.0025).up).toBe(0);
    expect(find(0.005).up).toBe(1);
    expect(s.upCount).toBe(3);
    expect(s.downCount).toBe(2);
  });

  it("la cumulata decresce e parte dal totale", () => {
    expect(s.buckets[0].cumulativeShare).toBeCloseTo(1, 12);
    for (let i = 1; i < s.buckets.length; i++) {
      expect(s.buckets[i].cumulativeShare).toBeLessThanOrEqual(
        s.buckets[i - 1].cumulativeShare
      );
    }
    // due sedute su cinque hanno |gap| >= 1%
    expect(s.buckets.find((b) => b.from === 0.01)!.cumulativeShare).toBeCloseTo(0.4, 12);
  });

  it("l'ultima classe e' aperta verso l'alto", () => {
    const last = s.buckets[s.buckets.length - 1];
    expect(last.to).toBeNull();
    expect(last.from).toBe(0.03);
  });

  it("un gap enorme finisce comunque nell'ultima classe", () => {
    const huge = computeGaps(makeSeries([{ close: 100, open: 100 }, { close: 100, open: 150 }]));
    const st = summarizeGaps("x", huge);
    expect(st.buckets[st.buckets.length - 1].total).toBe(1);
  });
});

describe("statistiche di periodo", () => {
  const rows = [{ close: 100, open: 100 }];
  for (const p of [0.01, -0.02, 0.005, 0, -0.015]) {
    rows.push({ close: 100, open: 100 * (1 + p) });
  }
  const s = summarizeGaps("periodo", computeGaps(makeSeries(rows)));

  it("calcola media e percentili sul valore assoluto", () => {
    // |gap| = 1%, 2%, 0,5%, 0%, 1,5% -> media 1%
    expect(s.meanAbs).toBeCloseTo(0.01, 9);
    expect(s.medianAbs).toBeCloseTo(0.01, 9);
    expect(s.maxUp).toBeCloseTo(0.01, 9);
    expect(s.maxDown).toBeCloseTo(-0.02, 9);
  });

  it("conta separatamente le sedute senza gap", () => {
    expect(s.flatCount).toBe(1);
    expect(s.upCount + s.downCount + s.flatCount).toBe(s.n);
  });

  it("espone la quota di open identici come indicatore di qualita'", () => {
    // una sola seduta ha open uguale al close precedente
    expect(s.identicalShare).toBeCloseTo(1 / 5, 12);
  });

  it("ordina gli estremi per ampiezza assoluta", () => {
    expect(Math.abs(s.extremes[0].gapPct)).toBeCloseTo(0.02, 9);
    expect(Math.abs(s.extremes[1].gapPct)).toBeCloseTo(0.015, 9);
  });

  it("distingue la media con segno da quella assoluta", () => {
    // (1 - 2 + 0,5 + 0 - 1,5) / 5 = -0,4%
    expect(s.meanSigned).toBeCloseTo(-0.004, 9);
    expect(s.meanSigned).not.toBeCloseTo(s.meanAbs, 4);
  });

  it("gestisce un periodo vuoto senza produrre NaN", () => {
    const empty = summarizeGaps("vuoto", []);
    expect(empty.n).toBe(0);
    expect(empty.meanAbs).toBe(0);
    expect(empty.identicalShare).toBe(0);
    expect(empty.buckets.length).toBe(DEFAULT_GAP_EDGES.length);
    expect(empty.buckets.every((b) => b.total === 0)).toBe(true);
  });
});
