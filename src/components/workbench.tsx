"use client";

import { useEffect, useRef, useState } from "react";

import { runAnalysis } from "@/app/actions";
import {
  DEFAULT_REQUEST,
  type AnalysisRequest,
  type AnalysisResponse,
  type SymbolMeta,
} from "@/lib/analysis";
import { TRADING_DAYS_PER_YEAR } from "@/lib/backtest/series";
import type { SymbolInfo } from "@/lib/data";
import { count } from "@/lib/format";

import { fromSearchParams } from "@/lib/strategies";

import { ParamsPanel } from "./params-panel";
import { ResultsView } from "./results-view";
import { StrategyBar } from "./strategy-bar";

export function Workbench({
  symbols,
  initialMeta,
}: {
  symbols: SymbolInfo[];
  initialMeta: SymbolMeta;
}) {
  const [request, setRequest] = useState<AnalysisRequest>({
    ...DEFAULT_REQUEST,
    from: "2006-01-01",
  });
  const [symmetric, setSymmetric] = useState(true);
  const [meta, setMeta] = useState<SymbolMeta>(initialMeta);
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Ignora le risposte di richieste ormai superate da una piu' recente. */
  const seq = useRef(0);

  // I parametri in query string vanno applicati dopo l'idratazione: leggerli
  // durante il primo render darebbe markup diverso da quello prodotto sul server.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if ([...params.keys()].length === 0) return;
    setRequest((r) => {
      const next = fromSearchParams(params, r);
      setSymmetric(Math.abs(next.bepLowPct + next.bepHighPct) < 1e-9);
      return next;
    });
  }, []);

  useEffect(() => {
    const id = ++seq.current;
    setPending(true);

    const timer = setTimeout(() => {
      runAnalysis(request)
        .then((res) => {
          if (seq.current !== id) return;
          setData(res);
          setMeta(res.meta);
          setError(null);
        })
        .catch((e: unknown) => {
          if (seq.current !== id) return;
          setError(e instanceof Error ? e.message : "Errore imprevisto");
        })
        .finally(() => {
          if (seq.current === id) setPending(false);
        });
    }, 220);

    return () => clearTimeout(timer);
  }, [request]);

  const sigmaAnnual =
    (request.sigmaSource === "vix" ? meta.vixAnnual : meta.realizedVolAnnual) ??
    meta.realizedVolAnnual ??
    0.15;
  const sigmaN = sigmaAnnual * Math.sqrt(request.days / TRADING_DAYS_PER_YEAR);

  const patch = (p: Partial<AnalysisRequest>) => setRequest((r) => ({ ...r, ...p }));

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-4">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[13px] text-[var(--muted)]">
          Quanto spesso il sottostante è rimasto entro i tuoi break-even, e di quanto li ha superati
        </h1>
        <span className="num text-[11px] text-[var(--faint)]">
          {pending ? "calcolo…" : data ? `${count(data.diagnostics.totalWindows)} finestre` : ""}
        </span>
      </header>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <ParamsPanel
            request={request}
            meta={meta}
            symbols={symbols}
            sigmaN={sigmaN}
            symmetric={symmetric}
            onSymmetricChange={setSymmetric}
            onChange={patch}
          />
        </aside>

        <main className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <StrategyBar
            request={request}
            onLoad={(r) => {
              setRequest(r);
              setSymmetric(Math.abs(r.bepLowPct + r.bepHighPct) < 1e-9);
            }}
          />

          {error && (
            <div className="panel mb-3 border-[var(--up)] px-4 py-3 text-[12px]" style={{ color: "var(--up)" }}>
              {error}
            </div>
          )}

          {data ? (
            <>
              {data.diagnostics.totalWindows > data.diagnostics.effectiveIndependentWindows && (
                <div className="panel mb-3 px-4 py-2.5 text-[11px] leading-snug text-[var(--muted)]">
                  Le finestre sono <strong>sovrapposte</strong>: due ingressi consecutivi
                  condividono {request.days - 1} giorni su {request.days}, quindi le{" "}
                  {count(data.diagnostics.totalWindows)} osservazioni non sono indipendenti. Il
                  contenuto informativo equivale a circa{" "}
                  <strong>{count(data.diagnostics.effectiveIndependentWindows)}</strong> prove
                  distinte: leggi le percentuali come stime, non come frequenze con quella
                  precisione. Per un campione pulito passa a «non sovrapposte».
                </div>
              )}
              <ResultsView data={data} />
            </>
          ) : (
            <div className="panel px-4 py-10 text-center text-[var(--muted)]">
              Calcolo del backtest in corso…
            </div>
          )}

          <details className="panel mt-4 px-4 py-3 text-[12px] leading-relaxed text-[var(--muted)]">
            <summary className="label cursor-pointer">Note metodologiche</summary>
            <ul className="mt-2 list-disc space-y-1.5 pl-4">
              <li>
                Si entra al <strong>close</strong> del giorno t e si scade al close del giorno t+N.
                Il percorso considerato per tocchi ed escursioni va da t+1 a t+N: l&apos;escursione
                intraday del giorno d&apos;ingresso è già avvenuta quando si apre la posizione.
              </li>
              <li>
                I BEP sono espressi come <strong>distanza percentuale dallo spot di oggi</strong> e
                riapplicati come tale allo spot di ogni finestra storica. L&apos;ancoraggio a sigma
                li riscala invece con la volatilità del periodo.
              </li>
              <li>
                Il conteggio in sigma usa il rendimento logaritmico, perché è di rendimenti
                logaritmici che sigma è la deviazione standard.
              </li>
              <li>
                Volatilità realizzata: deviazione standard campionaria dei rendimenti logaritmici a
                30 giorni di borsa, annualizzata per √252 e scalata sulla durata per √(N/252).
              </li>
              <li>
                Il VIX non viene riportato in avanti sulle date mancanti, per non usare la
                volatilità di ieri proprio nei giorni turbolenti in cui il dato manca.
              </li>
              <li>
                L&apos;analisi è <strong>geometrica sul sottostante</strong>: non modella premio,
                greche, dividendi, slippage né assegnazione anticipata. Dice dove è finito il
                prezzo, non quanto avresti guadagnato.
              </li>
              <li>
                Dati: Yahoo Finance, close non rettificati per dividendi. XSP è derivato come
                SPX/10, perché la serie nativa parte solo dal 2021.
              </li>
            </ul>
          </details>
        </main>
      </div>
    </div>
  );
}
