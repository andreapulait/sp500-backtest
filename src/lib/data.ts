import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { alignVix, computeRealizedVol, deriveXsp } from "./backtest/series";
import type { Series } from "./backtest/types";

const DATA_DIR = path.join(process.cwd(), "src", "data");

export type SymbolInfo = {
  symbol: string;
  label: string;
  bars: number;
  from: string;
  to: string;
  derived?: boolean;
};

/**
 * Dataset pronto per il motore: serie, volatilita' realizzata e VIX allineato,
 * tutto precalcolato una volta sola per processo.
 */
export type Dataset = {
  info: SymbolInfo;
  series: Series;
  realizedVol: (number | null)[];
  /** VIX di chiusura convertito in frazione annua (20 -> 0.20) */
  vixAnnual: (number | null)[];
};

const rawCache = new Map<string, Promise<Series>>();
const datasetCache = new Map<string, Promise<Dataset>>();
let manifestCache: Promise<SymbolInfo[]> | null = null;

function readSeries(key: string): Promise<Series> {
  let p = rawCache.get(key);
  if (!p) {
    p = readFile(path.join(DATA_DIR, `${key}.json`), "utf8").then(
      (txt) => JSON.parse(txt) as Series
    );
    rawCache.set(key, p);
  }
  return p;
}

/**
 * Simboli disponibili. XSP non ha una serie propria: la serie nativa parte dal
 * 2021, quindi viene derivata da SPX/10 e eredita tutta la storia dal 1927.
 */
export function listSymbols(): Promise<SymbolInfo[]> {
  manifestCache ??= (async () => {
    const txt = await readFile(path.join(DATA_DIR, "manifest.json"), "utf8");
    const manifest = JSON.parse(txt) as { series: SymbolInfo[] };

    const out: SymbolInfo[] = [];
    for (const s of manifest.series) {
      if (s.symbol === "VIX") continue; // usato come regime, non come sottostante
      out.push(s);
      if (s.symbol === "SPX") {
        out.push({
          ...s,
          symbol: "XSP",
          label: "Mini-SPX Index (SPX / 10)",
          derived: true,
        });
      }
    }

    const order = ["SPX", "XSP", "SPY", "NDX"];
    return out.sort((a, b) => {
      const ia = order.indexOf(a.symbol);
      const ib = order.indexOf(b.symbol);
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
    });
  })();
  return manifestCache;
}

export function getDataset(symbol: string): Promise<Dataset> {
  const key = symbol.toUpperCase();
  let p = datasetCache.get(key);
  if (p) return p;

  p = (async () => {
    const symbols = await listSymbols();
    const info = symbols.find((s) => s.symbol === key);
    if (!info) throw new Error(`Simbolo non disponibile: ${symbol}`);

    const series =
      key === "XSP" ? deriveXsp(await readSeries("spx")) : await readSeries(key.toLowerCase());

    const vix = await readSeries("vix");

    return {
      info,
      series,
      realizedVol: computeRealizedVol(series),
      vixAnnual: alignVix(series, vix).map((v) => (v == null ? null : v / 100)),
    };
  })();

  datasetCache.set(key, p);
  return p;
}
