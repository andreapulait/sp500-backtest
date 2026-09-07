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
  /** indici di serie delle stesse barre: servono a misurare i residui */
  extremeIndices: number[];
  /** barre interne che non hanno formato alcun estremo e non hanno chiuso la fase */
  neutralBars: number;
  /** barre che hanno formato l'estremo contrario senza pero' chiudere la fase */
  oppositeBars: number;
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
export type BuildLegsOptions = {
  from?: string;
  to?: string;
  outside?: OutsideMode;
  /**
   * Minimi consecutivi necessari per chiudere una fase rialzista, e massimi
   * consecutivi per chiudere una ribassista.
   *
   * Con 1 e 1 la fase termina al primo estremo contrario: e' la regola stretta.
   * Alzandoli la fase sopravvive ai ritracciamenti isolati, avvicinandosi agli
   * swing di ampio respiro. Il conteggio e' consecutivo, non cumulativo: una
   * soglia cumulativa chiuderebbe da sola qualunque salita abbastanza lunga,
   * accumulando giornate storte sparse, e non misurerebbe piu' la struttura.
   */
  closeUpAfter?: number;
  closeDownAfter?: number;
};

export function buildLegs(series: Series, opts: BuildLegsOptions = {}): Leg[] {
  const outside = opts.outside ?? "flip";
  const closeUpAfter = Math.max(1, Math.round(opts.closeUpAfter ?? 1));
  const closeDownAfter = Math.max(1, Math.round(opts.closeDownAfter ?? 1));
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
    extremeIndices: [i],
    neutralBars: 0,
    oppositeBars: 0,
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
    leg.extremeIndices.push(i);
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

  /**
   * Apre la fase opposta partendo dal primo estremo della sequenza che l'ha
   * innescata: quelle barre appartengono gia' al nuovo movimento, non alla
   * fase appena chiusa.
   */
  const openFromStreak = (direction: LegDirection, streak: number[]): Leg => {
    const leg = openLeg(direction, streak[0]);
    for (const j of streak.slice(1)) extend(leg, j);
    return leg;
  };

  // estremi contrari consecutivi accumulati contro la fase in corso
  let streak: number[] = [];

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
    // in modalita' "keep" una barra esterna prosegue la fase invece di contrastarla
    const counts = opposite && (outside === "flip" || !same);
    const needed = current.direction === "up" ? closeUpAfter : closeDownAfter;

    if (counts) {
      streak.push(i);
      if (streak.length >= needed) {
        finish(current);
        // le barre della sequenza appartengono alla nuova fase, non alla vecchia
        current = openFromStreak(current.direction === "up" ? "down" : "up", streak);
        streak = [];
      }
      continue;
    }

    // qualunque barra non contraria spezza la sequenza: la soglia e' consecutiva
    current.oppositeBars += streak.length;
    streak = [];

    if (same) extend(current, i);
    else current.neutralBars++;
  }

  if (current) current.oppositeBars += streak.length;

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
  /**
   * Intervallo di Wilson al 95% sul tasso di prosecuzione. Serve a non leggere
   * come segnale quello che e' rumore: alle lunghezze rare il campione scende a
   * poche unita' e il tasso puntuale diventa privo di significato.
   */
  continuationLow: number;
  continuationHigh: number;
  /** escursione mediana dall'avvio della fase, per le fasi che arrivano qui */
  medianMovePct: number;
};

/**
 * Intervallo di confidenza di Wilson per una proporzione.
 * Preferito a quello normale perche' resta sensato con campioni piccoli e con
 * proporzioni vicine a 0 o a 1, che qui sono la norma nelle code.
 */
export function wilsonInterval(successes: number, trials: number, z = 1.96): [number, number] {
  if (trials <= 0) return [0, 0];

  const p = successes / trials;
  const z2 = z * z;
  const denom = trials + z2;
  const center = (successes + z2 / 2) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p) * trials) + z2 / 4);

  return [Math.max(0, center - half), Math.min(1, center + half)];
}

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

    const [low, high] = wilsonInterval(next, reached);

    rows.push({
      count: c,
      ended,
      reached,
      share: n > 0 ? ended / n : 0,
      continuationRate: reached > 0 ? next / reached : 0,
      continuationLow: low,
      continuationHigh: high,
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
