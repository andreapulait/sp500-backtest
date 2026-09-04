import type { AnchorMode, SigmaSource } from "./backtest/types";
import type { BreachCurvePoint, Distribution, GroupStats, HistogramBin } from "./backtest/stats";

export type SamplingKind = "overlapping" | "disjoint" | "weekday";

/**
 * Richiesta di analisi.
 *
 * I BEP viaggiano come distanza percentuale con segno rispetto allo spot
 * (es. -0.012 e +0.012). E' la forma canonica: l'utente li inserisce in punti,
 * in percentuale o in sigma sullo spot di oggi, e l'interfaccia converte.
 * Il backtest riapplica quella percentuale allo spot di ogni finestra storica.
 */
export type AnalysisRequest = {
  symbol: string;
  days: number;
  bepLowPct: number;
  bepHighPct: number;
  sigmaSource: SigmaSource;
  sampling: SamplingKind;
  /** usato solo con sampling "weekday": 1 = lunedi ... 5 = venerdi */
  weekday: number;
  from?: string;
  to?: string;
};

export type SymbolMeta = {
  symbol: string;
  label: string;
  derived: boolean;
  bars: number;
  dataFrom: string;
  dataTo: string;
  /** ultimo close disponibile, usato come spot di riferimento */
  spot: number;
  spotDate: string;
  /** sigma annualizzato corrente per le due fonti; null se non disponibile */
  realizedVolAnnual: number | null;
  vixAnnual: number | null;
};

export type WorstRow = {
  entryDate: string;
  exitDate: string;
  s0: number;
  sT: number;
  retPct: number;
  breachPct: number;
  direction: "up" | "down";
  vixAnnual: number | null;
};

export type AnchorPayload = {
  anchor: AnchorMode;
  n: number;
  skipped: number;
  insideRate: number;
  breachUpRate: number;
  breachDownRate: number;
  neverTouchedRate: number;
  touchedRate: number;
  touchedButReturnedRate: number;
  breachAll: Distribution | null;
  breachUp: Distribution | null;
  breachDown: Distribution | null;
  margin: Distribution | null;
  excursionUp: Distribution | null;
  excursionDown: Distribution | null;
  avgRangeWidthPct: number;
  unreachableLowerCount: number;
  byYear: GroupStats[];
  byVix: GroupStats[];
  worst: WorstRow[];
};

export type AnalysisResponse = {
  meta: SymbolMeta;
  /** BEP di riferimento risolti sullo spot attuale, nelle tre rappresentazioni */
  reference: {
    lowPoints: number;
    highPoints: number;
    lowPct: number;
    highPct: number;
    lowSd: number;
    highSd: number;
    sigmaN: number;
    sigmaAnnual: number;
    sigmaSource: SigmaSource;
  };
  diagnostics: {
    totalWindows: number;
    firstEntry: string | null;
    lastEntry: string | null;
    effectiveIndependentWindows: number;
    exitsBeyondRange: number;
  };
  anchors: Record<AnchorMode, AnchorPayload>;
  /** distribuzione dei rendimenti a scadenza, indipendente dall'ancoraggio */
  histogram: HistogramBin[];
  returns: Distribution | null;
  curve: BreachCurvePoint[];
};

export const DEFAULT_REQUEST: AnalysisRequest = {
  symbol: "SPX",
  days: 5,
  bepLowPct: -0.012,
  bepHighPct: 0.012,
  sigmaSource: "realized",
  sampling: "overlapping",
  weekday: 1,
};

/** Un intervallo temporale da confrontare nell'analisi dei gap. */
export type PeriodSpec = {
  label: string;
  from?: string;
  to?: string;
};

export type GapRequest = {
  symbol: string;
  a: PeriodSpec;
  b: PeriodSpec;
  /** estremi delle classi in frazione di prezzo; l'ultima e' aperta verso l'alto */
  edges: number[];
};

/**
 * Periodi predefiniti per il confronto. Sono espressi in date assolute perche'
 * il confronto fra due archi temporali deve restare stabile nel tempo: un
 * "ultimi 5 anni" relativo renderebbe irriproducibile un risultato citato.
 */
export const GAP_PERIODS: PeriodSpec[] = [
  { label: "Tutta la storia" },
  { label: "Dal 2000", from: "2000-01-01" },
  { label: "1997–1999", from: "1997-01-01", to: "1999-12-31" },
  { label: "2000–2009", from: "2000-01-01", to: "2009-12-31" },
  { label: "2010–2019", from: "2010-01-01", to: "2019-12-31" },
  { label: "2020–2024", from: "2020-01-01", to: "2024-12-31" },
  { label: "Post crisi 2008", from: "2009-03-09" },
  { label: "Da inizio Covid", from: "2020-02-19" },
  { label: "Era Trump", from: "2025-01-20" },
];

export const DEFAULT_GAP_REQUEST: GapRequest = {
  symbol: "SPY",
  a: GAP_PERIODS[1],
  b: GAP_PERIODS[8],
  edges: [0, 0.001, 0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03],
};

export type SwingRequest = {
  symbol: string;
  from?: string;
  to?: string;
  /** come trattare le barre esterne, che formano entrambi gli estremi */
  outside: "flip" | "keep";
  /** direzione della fase da cui estrarre le date */
  signalDirection: "up" | "down";
  /** la fase deve raggiungere questo numero di barre con estremo */
  atCount: number;
  /** la fase opposta precedente deve averne raggiunte almeno tante; 0 = nessun vincolo */
  minPrevLegCount: number;
};

export const DEFAULT_SWING_REQUEST: SwingRequest = {
  symbol: "SPX",
  from: "2000-01-01",
  outside: "flip",
  signalDirection: "up",
  atCount: 4,
  minPrevLegCount: 4,
};

export type Preset = {
  id: string;
  label: string;
  hint?: string;
  /** null = dall'inizio dei dati */
  from: (dataFrom: string, dataTo: string) => string | undefined;
};

const yearsBefore = (iso: string, years: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

export const PRESETS: Preset[] = [
  { id: "all", label: "Tutta la storia", from: () => undefined },
  { id: "20y", label: "Ultimi 20 anni", from: (_f, t) => yearsBefore(t, 20) },
  { id: "10y", label: "Ultimi 10 anni", from: (_f, t) => yearsBefore(t, 10) },
  { id: "5y", label: "Ultimi 5 anni", from: (_f, t) => yearsBefore(t, 5) },
  { id: "3y", label: "Ultimi 3 anni", from: (_f, t) => yearsBefore(t, 3) },
  { id: "1y", label: "Ultimo anno", from: (_f, t) => yearsBefore(t, 1) },
  { id: "gfc", label: "Post crisi 2008", hint: "dal minimo del 9 marzo 2009", from: () => "2009-03-09" },
  { id: "covid", label: "Da inizio Covid", hint: "dal massimo pre-crollo del 19 febbraio 2020", from: () => "2020-02-19" },
  { id: "trump2", label: "Da insediamento Trump", hint: "dal 20 gennaio 2025", from: () => "2025-01-20" },
];

export const SAMPLING_LABELS: Record<SamplingKind, { label: string; hint: string }> = {
  overlapping: {
    label: "Sovrapposte",
    hint: "Una finestra per ogni giorno di borsa. Massimo dettaglio, ma finestre consecutive condividono N−1 giorni.",
  },
  disjoint: {
    label: "Non sovrapposte",
    hint: "Una finestra ogni N giorni. Molte meno osservazioni, ma statisticamente indipendenti.",
  },
  weekday: {
    label: "Giorno fisso",
    hint: "Solo ingressi in un giorno preciso della settimana, per replicare scadenze settimanali.",
  },
};

export const WEEKDAY_LABELS = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];

export const ANCHOR_LABELS: Record<AnchorMode, { label: string; hint: string }> = {
  pct: {
    label: "Percentuale",
    hint: "I BEP mantengono la stessa distanza percentuale dallo spot di ogni finestra. È l'ipotesi di riferimento.",
  },
  sigma: {
    label: "Sigma",
    hint: "I BEP mantengono la stessa distanza in deviazioni standard, ricalcolate su ogni finestra: in periodi volatili si allargano da soli.",
  },
};
