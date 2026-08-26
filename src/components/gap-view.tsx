"use client";

import { useEffect, useRef, useState } from "react";

import { runGapAnalysis, type GapResponse } from "@/app/actions";
import {
  DEFAULT_GAP_REQUEST,
  GAP_PERIODS,
  type GapRequest,
  type PeriodSpec,
} from "@/lib/analysis";
import type { GapBucket, GapPeriodStats } from "@/lib/backtest/gaps";
import type { SymbolInfo } from "@/lib/data";
import { count, pct, points as fmtPoints, shortDate } from "@/lib/format";

const TONE_A = "var(--accent)";
const TONE_B = "var(--up)";

/** Etichetta leggibile di una classe: "0,5 – 0,75%" oppure "oltre 3%". */
function bucketLabel(b: GapBucket): string {
  const f = (v: number) => (v * 100).toFixed(2).replace(".", ",").replace(/,?0+$/, "");
  if (b.to == null) return `oltre ${f(b.from)}%`;
  if (b.from === 0) return `fino a ${f(b.to)}%`;
  return `${f(b.from)} – ${f(b.to)}%`;
}

function PeriodPicker({
  title,
  tone,
  value,
  dataFrom,
  dataTo,
  onChange,
}: {
  title: string;
  tone: string;
  value: PeriodSpec;
  dataFrom: string;
  dataTo: string;
  onChange: (p: PeriodSpec) => void;
}) {
  const matched = GAP_PERIODS.find(
    (p) => p.from === value.from && p.to === value.to
  );

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: tone }} />
        <span className="label">{title}</span>
      </div>

      <select
        className="field"
        value={matched?.label ?? "__custom"}
        onChange={(e) => {
          const p = GAP_PERIODS.find((x) => x.label === e.target.value);
          if (p) onChange(p);
        }}
      >
        {GAP_PERIODS.map((p) => (
          <option key={p.label} value={p.label}>
            {p.label}
          </option>
        ))}
        <option value="__custom">Personalizzato</option>
      </select>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <label className="block">
          <span className="label">da</span>
          <input
            type="date"
            className="field mt-0.5"
            min={dataFrom}
            max={dataTo}
            value={value.from ?? ""}
            onChange={(e) =>
              onChange({ label: "Personalizzato", from: e.target.value || undefined, to: value.to })
            }
          />
        </label>
        <label className="block">
          <span className="label">a</span>
          <input
            type="date"
            className="field mt-0.5"
            min={dataFrom}
            max={dataTo}
            value={value.to ?? ""}
            onChange={(e) =>
              onChange({ label: "Personalizzato", from: value.from, to: e.target.value || undefined })
            }
          />
        </label>
      </div>
    </div>
  );
}

function QualityNotice({ a, b, symbol }: { a: GapPeriodStats; b: GapPeriodStats; symbol: string }) {
  const worst = Math.max(a.identicalShare, b.identicalShare);
  if (worst < 0.02) return null;

  const bad = [a, b].filter((p) => p.identicalShare >= 0.02);

  return (
    <div
      className="panel px-4 py-3 text-[12px] leading-snug"
      style={{ borderColor: "var(--warn)", color: "var(--warn)" }}
    >
      <strong>Dati inaffidabili per questa analisi.</strong> In{" "}
      {bad.map((p) => `«${p.label}» (${pct(p.identicalShare, 1)})`).join(" e ")} l&apos;apertura di{" "}
      {symbol} risulta <em>identica</em> alla chiusura precedente. Non sono gap nulli reali: è
      l&apos;open dell&apos;indice, che si calcola dai primi scambi dei componenti e resta fermo al
      giorno prima finché questi non aprono. I gap risultano compressi verso lo zero. Usa SPY, che è
      uno strumento realmente scambiato.
    </div>
  );
}

function SummaryCard({ s, tone }: { s: GapPeriodStats; tone: string }) {
  const gapRate = s.n > 0 ? (s.n - s.flatCount) / s.n : 0;

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: tone }} />
        <span className="text-[13px] font-medium">{s.label}</span>
        <span className="num ml-auto text-[11px] text-[var(--muted)]">
          {shortDate(s.from)} → {shortDate(s.to)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-x-4 gap-y-2">
        {[
          { l: "Sedute", v: count(s.n) },
          { l: "Con gap", v: pct(gapRate, 1) },
          { l: "|gap| medio", v: pct(s.meanAbs) },
          { l: "mediana", v: pct(s.medianAbs) },
          { l: "p95", v: pct(s.p95Abs) },
          { l: "p99", v: pct(s.p99Abs) },
          { l: "max rialzo", v: pct(s.maxUp, 2, true) },
          { l: "max ribasso", v: pct(s.maxDown, 2, true) },
          { l: "media con segno", v: pct(s.meanSigned, 3, true) },
        ].map((k) => (
          <div key={k.l}>
            <div className="label">{k.l}</div>
            <div className="num text-[14px]">{k.v}</div>
          </div>
        ))}
      </div>

      <div className="num mt-2 flex gap-3 border-t border-[var(--line)] pt-2 text-[11px] text-[var(--muted)]">
        <span style={{ color: "var(--up)" }}>↑ {pct(s.n ? s.upCount / s.n : 0, 1)}</span>
        <span style={{ color: "var(--down)" }}>↓ {pct(s.n ? s.downCount / s.n : 0, 1)}</span>
        <span>= {pct(s.n ? s.flatCount / s.n : 0, 1)}</span>
      </div>
    </div>
  );
}

/** Barra doppia: quota del periodo A sopra, del periodo B sotto, stessa scala. */
function PairedBar({ a, b, max }: { a: number; b: number; max: number }) {
  const w = (v: number) => `${max > 0 ? (v / max) * 100 : 0}%`;
  return (
    <div className="w-full min-w-[70px] space-y-0.5">
      <div className="h-2 w-full rounded-sm bg-[var(--panel-alt)]">
        <div className="h-2 rounded-sm" style={{ width: w(a), background: TONE_A }} />
      </div>
      <div className="h-2 w-full rounded-sm bg-[var(--panel-alt)]">
        <div className="h-2 rounded-sm" style={{ width: w(b), background: TONE_B }} />
      </div>
    </div>
  );
}

function ExtremesTable({ s, tone }: { s: GapPeriodStats; tone: string }) {
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: tone }} />
        <span className="label">Gap maggiori — {s.label}</span>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="label">
            <th className="pb-1 text-left font-normal">seduta</th>
            <th className="pb-1 text-right font-normal">chiusura prec.</th>
            <th className="pb-1 text-right font-normal">apertura</th>
            <th className="pb-1 text-right font-normal">gap</th>
          </tr>
        </thead>
        <tbody>
          {s.extremes.map((g) => (
            <tr key={g.date} className="border-t border-[var(--line)]">
              <td className="num py-1 whitespace-nowrap">{shortDate(g.date)}</td>
              <td className="num py-1 text-right text-[var(--muted)]">{fmtPoints(g.prevClose)}</td>
              <td className="num py-1 text-right text-[var(--muted)]">{fmtPoints(g.open)}</td>
              <td
                className="num py-1 text-right"
                style={{ color: g.gapPct >= 0 ? "var(--up)" : "var(--down)" }}
              >
                {pct(g.gapPct, 2, true)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GapView({ symbols }: { symbols: SymbolInfo[] }) {
  const [request, setRequest] = useState<GapRequest>(DEFAULT_GAP_REQUEST);
  const [data, setData] = useState<GapResponse | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edgesDraft, setEdgesDraft] = useState<string | null>(null);

  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    setPending(true);

    const timer = setTimeout(() => {
      runGapAnalysis(request)
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

  const dataFrom = data?.dataFrom ?? "1993-01-29";
  const dataTo = data?.dataTo ?? "2026-08-04";

  const edgesText = request.edges
    .slice(1)
    .map((e) => (e * 100).toString().replace(".", ","))
    .join("; ");

  const commitEdges = (raw: string) => {
    const values = raw
      .split(/[;,\s]+/)
      .map((s) => Number(s.replace(",", ".")))
      .filter((v) => Number.isFinite(v) && v > 0)
      .map((v) => v / 100);

    const unique = [...new Set(values)].sort((x, y) => x - y);
    if (unique.length > 0) setRequest((r) => ({ ...r, edges: [0, ...unique] }));
  };

  const maxShare = data
    ? Math.max(...data.a.buckets.map((x) => x.share), ...data.b.buckets.map((x) => x.share))
    : 0;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-4">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[13px] text-[var(--muted)]">
          Ampiezza del gap di apertura — dalla chiusura di ieri all&apos;apertura di oggi — con due
          periodi a confronto
        </h1>
        <span className="num text-[11px] text-[var(--faint)]">
          {pending ? "calcolo…" : data ? `${count(data.a.n + data.b.n)} sedute analizzate` : ""}
        </span>
      </header>

      <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="panel p-3">
          <div className="label mb-2">Strumento</div>
          <select
            className="field"
            value={request.symbol}
            onChange={(e) => setRequest((r) => ({ ...r, symbol: e.target.value }))}
          >
            {symbols.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.symbol} — {s.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[11px] leading-snug text-[var(--faint)]">
            SPY è predefinito perché è realmente scambiato: la sua apertura è una stampa eseguibile.
            L&apos;apertura di un indice è ricalcolata dai componenti e comprime i gap.
          </p>

          <div className="label mb-1 mt-3">Classi di ampiezza (%)</div>
          <input
            className="field"
            value={edgesDraft ?? edgesText}
            onChange={(e) => setEdgesDraft(e.target.value)}
            onBlur={() => {
              if (edgesDraft !== null) commitEdges(edgesDraft);
              setEdgesDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            title="Estremi delle classi separati da punto e virgola"
          />
        </div>

        <PeriodPicker
          title="Periodo A"
          tone={TONE_A}
          value={request.a}
          dataFrom={dataFrom}
          dataTo={dataTo}
          onChange={(a) => setRequest((r) => ({ ...r, a }))}
        />
        <PeriodPicker
          title="Periodo B"
          tone={TONE_B}
          value={request.b}
          dataFrom={dataFrom}
          dataTo={dataTo}
          onChange={(b) => setRequest((r) => ({ ...r, b }))}
        />
      </div>

      {error && (
        <div className="panel mb-3 px-4 py-3 text-[12px]" style={{ color: "var(--up)" }}>
          {error}
        </div>
      )}

      {!data ? (
        <div className="panel px-4 py-10 text-center text-[var(--muted)]">Calcolo in corso…</div>
      ) : (
        <div className={pending ? "space-y-3 opacity-60 transition-opacity" : "space-y-3"}>
          <QualityNotice a={data.a} b={data.b} symbol={data.symbol} />

          <div className="grid gap-3 lg:grid-cols-2">
            <SummaryCard s={data.a} tone={TONE_A} />
            <SummaryCard s={data.b} tone={TONE_B} />
          </div>

          <div className="panel p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="label">Distribuzione per classe di ampiezza</span>
              <span className="num text-[11px] text-[var(--muted)]">
                <span style={{ color: TONE_A }}>■</span> {data.a.label} ·{" "}
                <span style={{ color: TONE_B }}>■</span> {data.b.label}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[12px]">
                <thead>
                  <tr className="label">
                    <th className="pb-1 text-left font-normal">classe di |gap|</th>
                    <th className="pb-1 text-right font-normal">A · quota</th>
                    <th className="pb-1 text-right font-normal">B · quota</th>
                    <th className="pb-1 text-center font-normal">confronto</th>
                    <th className="pb-1 text-right font-normal">differenza</th>
                    <th className="pb-1 text-right font-normal">A · oltre</th>
                    <th className="pb-1 text-right font-normal">B · oltre</th>
                    <th className="pb-1 text-right font-normal">A ↑/↓</th>
                    <th className="pb-1 text-right font-normal">B ↑/↓</th>
                  </tr>
                </thead>
                <tbody>
                  {data.a.buckets.map((ba, i) => {
                    const bb = data.b.buckets[i];
                    const diff = bb.share - ba.share;
                    return (
                      <tr key={ba.from} className="border-t border-[var(--line)]">
                        <td className="num py-1.5 pr-2 whitespace-nowrap">{bucketLabel(ba)}</td>
                        <td className="num py-1.5 text-right" style={{ color: TONE_A }}>
                          {pct(ba.share, 1)}
                        </td>
                        <td className="num py-1.5 text-right" style={{ color: TONE_B }}>
                          {pct(bb.share, 1)}
                        </td>
                        <td className="px-2 py-1.5">
                          <PairedBar a={ba.share} b={bb.share} max={maxShare} />
                        </td>
                        <td
                          className="num py-1.5 text-right"
                          style={{
                            color:
                              Math.abs(diff) < 0.005 ? "var(--faint)" : diff > 0 ? TONE_B : TONE_A,
                          }}
                        >
                          {pct(diff, 1, true)}
                        </td>
                        <td className="num py-1.5 text-right text-[var(--muted)]">
                          {pct(ba.cumulativeShare, 2)}
                        </td>
                        <td className="num py-1.5 text-right text-[var(--muted)]">
                          {pct(bb.cumulativeShare, 2)}
                        </td>
                        <td className="num py-1.5 text-right text-[var(--faint)]">
                          {ba.up}/{ba.down}
                        </td>
                        <td className="num py-1.5 text-right text-[var(--faint)]">
                          {bb.up}/{bb.down}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-[11px] leading-snug text-[var(--faint)]">
              «quota» è la percentuale di sedute che cade in quella classe; «oltre» è la cumulata,
              cioè la percentuale di sedute con gap pari o superiore all&apos;estremo inferiore della
              classe. Le classi sono chiuse a sinistra e aperte a destra, e l&apos;ultima non ha
              limite superiore.
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ExtremesTable s={data.a} tone={TONE_A} />
            <ExtremesTable s={data.b} tone={TONE_B} />
          </div>

          <details className="panel px-4 py-3 text-[12px] leading-relaxed text-[var(--muted)]">
            <summary className="label cursor-pointer">Note metodologiche</summary>
            <ul className="mt-2 list-disc space-y-1.5 pl-4">
              <li>
                Il gap è <span className="num">apertura(oggi) / chiusura(ieri) − 1</span>. La prima
                seduta della serie non produce alcun gap.
              </li>
              <li>
                Quando un periodo inizia a metà serie, la chiusura di riferimento resta quella della
                seduta precedente anche se cade fuori dal periodo: altrimenti si perderebbe la prima
                osservazione.
              </li>
              <li>
                <strong>Lo strumento conta più del periodo.</strong> L&apos;apertura di un indice non
                è un prezzo scambiato: si calcola dai primi scambi dei componenti, e quelli non
                ancora aperti contribuiscono con la chiusura precedente. È una media fra prezzi nuovi
                e prezzi fermi, quindi comprime il gap per costruzione.
              </li>
              <li>
                Su SPY i gap risultano circa il 30% più ampi che su SPX nello stesso periodo, pur con
                correlazione 0,98. Non è una discrepanza: è la differenza fra riprezzamento reale e
                valore stampato dall&apos;indice.
              </li>
              <li>
                SPY sconta i dividendi: le 4 sedute di stacco all&apos;anno mostrano un gap negativo
                di circa 0,35% non dovuto al mercato. L&apos;asta di apertura aggiunge rumore.
              </li>
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
