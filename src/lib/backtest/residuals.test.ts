import { describe as group, expect, it } from "vitest";

import { buildResidualRows } from "./residuals";
import { buildLegs } from "./swings";
import type { Series } from "./types";

function makeSeries(bars: { h: number; l: number; c: number }[]): Series {
  const date = bars.map((_, i) =>
    new Date(Date.UTC(2020, 0, 2) + i * 86_400_000).toISOString().slice(0, 10)
  );
  return {
    symbol: "TEST",
    label: "Serie di test",
    date,
    o: bars.map((b) => b.c),
    h: bars.map((b) => b.h),
    l: bars.map((b) => b.l),
    c: bars.map((b) => b.c),
  };
}

group("escursione residua", () => {
  // fase rialzista di 3 barre: massimi 110, 120, 130; chiusure 105, 115, 125
  const s = makeSeries([
    { h: 100, l: 90, c: 95 },
    { h: 110, l: 95, c: 105 }, // massimo 1
    { h: 120, l: 105, c: 115 }, // massimo 2
    { h: 130, l: 115, c: 125 }, // massimo 3, top della fase
    { h: 128, l: 110, c: 118 }, // nuovo minimo: chiude la fase
    { h: 127, l: 105, c: 110 }, // minimo
    { h: 135, l: 112, c: 130 }, // massimo: apre una nuova fase
  ]);

  const legs = buildLegs(s);
  const rows = buildResidualRows(s, legs, "up");

  it("misura dal close della barra osservata al massimo della fase", () => {
    const r1 = rows.find((r) => r.atCount === 1)!;
    // dal close 105 al top 130
    expect(r1.residualPct!.median).toBeCloseTo(130 / 105 - 1, 12);
  });

  it("il residuo si riduce avanzando nella fase", () => {
    const at = (n: number) => rows.find((r) => r.atCount === n)!.residualPct!.median;
    expect(at(1)).toBeCloseTo(130 / 105 - 1, 12);
    expect(at(2)).toBeCloseTo(130 / 115 - 1, 12);
    expect(at(3)).toBeCloseTo(130 / 125 - 1, 12);
    expect(at(1)).toBeGreaterThan(at(2));
    expect(at(2)).toBeGreaterThan(at(3));
  });

  it("sull'ultimo estremo il residuo e' la distanza fra close e massimo della stessa barra", () => {
    const r3 = rows.find((r) => r.atCount === 3)!;
    expect(r3.residualPct!.median).toBeCloseTo(130 / 125 - 1, 12);
    expect(r3.residualPct!.median).toBeGreaterThan(0);
    expect(r3.residualExtremeBars!.median).toBe(0);
    expect(r3.residualSessions!.median).toBe(0);
  });

  it("con riferimento all'estremo la fase che finisce li' ha residuo esattamente nullo", () => {
    const byExtreme = buildResidualRows(s, legs, "up", "extreme");
    const r3 = byExtreme.find((r) => r.atCount === 3)!;
    expect(r3.residualPct!.median).toBe(0);
    // le barre precedenti misurano la sola estensione oltre il massimo gia' fatto
    expect(byExtreme.find((r) => r.atCount === 1)!.residualPct!.median).toBeCloseTo(
      130 / 110 - 1,
      12
    );
    expect(byExtreme.find((r) => r.atCount === 2)!.residualPct!.median).toBeCloseTo(
      130 / 120 - 1,
      12
    );
  });

  it("il residuo dal massimo e' sempre minore di quello dalla chiusura", () => {
    const byExtreme = buildResidualRows(s, legs, "up", "extreme");
    for (const r of rows) {
      const other = byExtreme.find((x) => x.atCount === r.atCount)!;
      expect(other.residualPct!.median).toBeLessThan(r.residualPct!.median);
    }
  });

  it("al ribasso il riferimento e' il minimo della barra", () => {
    const down = makeSeries([
      { h: 100, l: 90, c: 95 },
      { h: 95, l: 80, c: 90 }, // minimo 1: low 80
      { h: 92, l: 70, c: 75 }, // minimo 2: low 70, fondo
      { h: 96, l: 76, c: 94 }, // massimo: chiude
      { h: 99, l: 85, c: 97 },
    ]);
    const r = buildResidualRows(down, buildLegs(down), "down", "extreme");
    expect(r.find((x) => x.atCount === 1)!.residualPct!.median).toBeCloseTo(70 / 80 - 1, 12);
  });

  it("conta le sedute residue fino al top", () => {
    expect(rows.find((r) => r.atCount === 1)!.residualSessions!.median).toBe(2);
    expect(rows.find((r) => r.atCount === 2)!.residualSessions!.median).toBe(1);
  });

  it("include anche le fasi che si fermano al conteggio osservato", () => {
    // la fase ha 3 estremi: tutte e tre le righe devono contarla
    for (const n of [1, 2, 3]) {
      expect(rows.find((r) => r.atCount === n)!.n).toBe(1);
    }
  });

  it("esclude le fasi ancora aperte, che non hanno un top definitivo", () => {
    // l'ultima fase rialzista della serie e' aperta e non deve comparire
    const total = rows.find((r) => r.atCount === 1)!.n;
    expect(total).toBe(1);
    expect(legs.some((l) => l.open && l.direction === "up")).toBe(true);
  });
});

group("raggruppamento annidato", () => {
  // due fasi rialziste: una da 1 estremo, una da 3
  const s = makeSeries([
    { h: 100, l: 90, c: 95 },
    { h: 110, l: 95, c: 100 }, // fase A: massimo 1 (unico)
    { h: 105, l: 85, c: 90 }, // minimo: chiude A
    { h: 104, l: 80, c: 85 }, // minimo
    { h: 115, l: 90, c: 110 }, // fase B: massimo 1
    { h: 125, l: 110, c: 120 }, // massimo 2
    { h: 135, l: 120, c: 130 }, // massimo 3
    { h: 130, l: 110, c: 115 }, // minimo: chiude B
    { h: 128, l: 100, c: 105 }, // minimo
    { h: 140, l: 110, c: 135 }, // massimo: nuova fase, resta aperta
  ]);

  const rows = buildResidualRows(s, buildLegs(s), "up");
  const r1 = rows.find((r) => r.atCount === 1)!;

  it("separa i casi per numero di estremi ancora da formare", () => {
    expect(r1.n).toBe(2);
    expect(r1.buckets.map((b) => b.residualExtremeBars)).toEqual([0, 2]);
    expect(r1.buckets.map((b) => b.n)).toEqual([1, 1]);
  });

  it("le quote dei gruppi sommano a uno", () => {
    expect(r1.buckets.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 12);
  });

  it("i gruppi conservano tutte le osservazioni della riga", () => {
    expect(r1.buckets.reduce((a, b) => a + b.n, 0)).toBe(r1.n);
  });

  it("espone le occorrenze con date e prezzi", () => {
    const withTwo = r1.buckets.find((b) => b.residualExtremeBars === 2)!;
    const sample = withTwo.samples[0];
    expect(sample.observed).toBe(s.date[4]);
    expect(sample.topDate).toBe(s.date[6]);
    expect(sample.refClose).toBe(110);
    expect(sample.topPrice).toBe(135);
    expect(sample.residualSessions).toBe(2);
  });

  it("calcola la quota oltre le soglie sul valore assoluto", () => {
    // residui: fase A 10/100 = 10%, fase B 135/110-1 = 22,7%
    const over3 = r1.thresholds.find((t) => t.level === 0.03)!;
    expect(over3.share).toBe(1);
  });
});

group("fasi ribassiste", () => {
  const s = makeSeries([
    { h: 100, l: 90, c: 95 },
    { h: 95, l: 80, c: 85 }, // minimo 1
    { h: 90, l: 70, c: 75 }, // minimo 2, fondo della fase
    { h: 95, l: 75, c: 90 }, // massimo: chiude la fase
    { h: 100, l: 85, c: 98 }, // massimo
  ]);

  const rows = buildResidualRows(s, buildLegs(s), "down");

  it("misura il residuo verso il basso con segno negativo", () => {
    const r1 = rows.find((r) => r.atCount === 1)!;
    // dal close 85 al minimo 70
    expect(r1.residualPct!.median).toBeCloseTo(70 / 85 - 1, 12);
    expect(r1.residualPct!.median).toBeLessThan(0);
  });

  it("le soglie usano il valore assoluto", () => {
    const r1 = rows.find((r) => r.atCount === 1)!;
    expect(r1.thresholds.find((t) => t.level === 0.03)!.share).toBe(1);
  });
});
