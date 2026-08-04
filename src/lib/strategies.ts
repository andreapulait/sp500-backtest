import type { AnalysisRequest } from "./analysis";

export type SavedStrategy = {
  id: string;
  name: string;
  savedAt: string;
  request: AnalysisRequest;
};

const KEY = "sp500-backtest.strategies.v1";

/**
 * Persistenza locale delle strategie.
 *
 * localStorage e non un database: i parametri sono pochi byte, restano sul
 * dispositivo e non richiedono autenticazione. Se in futuro servira'
 * condividerle tra dispositivi, questo modulo e' l'unico punto da riscrivere.
 */
export function loadStrategies(): SavedStrategy[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedStrategy[]) : [];
  } catch {
    // storage corrotto o disabilitato: meglio partire da zero che bloccare l'app
    return [];
  }
}

function persist(list: SavedStrategy[]): SavedStrategy[] {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      // quota esaurita o modalita' privata: la sessione corrente resta valida
    }
  }
  return list;
}

export function saveStrategy(name: string, request: AnalysisRequest): SavedStrategy[] {
  const entry: SavedStrategy = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || "Senza nome",
    savedAt: new Date().toISOString(),
    request,
  };
  return persist([entry, ...loadStrategies()]);
}

export function deleteStrategy(id: string): SavedStrategy[] {
  return persist(loadStrategies().filter((s) => s.id !== id));
}

/** Etichetta compatta per la lista: "SPX · 5g · ±1,20%" */
export function describeRequest(r: AnalysisRequest): string {
  const symmetric = Math.abs(r.bepLowPct + r.bepHighPct) < 1e-9;
  const fmt = (v: number) => `${(v * 100).toFixed(2).replace(".", ",")}%`;
  const bep = symmetric
    ? `±${fmt(Math.abs(r.bepHighPct))}`
    : `${fmt(r.bepLowPct)} / ${fmt(r.bepHighPct)}`;
  return `${r.symbol} · ${r.days}g · ${bep}`;
}

/** Serializza i parametri nella query string, per condividere un link. */
export function toSearchParams(r: AnalysisRequest): string {
  const p = new URLSearchParams({
    s: r.symbol,
    d: String(r.days),
    lo: r.bepLowPct.toFixed(6),
    hi: r.bepHighPct.toFixed(6),
    sig: r.sigmaSource,
    smp: r.sampling,
  });
  if (r.sampling === "weekday") p.set("wd", String(r.weekday));
  if (r.from) p.set("from", r.from);
  if (r.to) p.set("to", r.to);
  return p.toString();
}

export function fromSearchParams(
  p: URLSearchParams,
  fallback: AnalysisRequest
): AnalysisRequest {
  const num = (key: string, def: number) => {
    const v = Number(p.get(key));
    return Number.isFinite(v) && p.has(key) ? v : def;
  };

  const sampling = p.get("smp");
  const sigma = p.get("sig");

  return {
    symbol: p.get("s") ?? fallback.symbol,
    days: Math.max(1, Math.round(num("d", fallback.days))),
    bepLowPct: num("lo", fallback.bepLowPct),
    bepHighPct: num("hi", fallback.bepHighPct),
    sigmaSource: sigma === "vix" || sigma === "realized" ? sigma : fallback.sigmaSource,
    sampling:
      sampling === "disjoint" || sampling === "weekday" || sampling === "overlapping"
        ? sampling
        : fallback.sampling,
    weekday: Math.min(6, Math.max(0, Math.round(num("wd", fallback.weekday)))),
    from: p.get("from") ?? fallback.from,
    to: p.get("to") ?? undefined,
  };
}
