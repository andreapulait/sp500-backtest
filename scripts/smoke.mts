/**
 * Verifica di sanita' su dati reali: straddle ATM 5 giorni su SPX con BEP a +/-1.2%.
 *   npx tsx scripts/smoke.mts
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runBacktest } from "../src/lib/backtest/engine.ts";
import { alignVix, computeRealizedVol, scaleSigma } from "../src/lib/backtest/series.ts";
import { breachCurve, byVixQuintile, summarize, worstWindows } from "../src/lib/backtest/stats.ts";
import type { Series } from "../src/lib/backtest/types.ts";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");
const load = async (k: string): Promise<Series> =>
  JSON.parse(await readFile(join(DATA, `${k}.json`), "utf8"));

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

const spx = await load("spx");
const vixSeries = await load("vix");

const realizedVol = computeRealizedVol(spx);
const vixAnnual = alignVix(spx, vixSeries).map((v) => (v == null ? null : v / 100));

const spot = spx.c[spx.c.length - 1];
const sigmaAnnual = realizedVol[realizedVol.length - 1]!;
const bep = Math.round(spot * 0.012 * 100) / 100;

console.log(`SPX ${spx.date[0]} -> ${spx.date[spx.date.length - 1]}  (${spx.date.length} barre)`);
console.log(`spot ${spot}   vol realizzata 30gg ${pct(sigmaAnnual)}   sigma 5gg ${pct(scaleSigma(sigmaAnnual, 5))}`);
console.log(`BEP +/-${bep} punti (+/-1.20%)\n`);

const out = runBacktest({
  series: spx,
  realizedVol,
  vixAnnual,
  params: {
    symbol: "SPX",
    days: 5,
    bepLowPoints: -bep,
    bepHighPoints: bep,
    referenceSpot: spot,
    referenceSigmaAnnual: sigmaAnnual,
    sigmaSource: "realized",
    sampling: { kind: "overlapping" },
    from: "2006-01-01",
  },
});

console.log(
  `finestre ${out.diagnostics.totalWindows}  (indipendenti ~${out.diagnostics.effectiveIndependentWindows})  ` +
    `${out.diagnostics.firstEntry} -> ${out.diagnostics.lastEntry}\n`
);

console.log("ancoraggio   n      dentro   sopra    sotto    mai tocc.  rientrate  sfond.medio  peggiore");
for (const anchor of ["pct", "sigma"] as const) {
  const s = summarize(out.runs[anchor]);
  console.log(
    [
      anchor.padEnd(11),
      String(s.n).padEnd(6),
      pct(s.insideRate).padStart(7),
      pct(s.breachUpRate).padStart(8),
      pct(s.breachDownRate).padStart(8),
      pct(s.neverTouchedRate).padStart(10),
      pct(s.touchedButReturnedRate).padStart(10),
      (s.breachAll ? pct(s.breachAll.mean) : "-").padStart(12),
      (s.breachAll ? pct(s.breachAll.max) : "-").padStart(9),
    ].join(" ")
  );
}

const pctRun = out.runs.pct;
console.log("\nDistanza -> frequenza storica di chiusura oltre la banda (ancoraggio %):");
const curve = breachCurve(pctRun.results.map((w) => w.core.retPct));
for (const target of [0.5, 0.32, 0.2, 0.1, 0.05]) {
  const p = curve.find((c) => c.probEither <= target);
  if (p) console.log(`  ${pct(target).padStart(6)} delle volte oltre +/- ${pct(p.distance)}`);
}

console.log("\nPer quintile di VIX all'ingresso — confronto tra ancoraggi:");
const qPct = byVixQuintile(pctRun.results);
const qSigma = byVixQuintile(out.runs.sigma.results);
console.log("  quintile             dentro (%)   dentro (sigma)");
for (let i = 0; i < qPct.length; i++) {
  console.log(
    `  ${qPct[i].label.padEnd(18)} ${pct(qPct[i].insideRate).padStart(9)} ${pct(qSigma[i].insideRate).padStart(15)}`
  );
}
const spread = (g: typeof qPct) =>
  Math.max(...g.map((x) => x.insideRate)) - Math.min(...g.map((x) => x.insideRate));
console.log(`  escursione tra quintili:  ${pct(spread(qPct))} (%)   vs   ${pct(spread(qSigma))} (sigma)`);

console.log("\nPeggiori 5 finestre (ancoraggio %):");
for (const w of worstWindows(pctRun.results, 5)) {
  const dir = w.breachedUp ? "sopra" : "sotto";
  console.log(
    `  ${w.core.entryDate} -> ${w.core.exitDate}  ${w.core.s0} -> ${w.core.sT}  ` +
      `${dir} di ${pct(w.breachPct)}  (rend. ${pct(w.core.retPct)})`
  );
}
