"use client";

import {
  PRESETS,
  SAMPLING_LABELS,
  WEEKDAY_LABELS,
  type AnalysisRequest,
  type SamplingKind,
  type SymbolMeta,
} from "@/lib/analysis";
import type { SymbolInfo } from "@/lib/data";
import { pct, points as fmtPoints, shortDate } from "@/lib/format";

import { BepEditor } from "./bep-editor";

const DAY_PRESETS = [1, 2, 3, 5, 7, 10, 21, 42, 63];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--line)] px-4 py-3 last:border-b-0">
      <div className="label mb-2">{title}</div>
      {children}
    </section>
  );
}

export type ParamsPanelProps = {
  request: AnalysisRequest;
  meta: SymbolMeta;
  symbols: SymbolInfo[];
  sigmaN: number;
  symmetric: boolean;
  onSymmetricChange: (v: boolean) => void;
  onChange: (patch: Partial<AnalysisRequest>) => void;
};

export function ParamsPanel({
  request,
  meta,
  symbols,
  sigmaN,
  symmetric,
  onSymmetricChange,
  onChange,
}: ParamsPanelProps) {
  const activePreset = PRESETS.find(
    (p) => p.from(meta.dataFrom, meta.dataTo) === request.from
  );

  return (
    <div className="panel divide-y divide-[var(--line)]">
      <Section title="Sottostante">
        <select
          className="field"
          value={request.symbol}
          onChange={(e) => onChange({ symbol: e.target.value })}
        >
          {symbols.map((s) => (
            <option key={s.symbol} value={s.symbol}>
              {s.symbol} — {s.label}
            </option>
          ))}
        </select>
        <div className="num mt-2 flex justify-between text-[11px] text-[var(--muted)]">
          <span>
            spot {fmtPoints(meta.spot)} · {shortDate(meta.spotDate)}
          </span>
          <span>dal {meta.dataFrom.slice(0, 4)}</span>
        </div>
      </Section>

      <Section title="Durata (giorni di borsa)">
        <div className="flex gap-1.5">
          <input
            type="number"
            min={1}
            max={252}
            className="field w-20 text-right"
            value={request.days}
            onChange={(e) => onChange({ days: Math.max(1, Number(e.target.value) || 1) })}
          />
          <div className="seg flex-1">
            {DAY_PRESETS.map((d) => (
              <button key={d} data-on={request.days === d} onClick={() => onChange({ days: d })}>
                {d}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Break-even">
        <BepEditor
          spot={meta.spot}
          sigmaN={sigmaN}
          lowPct={request.bepLowPct}
          highPct={request.bepHighPct}
          symmetric={symmetric}
          onSymmetricChange={onSymmetricChange}
          onChange={(bepLowPct, bepHighPct) => onChange({ bepLowPct, bepHighPct })}
        />
      </Section>

      <Section title="Periodo">
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => {
            const from = p.from(meta.dataFrom, meta.dataTo);
            const on = activePreset?.id === p.id && !request.to;
            return (
              <button
                key={p.id}
                title={p.hint}
                data-on={on}
                onClick={() => onChange({ from, to: undefined })}
                className="rounded border border-[var(--line)] px-2 py-1 text-left text-[11px] text-[var(--muted)] hover:bg-[var(--panel-alt)] hover:text-[var(--text)] data-[on=true]:border-[var(--accent)] data-[on=true]:bg-[var(--accent-soft)] data-[on=true]:text-[var(--accent)]"
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <label className="block">
            <span className="label">da</span>
            <input
              type="date"
              className="field mt-0.5"
              min={meta.dataFrom}
              max={meta.dataTo}
              value={request.from ?? ""}
              onChange={(e) => onChange({ from: e.target.value || undefined })}
            />
          </label>
          <label className="block">
            <span className="label">a</span>
            <input
              type="date"
              className="field mt-0.5"
              min={meta.dataFrom}
              max={meta.dataTo}
              value={request.to ?? ""}
              onChange={(e) => onChange({ to: e.target.value || undefined })}
            />
          </label>
        </div>
      </Section>

      <Section title="Campionamento">
        <div className="seg">
          {(Object.keys(SAMPLING_LABELS) as SamplingKind[]).map((k) => (
            <button
              key={k}
              data-on={request.sampling === k}
              title={SAMPLING_LABELS[k].hint}
              onClick={() => onChange({ sampling: k })}
            >
              {SAMPLING_LABELS[k].label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-[var(--faint)]">
          {SAMPLING_LABELS[request.sampling].hint}
        </p>
        {request.sampling === "weekday" && (
          <select
            className="field mt-1.5"
            value={request.weekday}
            onChange={(e) => onChange({ weekday: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                {WEEKDAY_LABELS[d]}
              </option>
            ))}
          </select>
        )}
      </Section>

      <Section title="Fonte del sigma">
        <div className="seg">
          <button
            data-on={request.sigmaSource === "realized"}
            onClick={() => onChange({ sigmaSource: "realized" })}
            title="Deviazione standard dei rendimenti degli ultimi 30 giorni di borsa, annualizzata"
          >
            Realizzata 30g
          </button>
          <button
            data-on={request.sigmaSource === "vix"}
            onClick={() => onChange({ sigmaSource: "vix" })}
            title="VIX di chiusura del giorno d'ingresso: la volatilità che il mercato prezzava"
          >
            VIX
          </button>
        </div>
        <div className="num mt-2 flex justify-between text-[11px] text-[var(--muted)]">
          <span>realizzata {pct(meta.realizedVolAnnual)}</span>
          <span>VIX {pct(meta.vixAnnual)}</span>
        </div>
      </Section>
    </div>
  );
}
