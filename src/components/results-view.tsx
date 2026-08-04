"use client";

import { useState } from "react";

import { ANCHOR_LABELS, type AnalysisResponse } from "@/lib/analysis";
import type { Distribution, GroupStats } from "@/lib/backtest/stats";
import type { AnchorMode } from "@/lib/backtest/types";
import { count, pct, points as fmtPoints, sd as fmtSd, shortDate } from "@/lib/format";

import { BreachCurveChart, OutcomeBar, ReturnsHistogram } from "./charts";

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

function Kpi({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  title?: string;
}) {
  return (
    <div className="panel px-3 py-2.5" title={title}>
      <div className="label">{label}</div>
      <div className="num mt-1 text-[21px] leading-none" style={{ color: tone ?? "var(--text)" }}>
        {value}
      </div>
      {sub && <div className="num mt-1 text-[11px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="num mt-0.5 text-[13px]">{value}</div>
    </div>
  );
}

function DistRow({ label, d, tone }: { label: string; d: Distribution | null; tone?: string }) {
  return (
    <tr className="border-t border-[var(--line)]">
      <td className="py-1.5 pr-2" style={{ color: tone }}>
        {label}
      </td>
      <td className="num py-1.5 text-right text-[var(--muted)]">{d ? count(d.n) : "—"}</td>
      <td className="num py-1.5 text-right">{d ? pct(d.mean) : "—"}</td>
      <td className="num py-1.5 text-right">{d ? pct(d.median) : "—"}</td>
      <td className="num py-1.5 text-right">{d ? pct(d.p90) : "—"}</td>
      <td className="num py-1.5 text-right">{d ? pct(d.p99) : "—"}</td>
      <td className="num py-1.5 text-right">{d ? pct(d.max) : "—"}</td>
    </tr>
  );
}

function GroupTable({ rows, header }: { rows: GroupStats[]; header: string }) {
  if (rows.length === 0) {
    return <p className="text-[11px] text-[var(--faint)]">Nessun dato disponibile per questo raggruppamento.</p>;
  }
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="label">
          <th className="pb-1 text-left font-normal">{header}</th>
          <th className="pb-1 text-right font-normal">n</th>
          <th className="pb-1 text-right font-normal">dentro</th>
          <th className="pb-1 text-right font-normal">sopra</th>
          <th className="pb-1 text-right font-normal">sotto</th>
          <th className="pb-1 text-right font-normal">sfond. medio</th>
          <th className="pb-1 text-right font-normal">peggiore</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g) => (
          <tr key={g.label} className="border-t border-[var(--line)]">
            <td className="num py-1 pr-2 whitespace-nowrap">{g.label}</td>
            <td className="num py-1 text-right text-[var(--muted)]">{count(g.n)}</td>
            <td className="py-1 text-right">
              <span className="num inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-1.5 rounded-sm"
                  style={{ width: `${Math.max(1, g.insideRate * 36)}px`, background: "var(--ok)" }}
                />
                {pct(g.insideRate, 1)}
              </span>
            </td>
            <td className="num py-1 text-right" style={{ color: "var(--up)" }}>
              {pct(g.breachUpRate, 1)}
            </td>
            <td className="num py-1 text-right" style={{ color: "var(--down)" }}>
              {pct(g.breachDownRate, 1)}
            </td>
            <td className="num py-1 text-right text-[var(--muted)]">{pct(g.meanBreachPct, 2)}</td>
            <td className="num py-1 text-right text-[var(--muted)]">{pct(g.worstBreachPct, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ResultsView({ data }: { data: AnalysisResponse }) {
  const [anchor, setAnchor] = useState<AnchorMode>("pct");

  const a = data.anchors[anchor];
  const { reference: ref, diagnostics: diag, meta } = data;

  const anchorSelector = (
    <div className="seg w-[220px]">
      {(Object.keys(ANCHOR_LABELS) as AnchorMode[]).map((k) => (
        <button
          key={k}
          data-on={anchor === k}
          title={ANCHOR_LABELS[k].hint}
          onClick={() => setAnchor(k)}
        >
          {ANCHOR_LABELS[k].label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Cosa e' stato testato, esattamente */}
      <div className="panel flex flex-wrap items-start gap-x-8 gap-y-3 px-4 py-3">
        <Meta label="Sottostante" value={`${meta.symbol} · ${fmtPoints(meta.spot)}`} />
        <Meta
          label="BEP"
          value={`${fmtPoints(ref.lowPoints, 0, true)} / ${fmtPoints(ref.highPoints, 0, true)} pt`}
        />
        <Meta label="In percentuale" value={`${pct(ref.lowPct, 2, true)} / ${pct(ref.highPct, 2, true)}`} />
        <Meta label="In sigma" value={`${fmtSd(ref.lowSd, true)} / ${fmtSd(ref.highSd, true)}`} />
        <Meta
          label={`Sigma ${data.reference.sigmaSource === "vix" ? "(VIX)" : "(realizz. 30g)"}`}
          value={`${pct(ref.sigmaAnnual)} annuo → ${pct(ref.sigmaN)} sulla durata`}
        />
        <Meta
          label="Periodo analizzato"
          value={`${shortDate(diag.firstEntry)} → ${shortDate(diag.lastEntry)}`}
        />
        <Meta
          label="Finestre"
          value={`${count(diag.totalWindows)} · ~${count(diag.effectiveIndependentWindows)} indip.`}
        />
      </div>

      {diag.totalWindows === 0 && (
        <div className="panel px-4 py-6 text-center text-[var(--muted)]">
          Nessuna finestra nel periodo selezionato. Allarga l&apos;intervallo o riduci la durata.
        </div>
      )}

      {diag.totalWindows > 0 && (
        <>
          {/* Esito a scadenza */}
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-medium">Esito a scadenza</h2>
            {anchorSelector}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi
              label="Dentro i BEP"
              value={pct(a.insideRate, 1)}
              sub={`${count(Math.round(a.insideRate * a.n))} finestre`}
              tone="var(--ok)"
              title="Chiusura alla scadenza compresa tra i due BEP"
            />
            <Kpi
              label="Oltre sopra"
              value={pct(a.breachUpRate, 1)}
              sub={a.breachUp ? `in media ${pct(a.breachUp.mean)}` : undefined}
              tone="var(--up)"
            />
            <Kpi
              label="Oltre sotto"
              value={pct(a.breachDownRate, 1)}
              sub={a.breachDown ? `in media ${pct(a.breachDown.mean)}` : undefined}
              tone="var(--down)"
            />
            <Kpi
              label="Mai toccati"
              value={pct(a.neverTouchedRate, 1)}
              sub="nemmeno durante la vita"
              title="Finestre in cui il prezzo non ha mai violato un BEP, neppure in intraday"
            />
            <Kpi
              label="Toccati e rientrati"
              value={pct(a.touchedButReturnedRate, 1)}
              sub="chiuse comunque dentro"
              tone="var(--warn)"
              title="Hanno violato un BEP durante la vita ma sono rientrate entro la scadenza: il caso che fa chiudere in perdita una posizione poi vincente"
            />
          </div>

          <OutcomeBar
            insideRate={a.insideRate}
            breachUpRate={a.breachUpRate}
            breachDownRate={a.breachDownRate}
          />

          {a.skipped > 0 && (
            <p className="text-[11px] text-[var(--warn)]">
              {count(a.skipped)} finestre escluse da questo ancoraggio: sigma non disponibile alla
              data d&apos;ingresso
              {data.reference.sigmaSource === "vix" ? " (il VIX parte dal 1990)" : ""}.
            </p>
          )}

          {/* Confronto tra ancoraggi */}
          <Panel
            title="Confronto tra ancoraggi"
            note="Se i due valori divergono molto, il risultato dipende fortemente dall'ipotesi su come i BEP scalano nel tempo: con l'ancoraggio a sigma i BEP si allargano nei periodi volatili, come farebbe il premio realmente incassato."
          >
            <table className="w-full text-[12px]">
              <thead>
                <tr className="label">
                  <th className="pb-1 text-left font-normal">ancoraggio</th>
                  <th className="pb-1 text-right font-normal">n</th>
                  <th className="pb-1 text-right font-normal">dentro</th>
                  <th className="pb-1 text-right font-normal">sopra</th>
                  <th className="pb-1 text-right font-normal">sotto</th>
                  <th className="pb-1 text-right font-normal">mai toccati</th>
                  <th className="pb-1 text-right font-normal">sfond. medio</th>
                  <th className="pb-1 text-right font-normal">ampiezza media</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(ANCHOR_LABELS) as AnchorMode[]).map((k) => {
                  const r = data.anchors[k];
                  return (
                    <tr
                      key={k}
                      className="border-t border-[var(--line)]"
                      style={{ opacity: k === anchor ? 1 : 0.62 }}
                    >
                      <td className="py-1.5 pr-2">{ANCHOR_LABELS[k].label}</td>
                      <td className="num py-1.5 text-right text-[var(--muted)]">{count(r.n)}</td>
                      <td className="num py-1.5 text-right">{pct(r.insideRate, 1)}</td>
                      <td className="num py-1.5 text-right" style={{ color: "var(--up)" }}>
                        {pct(r.breachUpRate, 1)}
                      </td>
                      <td className="num py-1.5 text-right" style={{ color: "var(--down)" }}>
                        {pct(r.breachDownRate, 1)}
                      </td>
                      <td className="num py-1.5 text-right">{pct(r.neverTouchedRate, 1)}</td>
                      <td className="num py-1.5 text-right">{pct(r.breachAll?.mean ?? null)}</td>
                      <td className="num py-1.5 text-right text-[var(--muted)]">
                        {pct(r.avgRangeWidthPct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>

          {/* Distribuzione dei rendimenti */}
          <Panel
            title={`Rendimenti a ${count(diag.totalWindows)} finestre, con i BEP sovrapposti`}
            note="L'area colorata oltre le linee tratteggiate è la frequenza di sfondamento. La coda sinistra più spessa della destra è la normale asimmetria degli indici azionari: i crolli sono più rapidi dei rialzi."
          >
            <ReturnsHistogram bins={data.histogram} lowPct={ref.lowPct} highPct={ref.highPct} />
          </Panel>

          {/* Curva di sfondamento */}
          <Panel
            title="Dove piazzare i BEP: frequenza storica di chiusura oltre una data distanza"
            note="Linea piena: uscita da una banda simmetrica. Tratteggiate: le due direzioni separate. Il punto scuro è la posizione dei BEP attuali."
          >
            <BreachCurveChart curve={data.curve} lowPct={ref.lowPct} highPct={ref.highPct} />
          </Panel>

          {/* Intensita' */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel
              title="Intensità degli sfondamenti"
              note="Calcolata solo sulle finestre effettivamente sfondate: risponde a «quando esce dai BEP, di quanto esce». Valori in percentuale dello spot d'ingresso."
            >
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="label">
                    <th className="pb-1 text-left font-normal" />
                    <th className="pb-1 text-right font-normal">n</th>
                    <th className="pb-1 text-right font-normal">media</th>
                    <th className="pb-1 text-right font-normal">mediana</th>
                    <th className="pb-1 text-right font-normal">p90</th>
                    <th className="pb-1 text-right font-normal">p99</th>
                    <th className="pb-1 text-right font-normal">max</th>
                  </tr>
                </thead>
                <tbody>
                  <DistRow label="Complessivo" d={a.breachAll} />
                  <DistRow label="Sopra" d={a.breachUp} tone="var(--up)" />
                  <DistRow label="Sotto" d={a.breachDown} tone="var(--down)" />
                  <DistRow label="Margine residuo" d={a.margin} tone="var(--ok)" />
                </tbody>
              </table>
              <p className="mt-2 text-[11px] leading-snug text-[var(--faint)]">
                Il margine residuo è la distanza dal BEP più vicino nelle finestre chiuse dentro:
                mediana {pct(a.margin?.median ?? null)} significa che metà delle volte il cuscinetto
                è stato inferiore a quel valore.
              </p>
            </Panel>

            <Panel
              title="Escursione massima durante la vita"
              note="Quanto il prezzo si è spinto nelle due direzioni prima della scadenza, su tutte le finestre. Serve a dimensionare lo stress da sopportare, non l'esito finale."
            >
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="label">
                    <th className="pb-1 text-left font-normal" />
                    <th className="pb-1 text-right font-normal">n</th>
                    <th className="pb-1 text-right font-normal">media</th>
                    <th className="pb-1 text-right font-normal">mediana</th>
                    <th className="pb-1 text-right font-normal">p90</th>
                    <th className="pb-1 text-right font-normal">p99</th>
                    <th className="pb-1 text-right font-normal">max</th>
                  </tr>
                </thead>
                <tbody>
                  <DistRow label="Massimo al rialzo" d={a.excursionUp} tone="var(--up)" />
                  <DistRow label="Minimo al ribasso" d={a.excursionDown} tone="var(--down)" />
                </tbody>
              </table>
              <p className="mt-2 text-[11px] leading-snug text-[var(--faint)]">
                Il minimo al ribasso è espresso con segno negativo, quindi la colonna «max» ne
                rappresenta il caso più benigno e «media» il valore tipico.
              </p>
            </Panel>
          </div>

          {/* Regime */}
          <Panel
            title="Per regime di volatilità (quintili di VIX al giorno d'ingresso)"
            note="Le finestre precedenti al 1990 sono escluse: il VIX non esiste prima di quella data."
          >
            <GroupTable rows={a.byVix} header="quintile" />
          </Panel>

          {/* Anno per anno */}
          <Panel title="Anno per anno">
            <div className="max-h-[360px] overflow-y-auto">
              <GroupTable rows={a.byYear} header="anno" />
            </div>
          </Panel>

          {/* Peggiori finestre */}
          <Panel
            title="Finestre peggiori"
            note="Ordinate per ampiezza dello sfondamento a scadenza."
          >
            {a.worst.length === 0 ? (
              <p className="text-[12px] text-[var(--ok)]">
                Nessuno sfondamento nel periodo selezionato.
              </p>
            ) : (
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="label">
                    <th className="pb-1 text-left font-normal">ingresso</th>
                    <th className="pb-1 text-left font-normal">scadenza</th>
                    <th className="pb-1 text-right font-normal">da</th>
                    <th className="pb-1 text-right font-normal">a</th>
                    <th className="pb-1 text-right font-normal">rendimento</th>
                    <th className="pb-1 text-right font-normal">oltre il BEP</th>
                    <th className="pb-1 text-right font-normal">VIX ingr.</th>
                  </tr>
                </thead>
                <tbody>
                  {a.worst.map((w) => (
                    <tr key={w.entryDate} className="border-t border-[var(--line)]">
                      <td className="num py-1 whitespace-nowrap">{shortDate(w.entryDate)}</td>
                      <td className="num py-1 whitespace-nowrap text-[var(--muted)]">
                        {shortDate(w.exitDate)}
                      </td>
                      <td className="num py-1 text-right text-[var(--muted)]">{fmtPoints(w.s0)}</td>
                      <td className="num py-1 text-right text-[var(--muted)]">{fmtPoints(w.sT)}</td>
                      <td
                        className="num py-1 text-right"
                        style={{ color: w.retPct >= 0 ? "var(--up)" : "var(--down)" }}
                      >
                        {pct(w.retPct, 2, true)}
                      </td>
                      <td
                        className="num py-1 text-right"
                        style={{ color: w.direction === "up" ? "var(--up)" : "var(--down)" }}
                      >
                        {w.direction === "up" ? "↑" : "↓"} {pct(w.breachPct)}
                      </td>
                      <td className="num py-1 text-right text-[var(--muted)]">
                        {w.vixAnnual == null ? "—" : fmtPoints(w.vixAnnual * 100, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
