"use client";

import { useState } from "react";

import { points as fmtPoints } from "@/lib/format";

/** Accetta sia la virgola che il punto come separatore decimale. */
function parseNum(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "" || cleaned === "-" || cleaned === "+") return null;
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

function format(v: number, digits: number): string {
  return v.toFixed(digits).replace(".", ",");
}

type FieldProps = {
  value: number;
  digits: number;
  suffix: string;
  onCommit: (v: number) => void;
  title: string;
};

/**
 * Campo numerico che mantiene una bozza mentre si digita: senza di essa
 * riformattare a ogni tasto renderebbe impossibile scrivere "−1,2".
 */
function NumberField({ value, digits, suffix, onCommit, title }: FieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="relative">
      <input
        className="field pr-6 text-right"
        title={title}
        inputMode="decimal"
        value={draft ?? format(value, digits)}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = parseNum(e.target.value);
          if (parsed !== null) onCommit(parsed);
        }}
        onBlur={() => setDraft(null)}
        onFocus={(e) => e.currentTarget.select()}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--faint)]">
        {suffix}
      </span>
    </div>
  );
}

export type BepEditorProps = {
  spot: number;
  /** sigma della strategia sulla durata scelta, gia' scalato */
  sigmaN: number;
  lowPct: number;
  highPct: number;
  symmetric: boolean;
  onChange: (lowPct: number, highPct: number) => void;
  onSymmetricChange: (symmetric: boolean) => void;
};

/**
 * Editor dei BEP nelle tre rappresentazioni sincronizzate.
 *
 * La forma canonica e' la distanza percentuale con segno: e' quella che il
 * backtest riapplica a ogni finestra storica. Punti e sigma sono viste su di
 * essa, calcolate sullo spot e sul sigma correnti.
 */
export function BepEditor({
  spot,
  sigmaN,
  lowPct,
  highPct,
  symmetric,
  onChange,
  onSymmetricChange,
}: BepEditorProps) {
  const toSd = (p: number) => (sigmaN > 0 ? Math.log(1 + p) / sigmaN : NaN);
  const fromSd = (s: number) => Math.exp(s * sigmaN) - 1;

  /** Con il blocco simmetrico attivo, una modifica si specchia sull'altro lato. */
  const set = (side: "low" | "high", pctValue: number) => {
    if (symmetric) {
      const mag = Math.abs(pctValue);
      onChange(-mag, mag);
    } else if (side === "low") {
      onChange(pctValue, highPct);
    } else {
      onChange(lowPct, pctValue);
    }
  };

  const rows = [
    { side: "low" as const, label: "BEP inferiore", value: lowPct, tone: "var(--down)" },
    { side: "high" as const, label: "BEP superiore", value: highPct, tone: "var(--up)" },
  ];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Break-even</span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--muted)]">
          <input
            type="checkbox"
            checked={symmetric}
            onChange={(e) => {
              onSymmetricChange(e.target.checked);
              if (e.target.checked) {
                const mag = Math.max(Math.abs(lowPct), Math.abs(highPct));
                onChange(-mag, mag);
              }
            }}
            className="accent-[var(--accent)]"
          />
          simmetrici
        </label>
      </div>

      <div className="grid grid-cols-[1fr_1fr_1fr] gap-1.5 pb-1">
        <span className="label text-center">punti</span>
        <span className="label text-center">%</span>
        <span className="label text-center">sigma</span>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.side}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[11px]" style={{ color: row.tone }}>
                {row.label}
              </span>
              <span className="num text-[11px] text-[var(--muted)]">
                {fmtPoints(spot * (1 + row.value))}
              </span>
            </div>
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-1.5">
              <NumberField
                title="Distanza in punti indice"
                value={row.value * spot}
                digits={1}
                suffix="pt"
                onCommit={(v) => set(row.side, v / spot)}
              />
              <NumberField
                title="Distanza in percentuale dello spot"
                value={row.value * 100}
                digits={3}
                suffix="%"
                onCommit={(v) => set(row.side, v / 100)}
              />
              <NumberField
                title="Distanza in deviazioni standard sulla durata della strategia"
                value={toSd(row.value)}
                digits={2}
                suffix="σ"
                onCommit={(v) => set(row.side, fromSd(v))}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
