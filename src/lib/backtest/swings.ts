import type { Series } from "./types";
import { indexAtOrAfter, indexAtOrBefore } from "./series";
import { quantile } from "./stats";

export type LegDirection = "up" | "down";

/**
 * Come trattare le barre esterne, che formano contemporaneamente un nuovo
 * massimo e un nuovo minimo.
 * - "flip": ribaltano la fase, lettura letterale della regola ("la fase
 *   termina quando interviene una barra che forma nuovi minimi")
 * - "keep": proseguono la fase in corso, che si ribalta solo su una barra
 *   che forma il nuovo estremo opposto senza formare quello corrente
 */
export type OutsideMode = "flip" | "keep";

export type Leg = {
  direction: LegDirection;
  /** prima barra della fase, cioe' quella che l'ha aperta formando un estremo */
  startIndex: number;
  /** ultima barra che ha formato un estremo in questa fase */
  endIndex: number;
  startDate: string;
  endDate: string;
  /** quante barre hanno effettivamente formato un nuovo estremo */
  count: number;
  /** date di quelle barre, in ordine */
  extremeDates: string[];
  /** barre interne che non hanno formato alcun estremo e non hanno chiuso la fase */
  neutralBars: number;
  /** chiusura della barra precedente all'avvio: riferimento per l'escursione */
  startRef: number;
  /** chiusura dell'ultima barra con estremo */
  endPrice: number;
  movePct: number;
  /** massimo (fase up) o minimo (fase down) toccato nella fase */
  extremePrice: number;
  extremeMovePct: number;
  /** true se la fase e' ancora aperta alla fine dei dati */
  open: boolean;
};

type Bar = { isHigh: boolean; isLow: boolean };

const classify = (series: Series, i: number): Bar => ({
  isHigh: series.h[i] > series.h[i - 1],
  isLow: series.l[i] < series.l[i - 1],
});

/**
 * Segmenta la serie in fasi alternate.
 *
 * Una fase rialzista conta le barre che formano nuovi massimi e termina quando
 * interviene una barra che forma nuovi minimi; da li' parte la fase ribassista,
 * e cosi' via. Le barre interne — che non superano ne' il massimo ne' il minimo
 * precedente — non contano e non interrompono la fase.
 */
export function buildLegs(
  series: Series,
  opts: { from?: string; to?: string; outside?: OutsideMode } = {}
): Leg[] {
  const outside = opts.outside ?? "flip";
  const first = Math.max(1, indexAtOrAfter(series.date, opts.from));
  const last = indexAtOrBefore(series.date, opts.to);
  if (last <= first) return [];

  const legs: Leg[] = [];
  let current: Leg | null = null;

  const openLeg = (direction: LegDirection, i: number): Leg => ({
    direction,
    startIndex: i,
    endIndex: i,
    startDate: series.date[i],
    endDate: series.date[i],
    count: 1,
    extremeDates: [series.date[i]],
    neutralBars: 0,
    startRef: series.c[i - 1],
    endPrice: series.c[i],
    movePct: series.c[i] / series.c[i - 1] - 1,
    extremePrice: direction === "up" ? series.h[i] : series.l[i],
    extremeMovePct: 0,
    open: true,
  });

  const extend = (leg: Leg, i: number) => {
    leg.count++;
    leg.endIndex = i;
    leg.endDate = series.date[i];
    leg.extremeDates.push(series.date[i]);
    leg.endPrice = series.c[i];
    leg.movePct = series.c[i] / leg.startRef - 1;
    leg.extremePrice =
      leg.direction === "up"
        ? Math.max(leg.extremePrice, series.h[i])
        : Math.min(leg.extremePrice, series.l[i]);
  };

  const finish = (leg: Leg) => {
    leg.extremeMovePct = leg.extremePrice / leg.startRef - 1;
    leg.open = false;
    legs.push(leg);
  };

  for (let i = first; i <= last; i++) {
    const { isHigh, isLow } = classify(series, i);

    if (!current) {
      // la prima fase si apre sulla prima barra che forma un estremo solo
      if (isHigh && !isLow) current = openLeg("up", i);
      else if (isLow && !isHigh) current = openLeg("down", i);
      continue;
    }

    const opposite = current.direction === "up" ? isLow : isHigh;
    const same = current.direction === "up" ? isHigh : isLow;
    // in modalita' "keep" una barra esterna prosegue la fase invece di ribaltarla
    const flips = opposite && (outside === "flip" || !same);

    if (flips) {
      finish(current);
      current = openLeg(current.direction === "up" ? "down" : "up", i);
    } else if (same) {
      extend(current, i);
    } else {
      current.neutralBars++;
    }
  }

  if (current) {
    current.extremeMovePct = current.extremePrice / current.startRef - 1;
    legs.push(current); // resta open: la fase non si e' ancora ribaltata
  }

  return legs;
}

export type LegCountRow = {
  count: number;
  /** fasi che si sono fermate esattamente a questo numero di barre */
  ended: number;
  /** fasi che hanno raggiunto almeno questo numero */
  reached: number;
  /** quota sul totale delle fasi */
  share: number;
  /**
   * Probabilita' storica che una fase arrivata a `count` prosegua di almeno
   * un'altra barra. E' la lettura che serve operativamente: dato che siamo al
   * quarto massimo, quante volte ne e' arrivato un quinto.
   */
  continuationRate: number;
  /** escursione mediana dall'avvio della fase, per le fasi che arrivano qui */
  medianMovePct: number;
};

export type DirectionStats = {
  direction: LegDirection;
  legs: number;
  meanCount: number;
  medianCount: number;
  maxCount: number;
  meanMovePct: number;
  medianMovePct: number;
  medianNeutralBars: number;
  rows: LegCountRow[];
};

export function summarizeDirection(all: Leg[], direction: LegDirection): DirectionStats {
  // le fasi ancora aperte non hanno una lunghezza definitiva: escluderle evita
  // di contare come "terminata a 3" una fase che domani arriverebbe a 5
  const legs = all.filter((l) => l.direction === direction && !l.open);
  const n = legs.length;
  const counts = legs.map((l) => l.count).sort((a, b) => a - b);
  const maxCount = n > 0 ? counts[n - 1] : 0;

  const rows: LegCountRow[] = [];
  for (let c = 1; c <= maxCount; c++) {
    const reachedLegs = legs.filter((l) => l.count >= c);
    const reached = reachedLegs.length;
    const ended = legs.filter((l) => l.count === c).length;
    const next = legs.filter((l) => l.count >= c + 1).length;

    rows.push({
      count: c,
      ended,
      reached,
      share: n > 0 ? ended / n : 0,
      continuationRate: reached > 0 ? next / reached : 0,
      medianMovePct: quantile(
        reachedLegs.map((l) => Math.abs(l.movePct)).sort((a, b) => a - b),
        0.5
      ),
    });
  }

  const moves = legs.map((l) => l.movePct).sort((a, b) => a - b);
  const neutrals = legs.map((l) => l.neutralBars).sort((a, b) => a - b);

  return {
    direction,
    legs: n,
    meanCount: n > 0 ? counts.reduce((a, b) => a + b, 0) / n : 0,
    medianCount: quantile(counts, 0.5),
    maxCount,
    meanMovePct: n > 0 ? moves.reduce((a, b) => a + b, 0) / n : 0,
    medianMovePct: quantile(moves, 0.5),
    medianNeutralBars: quantile(neutrals, 0.5),
    rows,
  };
}

export type SignalOptions = {
  direction: LegDirection;
  /** la fase deve raggiungere esattamente questo numero di barre con estremo */
  atCount: number;
  /** la fase opposta immediatamente precedente deve aver raggiunto almeno tanto */
  minPrevLegCount: number;
};

/**
 * Date delle barre in cui una fase raggiunge il conteggio richiesto, con la
 * condizione sulla fase opposta precedente. Generalizza la regola "quarto
 * massimo dopo una serie di quattro minimi".
 */
export function extractSignals(legs: Leg[], opts: SignalOptions): string[] {
  const { direction, atCount, minPrevLegCount } = opts;
  const out: string[] = [];

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (leg.direction !== direction || leg.count < atCount) continue;

    if (minPrevLegCount > 0) {
      const prev = legs[i - 1];
      if (!prev || prev.direction === direction || prev.count < minPrevLegCount) continue;
    }

    out.push(leg.extremeDates[atCount - 1]);
  }

  return out;
}
