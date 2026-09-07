/**
 * Effetto della soglia di chiusura sulle fasi e sul residuo dal 4o massimo.
 *   npx tsx scripts/soglie.mts
 */
import { readFile } from "node:fs/promises";

import { buildLegs, summarizeDirection } from "../src/lib/backtest/swings.ts";
import { buildResidualRows } from "../src/lib/backtest/residuals.ts";
import type { Series } from "../src/lib/backtest/types.ts";

const spx: Series = JSON.parse(
  await readFile("C:/Projects/sp500-backtest/src/data/spx.json", "utf8")
);

const pct = (v: number | null | undefined) =>
  v == null ? "—" : `${(v * 100).toFixed(2)}%`;

console.log("SPX dal 2000 — effetto della soglia di chiusura\n");
console.log(
  "soglia".padEnd(8) +
    "fasi su".padStart(9) +
    "lung. med.".padStart(12) +
    "lung. max".padStart(11) +
    "residuo 4°".padStart(12) +
    "p90".padStart(9) +
    "sedute".padStart(8)
);

for (const k of [1, 2, 3, 4, 5, 6]) {
  const legs = buildLegs(spx, { from: "2000-01-01", closeUpAfter: k, closeDownAfter: k });
  const up = summarizeDirection(legs, "up");
  const rows = buildResidualRows(spx, legs, "up", "extreme");
  const r4 = rows.find((r) => r.atCount === 4);

  console.log(
    String(k).padEnd(8) +
      String(up.legs).padStart(9) +
      String(up.medianCount).padStart(12) +
      String(up.maxCount).padStart(11) +
      pct(r4?.residualPct?.median).padStart(12) +
      pct(r4?.residualPct?.p90).padStart(9) +
      String(r4?.residualSessions?.median ?? "—").padStart(8)
  );
}

// confronto diretto col foglio del collega, stesso periodo
console.log("\nStesso periodo del foglio (2017-12-29 → 2025-01-13)");
console.log("foglio: 41 swing, residuo mediano 4,31%, barre al rialzo mediane 12\n");
console.log("soglia".padEnd(8) + "fasi su".padStart(9) + "lung. med.".padStart(12) + "residuo 4°".padStart(12));

for (const k of [1, 2, 3, 4, 5, 6, 8]) {
  const legs = buildLegs(spx, {
    from: "2017-12-29",
    to: "2025-01-13",
    closeUpAfter: k,
    closeDownAfter: k,
  });
  const up = summarizeDirection(legs, "up");
  const rows = buildResidualRows(spx, legs, "up", "extreme");
  const r4 = rows.find((r) => r.atCount === 4);

  console.log(
    String(k).padEnd(8) +
      String(up.legs).padStart(9) +
      String(up.medianCount).padStart(12) +
      pct(r4?.residualPct?.median).padStart(12)
  );
}
