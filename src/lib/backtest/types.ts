/** Serie storica giornaliera in formato colonnare (come salvata in src/data). */
export type Series = {
  symbol: string;
  label: string;
  source?: string;
  fetchedAt?: string;
  date: string[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
};

/**
 * Da cosa ricaviamo il sigma di riferimento.
 * - "realized": deviazione standard dei rendimenti log a 30 giorni di borsa, annualizzata
 * - "vix":      VIX di chiusura del giorno d'ingresso / 100 (gia' annualizzato)
 */
export type SigmaSource = "realized" | "vix";

/**
 * Come i BEP scalano da una finestra storica all'altra.
 * - "pct":   distanza percentuale costante dallo spot, misurata sullo spot di oggi
 * - "sigma": distanza costante in deviazioni standard, sigma ricalcolato su ogni finestra
 *
 * Un ancoraggio a punti fissi e' deliberatamente assente: su serie lunghe
 * confronterebbe distanze non comparabili, dato che gli stessi punti valgono
 * percentuali molto diverse a livelli di indice diversi.
 */
export type AnchorMode = "pct" | "sigma";

export const ANCHOR_MODES: AnchorMode[] = ["pct", "sigma"];

/** Come campioniamo i giorni d'ingresso. */
export type Sampling =
  | { kind: "overlapping" }
  | { kind: "disjoint" }
  /** 0 = domenica ... 6 = sabato; per replicare scadenze settimanali fisse */
  | { kind: "weekday"; weekday: number };

export type BacktestParams = {
  symbol: string;
  /** durata della strategia in giorni di borsa */
  days: number;
  /** BEP inferiore e superiore espressi in punti sullo spot di riferimento */
  bepLowPoints: number;
  bepHighPoints: number;
  /** spot su cui sono stati definiti i BEP (di norma l'ultimo close) */
  referenceSpot: number;
  /** sigma annualizzato usato per tradurre i BEP di riferimento in deviazioni standard */
  referenceSigmaAnnual: number;
  sigmaSource: SigmaSource;
  sampling: Sampling;
  /** estremi inclusivi in formato ISO; assenti = tutta la storia disponibile */
  from?: string;
  to?: string;
};

/** Dati di una finestra indipendenti dall'ancoraggio scelto. */
export type WindowCore = {
  entryIndex: number;
  exitIndex: number;
  entryDate: string;
  exitDate: string;
  /** close del giorno d'ingresso */
  s0: number;
  /** close del giorno di scadenza */
  sT: number;
  /** massimo e minimo toccati nei giorni successivi all'ingresso, scadenza inclusa */
  pathHigh: number;
  pathLow: number;
  retPct: number;
  retLog: number;
  /** escursione massima favorevole/avversa in % rispetto allo spot d'ingresso */
  excursionUpPct: number;
  excursionDownPct: number;
  /** sigma annualizzato al giorno d'ingresso, per fonte; null se non calcolabile */
  realizedVolAnnual: number | null;
  vixAnnual: number | null;
  year: number;
};

/** Esito di una finestra valutata con un ancoraggio specifico. */
export type WindowResult = {
  core: WindowCore;
  bepLow: number;
  bepHigh: number;
  /** larghezza del range in % dello spot d'ingresso */
  rangeWidthPct: number;
  insideAtExpiry: boolean;
  breachedUp: boolean;
  breachedDown: boolean;
  /** distanza oltre il BEP a scadenza, in % dello spot; 0 se dentro */
  breachPct: number;
  /** come sopra ma in punti indice */
  breachPoints: number;
  touchedUp: boolean;
  touchedDown: boolean;
  /** ha violato un BEP durante la vita ma e' rientrato entro la scadenza */
  touchedButReturned: boolean;
  /** distanza dal BEP piu' vicino a scadenza, in % dello spot; null se sfondato */
  marginPct: number | null;
  /** il BEP inferiore e' <= 0, quindi irraggiungibile (accade con ancoraggio a punti su dati vecchi) */
  lowerBepUnreachable: boolean;
};
