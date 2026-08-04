"use client";

import { useEffect, useState } from "react";

import { runComparison, type ComparisonRow } from "@/app/actions";
import type { AnalysisRequest } from "@/lib/analysis";
import { count, pct, shortDate } from "@/lib/format";
import {
  deleteStrategy,
  describeRequest,
  loadStrategies,
  saveStrategy,
  toSearchParams,
  type SavedStrategy,
} from "@/lib/strategies";

const MAX_COMPARE = 4;

export function StrategyBar({
  request,
  onLoad,
}: {
  request: AnalysisRequest;
  onLoad: (r: AnalysisRequest) => void;
}) {
  const [list, setList] = useState<SavedStrategy[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [rows, setRows] = useState<ComparisonRow[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [copied, setCopied] = useState(false);

  // localStorage non esiste durante il render sul server
  useEffect(() => setList(loadStrategies()), []);

  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_COMPARE ? s : [...s, id]
    );

  const compare = async () => {
    const entries = list
      .filter((s) => selected.includes(s.id))
      .map((s) => ({ key: s.id, request: s.request }));
    if (entries.length === 0) return;

    setComparing(true);
    try {
      setRows(await runComparison(entries));
    } finally {
      setComparing(false);
    }
  };

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}?${toSearchParams(request)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copia il link:", url);
    }
  };

  return (
    <div className="panel mb-3 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="field w-48"
          placeholder="Nome strategia"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              setList(saveStrategy(name, request));
              setName("");
            }
          }}
        />
        <button
          className="rounded border border-[var(--line)] px-2.5 py-1.5 text-[11px] hover:bg-[var(--panel-alt)] disabled:opacity-40"
          disabled={!name.trim()}
          onClick={() => {
            setList(saveStrategy(name, request));
            setName("");
          }}
        >
          Salva parametri correnti
        </button>
        <button
          className="rounded border border-[var(--line)] px-2.5 py-1.5 text-[11px] hover:bg-[var(--panel-alt)]"
          onClick={share}
        >
          {copied ? "Link copiato" : "Copia link"}
        </button>

        {list.length > 0 && (
          <>
            <span className="ml-auto text-[11px] text-[var(--faint)]">
              {selected.length}/{MAX_COMPARE} selezionate
            </span>
            <button
              className="rounded border border-[var(--line)] px-2.5 py-1.5 text-[11px] hover:bg-[var(--panel-alt)] disabled:opacity-40"
              disabled={selected.length === 0 || comparing}
              onClick={compare}
            >
              {comparing ? "Confronto…" : "Confronta"}
            </button>
            {rows && (
              <button
                className="rounded border border-[var(--line)] px-2.5 py-1.5 text-[11px] hover:bg-[var(--panel-alt)]"
                onClick={() => setRows(null)}
              >
                Chiudi confronto
              </button>
            )}
          </>
        )}
      </div>

      {list.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {list.map((s) => (
            <span
              key={s.id}
              data-on={selected.includes(s.id)}
              className="group flex items-center gap-1.5 rounded border border-[var(--line)] py-1 pl-2 pr-1 text-[11px] data-[on=true]:border-[var(--accent)] data-[on=true]:bg-[var(--accent-soft)]"
            >
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={selected.includes(s.id)}
                onChange={() => toggle(s.id)}
                title="Includi nel confronto"
              />
              <button
                onClick={() => onLoad(s.request)}
                title={`Carica: ${describeRequest(s.request)}`}
                className="hover:text-[var(--accent)]"
              >
                {s.name}
                <span className="num ml-1.5 text-[var(--faint)]">{describeRequest(s.request)}</span>
              </button>
              <button
                onClick={() => {
                  setList(deleteStrategy(s.id));
                  setSelected((x) => x.filter((i) => i !== s.id));
                }}
                title="Elimina"
                className="px-1 text-[var(--faint)] hover:text-[var(--up)]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {rows && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12px]">
            <thead>
              <tr className="label">
                <th className="pb-1 text-left font-normal">strategia</th>
                <th className="pb-1 text-right font-normal">n</th>
                <th className="pb-1 text-right font-normal">dentro</th>
                <th className="pb-1 text-right font-normal">sopra</th>
                <th className="pb-1 text-right font-normal">sotto</th>
                <th className="pb-1 text-right font-normal">mai tocc.</th>
                <th className="pb-1 text-right font-normal">rientrate</th>
                <th className="pb-1 text-right font-normal">sfond. medio</th>
                <th className="pb-1 text-right font-normal">p90</th>
                <th className="pb-1 text-right font-normal">peggiore</th>
                <th className="pb-1 text-right font-normal">margine mediano</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = list.find((x) => x.id === r.key);
                return (
                  <tr key={r.key} className="border-t border-[var(--line)]">
                    <td className="py-1.5 pr-2">
                      {s?.name}
                      <span className="num ml-1.5 text-[11px] text-[var(--faint)]">
                        {s ? describeRequest(s.request) : ""}
                      </span>
                      <div className="num text-[10px] text-[var(--faint)]">
                        {shortDate(r.firstEntry)} → {shortDate(r.lastEntry)}
                      </div>
                    </td>
                    <td className="num py-1.5 text-right text-[var(--muted)]">{count(r.n)}</td>
                    <td className="num py-1.5 text-right" style={{ color: "var(--ok)" }}>
                      {pct(r.insideRate, 1)}
                    </td>
                    <td className="num py-1.5 text-right" style={{ color: "var(--up)" }}>
                      {pct(r.breachUpRate, 1)}
                    </td>
                    <td className="num py-1.5 text-right" style={{ color: "var(--down)" }}>
                      {pct(r.breachDownRate, 1)}
                    </td>
                    <td className="num py-1.5 text-right">{pct(r.neverTouchedRate, 1)}</td>
                    <td className="num py-1.5 text-right" style={{ color: "var(--warn)" }}>
                      {pct(r.touchedButReturnedRate, 1)}
                    </td>
                    <td className="num py-1.5 text-right">{pct(r.meanBreachPct)}</td>
                    <td className="num py-1.5 text-right text-[var(--muted)]">
                      {pct(r.p90BreachPct)}
                    </td>
                    <td className="num py-1.5 text-right text-[var(--muted)]">
                      {pct(r.worstBreachPct)}
                    </td>
                    <td className="num py-1.5 text-right">{pct(r.medianMarginPct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-[var(--faint)]">
            Confronto sull&apos;ancoraggio percentuale. Attenzione ai periodi: strategie testate su
            intervalli diversi non sono direttamente comparabili.
          </p>
        </div>
      )}
    </div>
  );
}
