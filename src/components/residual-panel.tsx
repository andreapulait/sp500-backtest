"use client";

import { useEffect, useRef, useState } from "react";

import { runResidualAnalysis, type ResidualResponse } from "@/app/actions";
import type {
  ResidualBucket,
  ResidualReference,
  ResidualRow,
} from "@/lib/backtest/residuals";
import { count, pct, points as fmtPoints, shortDate } from "@/lib/format";

const UP = "var(--up)";
const DOWN = "var(--down)";
const MIN_RELIABLE_SAMPLE = 30;

function Sessions({ v }: { v: number | null | undefined }) {
  if (v == null || !Number.isFinite(v)) return <>—</>;
  return <>{v.toFixed(v % 1 === 0 ? 0 : 1).replace(".", ",")}</>;
}

function BucketRows({
  bucket,
  tone,
  expanded,
  onToggle,
}: {
  bucket: ResidualBucket;
  tone: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-t border-[var(--line)] bg-[var(--panel-alt)] hover:brightness-[0.98]"
        onClick={onToggle}
      >
        <td className="num py-1 pl-6 pr-2 text-[var(--muted)]">
          <span className="mr-1.5 inline-block w-2 text-[9px]">{expanded ? "▾" : "▸"}</span>
          {bucket.residualExtremeBars === 0
            ? "il top è qui"
            : `ancora ${bucket.residualExtremeBars}`}
        </td>
        <td className="num py-1 text-right text-[var(--muted)]">{count(bucket.n)}</td>
        <td className="num py-1 text-right text-[var(--muted)]">{pct(bucket.share, 1)}</td>
        <td className="num py-1 text-right" style={{ color: tone }}>
          {pct(bucket.residualPct?.median, 2, true)}
        </td>
        <td className="num py-1 text-right text-[var(--muted)]">
          {pct(bucket.residualPct?.p90, 2, true)}
        </td>
        <td className="num py-1 text-right text-[var(--muted)]">
          <Sessions v={bucket.residualSessions?.median} />
        </td>
        <td className="num py-1 text-right text-[var(--muted)]">
          <Sessions v={bucket.residualSessions?.max} />
        </td>
        <td colSpan={2} />
      </tr>

      {expanded &&
        bucket.samples.map((s) => (
          <tr key={s.observed} className="border-t border-[var(--line)] text-[11px]">
            <td className="num py-0.5 pl-12 pr-2 text-[var(--faint)]">{shortDate(s.observed)}</td>
            <td className="num py-0.5 text-right text-[var(--faint)]">{fmtPoints(s.refClose)}</td>
            <td className="num py-0.5 text-right text-[var(--faint)]">→</td>
            <td className="num py-0.5 text-right" style={{ color: tone }}>
              {pct(s.residualPct, 2, true)}
            </td>
            <td className="num py-0.5 text-right text-[var(--faint)]">
              {fmtPoints(s.topPrice)}
            </td>
            <td className="num py-0.5 text-right text-[var(--faint)]">{s.residualSessions}</td>
            <td colSpan={3} className="num py-0.5 pl-3 text-[var(--faint)]">
              top {shortDate(s.topDate)}
            </td>
          </tr>
        ))}

      {expanded && bucket.n > bucket.samples.length && (
        <tr className="border-t border-[var(--line)]">
          <td colSpan={9} className="py-0.5 pl-12 text-[10px] text-[var(--faint)]">
            mostrate le {bucket.samples.length} occorrenze più recenti su {count(bucket.n)}
          </td>
        </tr>
      )}
    </>
  );
}

function Row({
  row,
  tone,
  expanded,
  onToggle,
  expandedBuckets,
  onToggleBucket,
}: {
  row: ResidualRow;
  tone: string;
  expanded: boolean;
  onToggle: () => void;
  expandedBuckets: Set<number>;
  onToggleBucket: (k: number) => void;
}) {
  const reliable = row.n >= MIN_RELIABLE_SAMPLE;

  return (
    <>
      <tr
        className="cursor-pointer border-t border-[var(--line)] hover:bg-[var(--panel-alt)]"
        style={{ opacity: reliable ? 1 : 0.45 }}
        onClick={onToggle}
        title={reliable ? undefined : `Solo ${row.n} osservazioni`}
      >
        <td className="num py-1.5 pr-2 font-medium">
          <span className="mr-1.5 inline-block w-2 text-[9px] text-[var(--muted)]">
            {expanded ? "▾" : "▸"}
          </span>
          {row.atCount}
        </td>
        <td className="num py-1.5 text-right text-[var(--muted)]">{count(row.n)}</td>
        <td className="num py-1.5 text-right text-[var(--muted)]" />
        <td className="num py-1.5 text-right font-medium" style={{ color: tone }}>
          {pct(row.residualPct?.median, 2, true)}
        </td>
        <td className="num py-1.5 text-right">{pct(row.residualPct?.p90, 2, true)}</td>
        <td className="num py-1.5 text-right">
          <Sessions v={row.residualSessions?.median} />
        </td>
        <td className="num py-1.5 text-right text-[var(--muted)]">
          <Sessions v={row.residualSessions?.p90} />
        </td>
        <td className="num py-1.5 text-right text-[var(--muted)]">
          {pct(row.medianSpeedPct, 2)}
        </td>
        <td className="num py-1.5 text-right text-[var(--muted)]">
          {pct(row.thresholds.find((t) => t.level === 0.01)?.share ?? 0, 0)}
        </td>
      </tr>

      {expanded &&
        row.buckets.map((b) => (
          <BucketRows
            key={b.residualExtremeBars}
            bucket={b}
            tone={tone}
            expanded={expandedBuckets.has(b.residualExtremeBars)}
            onToggle={() => onToggleBucket(b.residualExtremeBars)}
          />
        ))}
    </>
  );
}

export function ResidualPanel({
  symbol,
  from,
  to,
  outside,
  closeUpAfter,
  closeDownAfter,
}: {
  symbol: string;
  from?: string;
  to?: string;
  outside: "flip" | "keep";
  closeUpAfter: number;
  closeDownAfter: number;
}) {
  const [direction, setDirection] = useState<"up" | "down">("up");
  const [reference, setReference] = useState<ResidualReference>("close");
  const [data, setData] = useState<ResidualResponse | null>(null);
  const [pending, setPending] = useState(true);
  const [openRows, setOpenRows] = useState<Set<number>>(new Set());
  const [openBuckets, setOpenBuckets] = useState<Set<string>>(new Set());

  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    setPending(true);

    const timer = setTimeout(() => {
      runResidualAnalysis({
        symbol,
        from,
        to,
        outside,
        closeUpAfter,
        closeDownAfter,
        direction,
        reference,
      })
        .then((res) => {
          if (seq.current !== id) return;
          setData(res);
        })
        .finally(() => {
          if (seq.current === id) setPending(false);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [symbol, from, to, outside, closeUpAfter, closeDownAfter, direction, reference]);

  const tone = direction === "up" ? UP : DOWN;
  const verb = direction === "up" ? "sale" : "scende";
  const extremeWord = direction === "up" ? "massimo" : "minimo";

  const toggleRow = (n: number) =>
    setOpenRows((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  const toggleBucket = (rowN: number, k: number) =>
    setOpenBuckets((s) => {
      const key = `${rowN}:${k}`;
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="panel p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="label">Quanto {verb} ancora dopo l&apos;N-esimo estremo</span>
        <div className="flex flex-wrap gap-2">
          <div className="seg w-[250px]">
            <button
              data-on={reference === "close"}
              onClick={() => setReference("close")}
              title="Misura dalla chiusura della barra: include il recupero del ritracciamento intraday già avvenuto"
            >
              Dalla chiusura
            </button>
            <button
              data-on={reference === "extreme"}
              onClick={() => setReference("extreme")}
              title={`Misura dal ${extremeWord} della barra: solo l'estensione oltre il livello già raggiunto`}
            >
              Dal {extremeWord}
            </button>
          </div>
          <div className="seg w-[230px]">
            <button data-on={direction === "up"} onClick={() => setDirection("up")}>
              Fasi di massimi
            </button>
            <button data-on={direction === "down"} onClick={() => setDirection("down")}>
              Fasi di minimi
            </button>
          </div>
        </div>
      </div>

      {!data ? (
        <div className="py-8 text-center text-[var(--muted)]">Calcolo in corso…</div>
      ) : (
        <div className={pending ? "opacity-60" : ""}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12px]">
              <thead>
                <tr className="label">
                  <th className="pb-1 text-left font-normal">estremi formati</th>
                  <th className="pb-1 text-right font-normal">casi</th>
                  <th className="pb-1 text-right font-normal" />
                  <th className="pb-1 text-right font-normal">residuo mediano</th>
                  <th className="pb-1 text-right font-normal">p90</th>
                  <th className="pb-1 text-right font-normal">sedute mediane</th>
                  <th className="pb-1 text-right font-normal">sedute p90</th>
                  <th className="pb-1 text-right font-normal">%/seduta</th>
                  <th className="pb-1 text-right font-normal">oltre 1%</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <Row
                    key={r.atCount}
                    row={r}
                    tone={tone}
                    expanded={openRows.has(r.atCount)}
                    onToggle={() => toggleRow(r.atCount)}
                    expandedBuckets={
                      new Set(
                        [...openBuckets]
                          .filter((k) => k.startsWith(`${r.atCount}:`))
                          .map((k) => Number(k.split(":")[1]))
                      )
                    }
                    onToggleBucket={(k) => toggleBucket(r.atCount, k)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[11px] leading-snug text-[var(--faint)]">
            {reference === "close" ? (
              <>
                Il residuo è misurato dalla <strong>chiusura</strong> della barra che forma
                l&apos;N-esimo estremo: è il prezzo a cui potresti agire, quindi il numero include
                anche il recupero del ritracciamento intraday già avvenuto su quella barra.
              </>
            ) : (
              <>
                Il residuo è misurato dal <strong>{extremeWord}</strong> della barra che forma
                l&apos;N-esimo estremo: misura la sola estensione oltre il livello già raggiunto,
                quindi le fasi che finiscono lì valgono esattamente zero. Non è un prezzo su cui
                puoi operare, ma isola il movimento aggiuntivo.
              </>
            )}{" "}
            Clicca una riga per aprire i casi raggruppati per quanti altri estremi si sono formati, e
            un gruppo per vedere le occorrenze reali.
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-[var(--faint)]">
            Il campione include <strong>anche le fasi che si fermano a N</strong>: escluderle
            condizionerebbe il calcolo alla prosecuzione e gonfierebbe il residuo. È il motivo per
            cui la mediana è molto più bassa del p90. La differenza fra le due modalità è
            esattamente la distanza fra chiusura e {extremeWord} della barra osservata.
          </p>
        </div>
      )}
    </div>
  );
}
