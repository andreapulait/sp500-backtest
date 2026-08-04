import type { Series, SigmaSource } from "./types";

/** Giorni di borsa in un anno, usato per annualizzare e per scalare sigma sulla durata. */
export const TRADING_DAYS_PER_YEAR = 252;

/** Finestra di lookback per la volatilita' realizzata, in giorni di borsa. */
export const REALIZED_VOL_LOOKBACK = 30;

/**
 * Scala un sigma annualizzato sulla durata della strategia.
 * sigma_N = sigma_annuo * sqrt(N / 252)
 */
export function scaleSigma(sigmaAnnual: number, days: number): number {
  return sigmaAnnual * Math.sqrt(days / TRADING_DAYS_PER_YEAR);
}

/**
 * Volatilita' realizzata annualizzata per ogni barra della serie.
 *
 * Deviazione standard campionaria dei rendimenti logaritmici sugli ultimi
 * `lookback` giorni di borsa, inclusa la barra corrente, moltiplicata per
 * sqrt(252). Le prime `lookback` barre restano null: non c'e' storia a
 * sufficienza e stimarle con meno dati introdurrebbe un bias verso il basso.
 */
export function computeRealizedVol(
  series: Series,
  lookback: number = REALIZED_VOL_LOOKBACK
): (number | null)[] {
  const n = series.c.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < 2) return out;

  const logRet = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) logRet[i] = Math.log(series.c[i] / series.c[i - 1]);

  for (let i = lookback; i < n; i++) {
    // rendimenti da i-lookback+1 a i inclusi
    let sum = 0;
    for (let k = i - lookback + 1; k <= i; k++) sum += logRet[k];
    const mean = sum / lookback;

    let sq = 0;
    for (let k = i - lookback + 1; k <= i; k++) {
      const d = logRet[k] - mean;
      sq += d * d;
    }
    const variance = sq / (lookback - 1);
    out[i] = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  }

  return out;
}

/**
 * Allinea il VIX alle date della serie principale.
 *
 * Restituisce il VIX di chiusura per ogni barra, o null se quella data non
 * esiste nella serie VIX. Non facciamo forward-fill: usare il VIX di ieri come
 * se fosse quello di oggi falserebbe l'ancoraggio a sigma proprio nei giorni
 * di dati mancanti, che tendono a essere quelli turbolenti.
 */
export function alignVix(series: Series, vix: Series): (number | null)[] {
  const byDate = new Map<string, number>();
  for (let i = 0; i < vix.date.length; i++) byDate.set(vix.date[i], vix.c[i]);
  return series.date.map((d) => byDate.get(d) ?? null);
}

/** XSP e' definito come un decimo di SPX: deriviamo la serie invece di scaricarla. */
export function deriveXsp(spx: Series): Series {
  const div = (arr: number[]) => arr.map((v) => Math.round((v / 10) * 100) / 100);
  return {
    symbol: "XSP",
    label: "Mini-SPX Index (SPX / 10)",
    source: `${spx.source ?? "spx"} / 10`,
    fetchedAt: spx.fetchedAt,
    date: spx.date,
    o: div(spx.o),
    h: div(spx.h),
    l: div(spx.l),
    c: div(spx.c),
  };
}

/** Primo indice con data >= `from`; 0 se `from` non e' definito. */
export function indexAtOrAfter(dates: string[], from?: string): number {
  if (!from) return 0;
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Ultimo indice con data <= `to`; dates.length-1 se `to` non e' definito. */
export function indexAtOrBefore(dates: string[], to?: string): number {
  if (!to) return dates.length - 1;
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= to) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Sigma annualizzato da usare per una barra, secondo la fonte scelta. */
export function sigmaAt(
  index: number,
  source: SigmaSource,
  realizedVol: (number | null)[],
  vixAnnual: (number | null)[]
): number | null {
  return source === "vix" ? vixAnnual[index] : realizedVol[index];
}
