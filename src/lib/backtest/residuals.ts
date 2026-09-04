import type { Series } from "./types";
import type { Leg, LegDirection } from "./swings";
import { describe, type Distribution } from "./stats";

/**
 * Escursione residua: una volta formato l'N-esimo estremo consecutivo, quanto
 * si muove ancora il prezzo prima della fine della fase, e in quanto tempo.
 *
 * Il punto di osservazione e' la CHIUSURA della barra che forma l'N-esimo
 * estremo, perche' e' il momento in cui si potrebbe effettivamente agire.
 *
 * Nota metodologica decisiva: entrano nel campione anche le fasi che si
 * fermano esattamente a N. Escluderle condizionerebbe il calcolo alla
 * prosecuzione e gonfierebbe sistematicamente il residuo, facendo sembrare che
 * ci sia sempre altra strada davanti quando in quasi meta' dei casi non ce n'e'.
 */
export type ResidualSample = {
  legStart: string;
  /** data della barra che forma l'N-esimo estremo */
  observed: string;
  /** data della barra in cui la fase tocca il suo estremo */
  topDate: string;
  refClose: number;
  topPrice: number;
  residualPct: number;
  /** estremi ancora da formare: 0 significa che la fase finisce qui */
  residualExtremeBars: number;
  /** sedute di borsa fino al top, barre neutre incluse */
  residualSessions: number;
};

export type ResidualBucket = {
  /** quanti altri estremi si sono formati dopo quello osservato */
  residualExtremeBars: number;
  n: number;
  share: number;
  residualPct: Distribution | null;
  residualSessions: Distribution | null;
  /** occorrenze piu' recenti, per l'ispezione puntuale */
  samples: ResidualSample[];
};

export type ResidualRow = {
  /** estremi consecutivi gia' formati al momento dell'osservazione */
  atCount: number;
  n: number;
  residualPct: Distribution | null;
  residualSessions: Distribution | null;
  residualExtremeBars: Distribution | null;
  /** velocita' del movimento residuo, in punti percentuali per seduta */
  medianSpeedPct: number;
  /** quota di casi in cui il residuo, in valore assoluto, supera la soglia */
  thresholds: { level: number; share: number }[];
  buckets: ResidualBucket[];
};

export const RESIDUAL_THRESHOLDS = [0.005, 0.01, 0.02, 0.03];

const SAMPLES_PER_BUCKET = 10;

function collect(
  series: Series,
  legs: Leg[],
  direction: LegDirection,
  atCount: number
): ResidualSample[] {
  const out: ResidualSample[] = [];

  for (const leg of legs) {
    // le fasi ancora aperte non hanno un top definitivo: il residuo misurato
    // sarebbe troncato dalla fine dei dati, non dal mercato
    if (leg.direction !== direction || leg.open || leg.count < atCount) continue;

    const i = leg.extremeIndices[atCount - 1];
    const refClose = series.c[i];
    if (!(refClose > 0)) continue;

    out.push({
      legStart: leg.startDate,
      observed: series.date[i],
      topDate: leg.endDate,
      refClose,
      topPrice: leg.extremePrice,
      residualPct: leg.extremePrice / refClose - 1,
      residualExtremeBars: leg.count - atCount,
      residualSessions: leg.endIndex - i,
    });
  }

  return out;
}

function bucketize(samples: ResidualSample[]): ResidualBucket[] {
  const groups = new Map<number, ResidualSample[]>();
  for (const s of samples) {
    const list = groups.get(s.residualExtremeBars);
    if (list) list.push(s);
    else groups.set(s.residualExtremeBars, [s]);
  }

  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([residualExtremeBars, list]) => ({
      residualExtremeBars,
      n: list.length,
      share: list.length / samples.length,
      residualPct: describe(list.map((s) => s.residualPct)),
      residualSessions: describe(list.map((s) => s.residualSessions)),
      samples: [...list]
        .sort((a, b) => (a.observed < b.observed ? 1 : -1))
        .slice(0, SAMPLES_PER_BUCKET),
    }));
}

export function buildResidualRows(
  series: Series,
  legs: Leg[],
  direction: LegDirection,
  maxCount = 12
): ResidualRow[] {
  const closed = legs.filter((l) => l.direction === direction && !l.open);
  const longest = closed.reduce((m, l) => Math.max(m, l.count), 0);
  const limit = Math.min(maxCount, longest);

  const rows: ResidualRow[] = [];

  for (let atCount = 1; atCount <= limit; atCount++) {
    const samples = collect(series, closed, direction, atCount);
    if (samples.length === 0) continue;

    const abs = samples.map((s) => Math.abs(s.residualPct));
    const pctDist = describe(samples.map((s) => s.residualPct));
    const sessionDist = describe(samples.map((s) => s.residualSessions));

    // la velocita' si calcola sul singolo caso e poi se ne prende la mediana:
    // dividere la mediana del residuo per quella del tempo darebbe un numero
    // che non corrisponde ad alcuna osservazione reale
    const speeds = samples
      .filter((s) => s.residualSessions > 0)
      .map((s) => Math.abs(s.residualPct) / s.residualSessions)
      .sort((a, b) => a - b);

    rows.push({
      atCount,
      n: samples.length,
      residualPct: pctDist,
      residualSessions: sessionDist,
      residualExtremeBars: describe(samples.map((s) => s.residualExtremeBars)),
      medianSpeedPct: speeds.length > 0 ? speeds[Math.floor(speeds.length / 2)] : 0,
      thresholds: RESIDUAL_THRESHOLDS.map((level) => ({
        level,
        share: abs.filter((v) => v > level).length / samples.length,
      })),
      buckets: bucketize(samples),
    });
  }

  return rows;
}
