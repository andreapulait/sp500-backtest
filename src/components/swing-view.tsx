"use client";

import { useEffect, useRef, useState } from "react";

import { runSwingAnalysis, type SwingResponse } from "@/app/actions";
import { DEFAULT_SWING_REQUEST, type SwingRequest } from "@/lib/analysis";
import type { DirectionStats, Leg } from "@/lib/backtest/swings";
import type { SymbolInfo } from "@/lib/data";
import { count, pct, points as fmtPoints, shortDate } from "@/lib/format";

const UP = "var(--up)";
const DOWN = "var(--down)";

function Panel({
  title,
  note,
  children,
  right,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="label">{title}</span>
        {right}
      </div>
      {children}
      {note && <p className="mt-2 text-[11px] leading-snug text-[var(--faint)]">{note}</p>}
    </div>
  );
}

function DirectionTable({ s, tone }: { s: DirectionStats; tone: string }) {
  const maxReached = s.rows[0]?.reached ?? 1;

  return (
    <div>
      <div className="num mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
        <span>{count(s.legs)} fasi</span>
        <span>lunghezza mediana {s.medianCount}</span>
        <span>media {s.meanCount.toFixed(2).replace(".", ",")}</span>
        <span>massima {s.maxCount}</span>
        <span>escursione mediana {pct(s.medianMovePct, 2, true)}</span>
        <span>barre neutre mediane {s.medianNeutralBars}</span>
      </div>

      <table className="w-full text-[12px]">
        <thead>
          <tr className="label">
            <th className="pb-1 text-left font-normal">barre</th>
            <th className="pb-1 text-right font-normal">arrivate</th>
            <th className="pb-1 text-left font-normal" />
            <th className="pb-1 text-right font-normal">finite qui</th>
            <th className="pb-1 text-right font-normal">prosegue</th>
            <th className="pb-1 text-right font-normal">escurs. mediana</th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.count} className="border-t border-[var(--line)]">
              <td className="num py-1 pr-2">{r.count}</td>
              <td className="num py-1 text-right">{count(r.reached)}</td>
              <td className="py-1 pl-2 pr-3 w-[120px]">
                <span
                  className="block h-1.5 rounded-sm"
                  style={{
                    width: `${Math.max(1, (r.reached / maxReached) * 100)}%`,
                    background: tone,
                    opacity: 0.75,
                  }}
                />
              </td>
              <td className="num py-1 text-right text-[var(--muted)]">{pct(r.share, 1)}</td>
              <td
                className="num py-1 text-right"
                style={{ color: r.continuationRate >= 0.5 ? tone : "var(--text)" }}
              >
                {pct(r.continuationRate, 1)}
              </td>
              <td className="num py-1 text-right text-[var(--muted)]">{pct(r.medianMovePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegsTimeline({ legs }: { legs: Leg[] }) {
  return (
    <div className="max-h-[420px] overflow-y-auto">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-[var(--panel)]">
          <tr className="label">
            <th className="pb-1 text-left font-normal">fase</th>
            <th className="pb-1 text-left font-normal">dal</th>
            <th className="pb-1 text-left font-normal">al</th>
            <th className="pb-1 text-right font-normal">barre</th>
            <th className="pb-1 text-right font-normal">neutre</th>
            <th className="pb-1 text-right font-normal">escursione</th>
            <th className="pb-1 text-right font-normal">estremo</th>
          </tr>
        </thead>
        <tbody>
          {[...legs].reverse().map((l) => {
            const tone = l.direction === "up" ? UP : DOWN;
            return (
              <tr key={`${l.direction}-${l.startDate}`} className="border-t border-[var(--line)]">
                <td className="py-1 pr-2" style={{ color: tone }}>
                  {l.direction === "up" ? "↑ massimi" : "↓ minimi"}
                  {l.open && <span className="ml-1 text-[10px] text-[var(--warn)]">in corso</span>}
                </td>
                <td className="num py-1 whitespace-nowrap">{shortDate(l.startDate)}</td>
                <td className="num py-1 whitespace-nowrap text-[var(--muted)]">
                  {shortDate(l.endDate)}
                </td>
                <td className="num py-1 text-right font-medium">{l.count}</td>
                <td className="num py-1 text-right text-[var(--faint)]">{l.neutralBars}</td>
                <td className="num py-1 text-right" style={{ color: tone }}>
                  {pct(l.movePct, 2, true)}
                </td>
                <td className="num py-1 text-right text-[var(--muted)]">
                  {fmtPoints(l.extremePrice)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SwingView({ symbols }: { symbols: SymbolInfo[] }) {
  const [request, setRequest] = useState<SwingRequest>(DEFAULT_SWING_REQUEST);
  const [data, setData] = useState<SwingResponse | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    setPending(true);

    const timer = setTimeout(() => {
      runSwingAnalysis(request)
        .then((res) => {
          if (seq.current !== id) return;
          setData(res);
          setError(null);
        })
        .catch((e: unknown) => {
          if (seq.current !== id) return;
          setError(e instanceof Error ? e.message : "Errore imprevisto");
        })
        .finally(() => {
          if (seq.current === id) setPending(false);
        });
    }, 200);

    return () => clearTimeout(timer);
  }, [request]);

  const patch = (p: Partial<SwingRequest>) => setRequest((r) => ({ ...r, ...p }));

  const signalsText = data?.signals.join(",") ?? "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(signalsText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // in mancanza di permessi la textarea resta selezionabile a mano
    }
  };

  const dirLabel = request.signalDirection === "up" ? "massimi" : "minimi";
  const oppLabel = request.signalDirection === "up" ? "minimi" : "massimi";

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-4">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[13px] text-[var(--muted)]">
          Fasi alternate: quante barre consecutive formano nuovi massimi prima che intervenga un
          nuovo minimo, e viceversa
        </h1>
        <span className="num text-[11px] text-[var(--faint)]">
          {pending ? "calcolo…" : data ? `${count(data.totalLegs)} fasi` : ""}
        </span>
      </header>

      <div className="mb-3 grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="panel divide-y divide-[var(--line)]">
          <div className="px-3 py-3">
            <div className="label mb-2">Serie</div>
            <select
              className="field"
              value={request.symbol}
              onChange={(e) => patch({ symbol: e.target.value })}
            >
              {symbols.map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {s.symbol} — {s.label}
                </option>
              ))}
            </select>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <label className="block">
                <span className="label">da</span>
                <input
                  type="date"
                  className="field mt-0.5"
                  value={request.from ?? ""}
                  onChange={(e) => patch({ from: e.target.value || undefined })}
                />
              </label>
              <label className="block">
                <span className="label">a</span>
                <input
                  type="date"
                  className="field mt-0.5"
                  value={request.to ?? ""}
                  onChange={(e) => patch({ to: e.target.value || undefined })}
                />
              </label>
            </div>
          </div>

          <div className="px-3 py-3">
            <div className="label mb-2">Barre esterne</div>
            <div className="seg">
              <button
                data-on={request.outside === "flip"}
                onClick={() => patch({ outside: "flip" })}
                title="Una barra che forma entrambi gli estremi chiude la fase in corso"
              >
                Ribaltano
              </button>
              <button
                data-on={request.outside === "keep"}
                onClick={() => patch({ outside: "keep" })}
                title="Una barra che forma entrambi gli estremi prosegue la fase in corso"
              >
                Proseguono
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-[var(--faint)]">
              Una barra esterna supera sia il massimo sia il minimo della precedente. «Ribaltano» è
              la lettura letterale: la fase termina appena interviene un nuovo minimo.
            </p>
          </div>

          <div className="px-3 py-3">
            <div className="label mb-2">Estrazione date</div>
            <div className="seg mb-2">
              <button
                data-on={request.signalDirection === "up"}
                onClick={() => patch({ signalDirection: "up" })}
              >
                Fase di massimi
              </button>
              <button
                data-on={request.signalDirection === "down"}
                onClick={() => patch({ signalDirection: "down" })}
              >
                Fase di minimi
              </button>
            </div>

            <label className="mb-2 block">
              <span className="label">alla barra n°</span>
              <input
                type="number"
                min={1}
                max={30}
                className="field mt-0.5 text-right"
                value={request.atCount}
                onChange={(e) => patch({ atCount: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>

            <label className="block">
              <span className="label">fase opposta precedente ≥</span>
              <input
                type="number"
                min={0}
                max={30}
                className="field mt-0.5 text-right"
                value={request.minPrevLegCount}
                onChange={(e) =>
                  patch({ minPrevLegCount: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </label>
            <p className="mt-1.5 text-[11px] leading-snug text-[var(--faint)]">
              0 rimuove il vincolo. Con {request.atCount} e {request.minPrevLegCount} ottieni la
              barra n° {request.atCount} di una fase di {dirLabel} preceduta da una fase di{" "}
              {oppLabel} di almeno {request.minPrevLegCount} barre.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {error && (
            <div className="panel px-4 py-3 text-[12px]" style={{ color: "var(--up)" }}>
              {error}
            </div>
          )}

          {!data ? (
            <div className="panel px-4 py-10 text-center text-[var(--muted)]">Calcolo in corso…</div>
          ) : (
            <div className={pending ? "space-y-3 opacity-60" : "space-y-3"}>
              <Panel
                title={`Date estratte — ${count(data.signals.length)} occorrenze`}
                right={
                  <button
                    className="rounded border border-[var(--line)] px-2.5 py-1 text-[11px] hover:bg-[var(--panel-alt)]"
                    onClick={copy}
                    disabled={data.signals.length === 0}
                  >
                    {copied ? "Copiate" : "Copia"}
                  </button>
                }
                note="Formato ISO separato da virgola, pronto da incollare."
              >
                <textarea
                  readOnly
                  className="field h-24 resize-y leading-relaxed"
                  value={signalsText}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </Panel>

              <div className="grid gap-3 xl:grid-cols-2">
                <Panel
                  title="Fasi di massimi"
                  note="«prosegue» è la probabilità storica che una fase arrivata a quel numero di barre ne aggiunga almeno un'altra."
                >
                  <DirectionTable s={data.up} tone={UP} />
                </Panel>
                <Panel title="Fasi di minimi">
                  <DirectionTable s={data.down} tone={DOWN} />
                </Panel>
              </div>

              <Panel
                title="Ultime fasi"
                note="Le fasi più recenti in ordine inverso. L'ultima resta «in corso» finché non interviene l'estremo opposto, quindi la sua lunghezza non è definitiva ed è esclusa dalle statistiche."
              >
                <LegsTimeline legs={data.recentLegs} />
              </Panel>

              <details className="panel px-4 py-3 text-[12px] leading-relaxed text-[var(--muted)]">
                <summary className="label cursor-pointer">Note metodologiche</summary>
                <ul className="mt-2 list-disc space-y-1.5 pl-4">
                  <li>
                    Massimo: <span className="num">high &gt; high precedente</span>. Minimo:{" "}
                    <span className="num">low &lt; low precedente</span>. Confronti stretti.
                  </li>
                  <li>
                    Le barre interne — che non superano né il massimo né il minimo precedente — non
                    contano e <strong>non interrompono</strong> la fase.
                  </li>
                  <li>
                    L&apos;escursione di una fase è misurata dalla chiusura della barra precedente
                    al suo avvio fino alla chiusura dell&apos;ultima barra con estremo.
                  </li>
                  <li>
                    Le fasi ancora aperte sono escluse dalle statistiche: contarle
                    sottostimerebbe le lunghezze, perché una fase in corso può ancora allungarsi.
                  </li>
                  <li>
                    High e low sono calcolati in continuo durante la seduta, quindi affidabili su
                    tutta la storia dell&apos;indice: il problema dell&apos;apertura che affligge
                    l&apos;analisi dei gap non tocca questa.
                  </li>
                </ul>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
