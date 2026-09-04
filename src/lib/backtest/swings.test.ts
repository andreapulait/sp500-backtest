import { describe, expect, it } from "vitest";

import { buildLegs, extractSignals, summarizeDirection, wilsonInterval } from "./swings";
import type { Series } from "./types";

/** Costruisce una serie da barre high/low esplicite; il close sta a meta' barra. */
function makeSeries(bars: { h: number; l: number }[]): Series {
  const date = bars.map((_, i) =>
    new Date(Date.UTC(2020, 0, 2) + i * 86_400_000).toISOString().slice(0, 10)
  );
  return {
    symbol: "TEST",
    label: "Serie di test",
    date,
    o: bars.map((b) => (b.h + b.l) / 2),
    h: bars.map((b) => b.h),
    l: bars.map((b) => b.l),
    c: bars.map((b) => (b.h + b.l) / 2),
  };
}

describe("segmentazione in fasi", () => {
  it("conta le barre che formano nuovi massimi finche' non arriva un nuovo minimo", () => {
    const s = makeSeries([
      { h: 10, l: 9 }, // riferimento
      { h: 11, l: 10 }, // massimo 1
      { h: 12, l: 11 }, // massimo 2
      { h: 13, l: 12 }, // massimo 3
      { h: 12.5, l: 11 }, // nuovo minimo -> chiude la fase rialzista
    ]);

    const legs = buildLegs(s);
    expect(legs[0].direction).toBe("up");
    expect(legs[0].count).toBe(3);
    expect(legs[0].extremeDates).toEqual([s.date[1], s.date[2], s.date[3]]);
    expect(legs[1].direction).toBe("down");
    expect(legs[1].startDate).toBe(s.date[4]);
  });

  it("le barre interne non contano e non interrompono la fase", () => {
    const s = makeSeries([
      { h: 10, l: 9 },
      { h: 11, l: 10 }, // massimo 1
      { h: 10.8, l: 10.2 }, // interna: ne' massimo ne' minimo
      { h: 12, l: 10.5 }, // massimo 2
    ]);

    const legs = buildLegs(s);
    expect(legs.length).toBe(1);
    expect(legs[0].count).toBe(2);
    expect(legs[0].neutralBars).toBe(1);
    expect(legs[0].open).toBe(true);
  });

  it("alterna correttamente su piu' inversioni", () => {
    const s = makeSeries([
      { h: 10, l: 9 },
      { h: 11, l: 10 }, // up 1
      { h: 12, l: 11 }, // up 2
      { h: 11.5, l: 10 }, // down 1
      { h: 11, l: 9 }, // down 2
      { h: 12, l: 9.5 }, // up 1 (nuova fase)
    ]);

    const legs = buildLegs(s);
    expect(legs.map((l) => l.direction)).toEqual(["up", "down", "up"]);
    expect(legs.map((l) => l.count)).toEqual([2, 2, 1]);
  });

  it("apre la prima fase sulla prima barra con un estremo solo", () => {
    const s = makeSeries([
      { h: 10, l: 9 },
      { h: 11, l: 8 }, // esterna: non puo' seminare la direzione
      { h: 10.5, l: 7 }, // nuovo minimo soltanto -> apre una fase ribassista
    ]);

    const legs = buildLegs(s);
    expect(legs[0].direction).toBe("down");
    expect(legs[0].startDate).toBe(s.date[2]);
  });

  it("l'ultima fase resta aperta e non ha una lunghezza definitiva", () => {
    const s = makeSeries([
      { h: 10, l: 9 },
      { h: 11, l: 10 },
      { h: 12, l: 11 },
    ]);
    const legs = buildLegs(s);
    expect(legs[legs.length - 1].open).toBe(true);
  });
});

describe("barre esterne", () => {
  const s = makeSeries([
    { h: 10, l: 9 },
    { h: 11, l: 10 }, // up 1
    { h: 12, l: 8 }, // esterna: nuovo massimo e nuovo minimo
    { h: 13, l: 12 }, // nuovo massimo
  ]);

  it("in modalita' flip ribaltano la fase", () => {
    const legs = buildLegs(s, { outside: "flip" });
    expect(legs.map((l) => l.direction)).toEqual(["up", "down", "up"]);
    expect(legs[0].count).toBe(1);
    expect(legs[1].startDate).toBe(s.date[2]);
  });

  it("in modalita' keep proseguono la fase in corso", () => {
    const legs = buildLegs(s, { outside: "keep" });
    expect(legs.length).toBe(1);
    expect(legs[0].direction).toBe("up");
    expect(legs[0].count).toBe(3);
  });
});

describe("statistiche per direzione", () => {
  // tre fasi rialziste chiuse, di 1, 2 e 3 barre
  const s = makeSeries([
    { h: 10, l: 9 },
    { h: 11, l: 10 }, // up 1 -> fase da 1
    { h: 10.5, l: 9 }, // down
    { h: 11, l: 9.5 }, // up 1
    { h: 12, l: 10 }, // up 2 -> fase da 2
    { h: 11, l: 9 }, // down
    { h: 12, l: 9.5 }, // up 1
    { h: 13, l: 10 }, // up 2
    { h: 14, l: 11 }, // up 3 -> fase da 3
    { h: 13, l: 10 }, // down: chiude
    { h: 12, l: 9 }, // down
  ]);

  const stats = summarizeDirection(buildLegs(s), "up");

  it("esclude le fasi ancora aperte dal conteggio", () => {
    expect(stats.legs).toBe(3);
    expect(stats.maxCount).toBe(3);
  });

  it("calcola la probabilita' di prosecuzione condizionata", () => {
    const row = (c: number) => stats.rows.find((r) => r.count === c)!;
    // tutte e tre raggiungono 1, due proseguono
    expect(row(1).reached).toBe(3);
    expect(row(1).continuationRate).toBeCloseTo(2 / 3, 12);
    // due raggiungono 2, una prosegue
    expect(row(2).reached).toBe(2);
    expect(row(2).continuationRate).toBeCloseTo(1 / 2, 12);
    // una raggiunge 3, nessuna prosegue
    expect(row(3).reached).toBe(1);
    expect(row(3).continuationRate).toBe(0);
  });

  it("le fasi terminate a ogni lunghezza sommano al totale", () => {
    expect(stats.rows.reduce((a, r) => a + r.ended, 0)).toBe(stats.legs);
    expect(stats.rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 12);
  });

  it("il numero di fasi che raggiungono N non cresce mai", () => {
    for (let i = 1; i < stats.rows.length; i++) {
      expect(stats.rows[i].reached).toBeLessThanOrEqual(stats.rows[i - 1].reached);
    }
  });
});

describe("intervallo di Wilson", () => {
  it("si stringe al crescere del campione", () => {
    const small = wilsonInterval(14, 20); // 70% su 20 osservazioni
    const large = wilsonInterval(700, 1000); // 70% su 1000
    expect(small[1] - small[0]).toBeGreaterThan(large[1] - large[0]);
    expect(large[1] - large[0]).toBeLessThan(0.07);
  });

  it("su 20 osservazioni il 70% resta compatibile col 55%", () => {
    const [low, high] = wilsonInterval(14, 20);
    expect(low).toBeLessThan(0.55);
    expect(high).toBeGreaterThan(0.55);
    expect(low).toBeCloseTo(0.481, 2);
    expect(high).toBeCloseTo(0.855, 2);
  });

  it("resta dentro [0,1] anche agli estremi", () => {
    const certain = wilsonInterval(1, 1);
    expect(certain[1]).toBeLessThanOrEqual(1);
    expect(certain[0]).toBeLessThan(0.5); // una sola osservazione non prova nulla

    const none = wilsonInterval(0, 1);
    expect(none[0]).toBeGreaterThanOrEqual(0);
    expect(none[1]).toBeGreaterThan(0.5);
  });

  it("restituisce un intervallo nullo senza osservazioni", () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 0]);
  });

  it("contiene sempre la proporzione osservata", () => {
    for (const [k, n] of [
      [14, 20],
      [20, 37],
      [788, 1417],
      [1, 2],
    ]) {
      const [low, high] = wilsonInterval(k, n);
      expect(k / n).toBeGreaterThanOrEqual(low);
      expect(k / n).toBeLessThanOrEqual(high);
    }
  });
});

describe("estrazione dei segnali", () => {
  const s = makeSeries([
    { h: 10, l: 9 },
    { h: 9.5, l: 8 }, // down 1
    { h: 9, l: 7 }, // down 2
    { h: 10, l: 7.5 }, // up 1
    { h: 11, l: 8 }, // up 2
    { h: 12, l: 9 }, // up 3
    { h: 11, l: 8 }, // down: chiude la fase rialzista
  ]);
  const legs = buildLegs(s);

  it("restituisce la data della barra che raggiunge il conteggio", () => {
    const dates = extractSignals(legs, { direction: "up", atCount: 2, minPrevLegCount: 0 });
    expect(dates).toEqual([s.date[4]]);
  });

  it("applica la condizione sulla fase opposta precedente", () => {
    expect(
      extractSignals(legs, { direction: "up", atCount: 2, minPrevLegCount: 2 })
    ).toEqual([s.date[4]]);
    // la discesa precedente ha solo 2 barre: con soglia 3 il segnale sparisce
    expect(
      extractSignals(legs, { direction: "up", atCount: 2, minPrevLegCount: 3 })
    ).toEqual([]);
  });

  it("non produce nulla se la fase non raggiunge il conteggio", () => {
    expect(
      extractSignals(legs, { direction: "up", atCount: 9, minPrevLegCount: 0 })
    ).toEqual([]);
  });

  it("ignora la prima fase quando si richiede una fase precedente", () => {
    const dates = extractSignals(legs, { direction: "down", atCount: 1, minPrevLegCount: 1 });
    // la prima discesa non ha una fase precedente, quindi non e' un segnale
    expect(dates).not.toContain(s.date[1]);
  });
});
