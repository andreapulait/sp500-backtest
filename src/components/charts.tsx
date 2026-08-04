"use client";

import { useId, useMemo, useState } from "react";

import type { BreachCurvePoint, HistogramBin } from "@/lib/backtest/stats";
import { pct } from "@/lib/format";

const AXIS = "var(--line-strong)";

/**
 * Istogramma dei rendimenti a scadenza con le bande dei BEP sovrapposte.
 * Le barre oltre i BEP sono colorate per direzione: la superficie colorata e'
 * letteralmente la frequenza di sfondamento.
 */
export function ReturnsHistogram({
  bins,
  lowPct,
  highPct,
}: {
  bins: HistogramBin[];
  lowPct: number;
  highPct: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const { w, h, pad, maxShare, xScale } = useMemo(() => {
    const w = 720;
    const h = 220;
    const pad = { top: 8, right: 8, bottom: 26, left: 34 };
    const maxShare = Math.max(...bins.map((b) => b.share), 0.0001);
    const lo = bins[0]?.from ?? -1;
    const hi = bins[bins.length - 1]?.to ?? 1;
    const xScale = (v: number) =>
      pad.left + ((v - lo) / (hi - lo)) * (w - pad.left - pad.right);
    return { w, h, pad, maxShare, xScale };
  }, [bins]);

  if (bins.length === 0) return null;

  const plotH = h - pad.top - pad.bottom;
  const yScale = (share: number) => pad.top + plotH - (share / maxShare) * plotH;

  const ticks = [-0.06, -0.04, -0.02, 0, 0.02, 0.04, 0.06].filter(
    (t) => t >= bins[0].from && t <= bins[bins.length - 1].to
  );

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Distribuzione dei rendimenti a scadenza">
        {/* banda dentro i BEP */}
        <rect
          x={xScale(lowPct)}
          y={pad.top}
          width={Math.max(0, xScale(highPct) - xScale(lowPct))}
          height={plotH}
          fill="var(--accent-soft)"
          opacity={0.55}
        />

        {bins.map((b, i) => {
          const mid = (b.from + b.to) / 2;
          const beyondUp = mid > highPct;
          const beyondDown = mid < lowPct;
          const x = xScale(b.from);
          const bw = Math.max(1, xScale(b.to) - xScale(b.from) - 1);
          const y = yScale(b.share);
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={bw}
              height={pad.top + plotH - y}
              fill={beyondUp ? "var(--up)" : beyondDown ? "var(--down)" : "var(--muted)"}
              opacity={hover === null || hover === i ? 0.85 : 0.35}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}

        {/* BEP */}
        {[lowPct, highPct].map((v, i) => (
          <line
            key={i}
            x1={xScale(v)}
            x2={xScale(v)}
            y1={pad.top}
            y2={pad.top + plotH}
            stroke={i === 0 ? "var(--down)" : "var(--up)"}
            strokeWidth={1.5}
            strokeDasharray="3 2"
          />
        ))}

        <line x1={pad.left} x2={w - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} stroke={AXIS} />

        {ticks.map((t) => (
          <g key={t}>
            <line x1={xScale(t)} x2={xScale(t)} y1={pad.top + plotH} y2={pad.top + plotH + 4} stroke={AXIS} />
            <text
              x={xScale(t)}
              y={h - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--muted)"
              className="num"
            >
              {pct(t, 0, true)}
            </text>
          </g>
        ))}

        {[0, maxShare / 2, maxShare].map((s, i) => (
          <text key={i} x={pad.left - 5} y={yScale(s) + 3} textAnchor="end" fontSize={9} fill="var(--faint)" className="num">
            {pct(s, 1)}
          </text>
        ))}
      </svg>

      {hover !== null && (
        <div className="num pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-[11px] shadow-sm">
          {pct(bins[hover].from, 2, true)} … {pct(bins[hover].to, 2, true)} · {bins[hover].count} finestre ·{" "}
          {pct(bins[hover].share, 1)}
        </div>
      )}
    </div>
  );
}

/**
 * Frequenza storica di chiusura oltre una data distanza. Si legge in due modi:
 * fissata la distanza, dice la probabilita'; fissata la probabilita', dice
 * dove andrebbero messi i BEP.
 */
export function BreachCurveChart({
  curve,
  lowPct,
  highPct,
}: {
  curve: BreachCurvePoint[];
  lowPct: number;
  highPct: number;
}) {
  const gid = useId();
  const [hover, setHover] = useState<BreachCurvePoint | null>(null);

  if (curve.length === 0) return null;

  const w = 720;
  const h = 220;
  const pad = { top: 10, right: 8, bottom: 26, left: 38 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const maxD = curve[curve.length - 1].distance;
  const x = (d: number) => pad.left + (d / maxD) * plotW;
  const y = (p: number) => pad.top + plotH - p * plotH;

  const path = (key: "probEither" | "probUp" | "probDown") =>
    curve.map((c, i) => `${i === 0 ? "M" : "L"}${x(c.distance).toFixed(1)},${y(c[key]).toFixed(1)}`).join(" ");

  const avgBep = (Math.abs(lowPct) + Math.abs(highPct)) / 2;
  const atBep = curve.reduce((best, c) =>
    Math.abs(c.distance - avgBep) < Math.abs(best.distance - avgBep) ? c : best
  );

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        role="img"
        aria-label="Frequenza storica di sfondamento per distanza"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * w;
          const d = ((px - pad.left) / plotW) * maxD;
          setHover(
            curve.reduce((best, c) => (Math.abs(c.distance - d) < Math.abs(best.distance - d) ? c : best))
          );
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line x1={pad.left} x2={w - pad.right} y1={y(p)} y2={y(p)} stroke="var(--line)" />
            <text x={pad.left - 5} y={y(p) + 3} textAnchor="end" fontSize={9} fill="var(--faint)" className="num">
              {pct(p, 0)}
            </text>
          </g>
        ))}

        <path d={`${path("probEither")} L${x(maxD)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${gid})`} />
        <path d={path("probEither")} fill="none" stroke="var(--accent)" strokeWidth={1.8} />
        <path d={path("probUp")} fill="none" stroke="var(--up)" strokeWidth={1.2} strokeDasharray="4 3" />
        <path d={path("probDown")} fill="none" stroke="var(--down)" strokeWidth={1.2} strokeDasharray="4 3" />

        {/* dove cadono i BEP impostati */}
        <line x1={x(atBep.distance)} x2={x(atBep.distance)} y1={pad.top} y2={pad.top + plotH} stroke="var(--text)" strokeWidth={1} strokeDasharray="2 3" opacity={0.5} />
        <circle cx={x(atBep.distance)} cy={y(atBep.probEither)} r={3} fill="var(--text)" />

        {hover && (
          <>
            <line x1={x(hover.distance)} x2={x(hover.distance)} y1={pad.top} y2={pad.top + plotH} stroke="var(--accent)" strokeWidth={1} opacity={0.4} />
            <circle cx={x(hover.distance)} cy={y(hover.probEither)} r={3.5} fill="var(--accent)" />
          </>
        )}

        <line x1={pad.left} x2={w - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} stroke={AXIS} />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const d = maxD * f;
          return (
            <text key={f} x={x(d)} y={h - 8} textAnchor="middle" fontSize={10} fill="var(--muted)" className="num">
              ±{pct(d, 1)}
            </text>
          );
        })}
      </svg>

      <div className="num absolute right-2 top-1 rounded border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-[11px]">
        {hover ? (
          <>
            oltre ±{pct(hover.distance, 2)} → <strong>{pct(hover.probEither, 1)}</strong>
            <span className="text-[var(--muted)]">
              {" "}
              (↑{pct(hover.probUp, 1)} ↓{pct(hover.probDown, 1)})
            </span>
          </>
        ) : (
          <span className="text-[var(--muted)]">
            BEP a ±{pct(avgBep, 2)} → {pct(atBep.probEither, 1)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Barra orizzontale a tre segmenti: sotto / dentro / sopra. */
export function OutcomeBar({
  insideRate,
  breachUpRate,
  breachDownRate,
}: {
  insideRate: number;
  breachUpRate: number;
  breachDownRate: number;
}) {
  const seg = [
    { v: breachDownRate, color: "var(--down)", label: "sotto" },
    { v: insideRate, color: "var(--ok)", label: "dentro" },
    { v: breachUpRate, color: "var(--up)", label: "sopra" },
  ];

  return (
    <div className="flex h-6 w-full overflow-hidden rounded border border-[var(--line)]">
      {seg.map((s) => (
        <div
          key={s.label}
          className="num flex items-center justify-center text-[10px] text-white"
          style={{ width: `${s.v * 100}%`, background: s.color }}
          title={`${s.label}: ${pct(s.v, 2)}`}
        >
          {s.v > 0.09 ? pct(s.v, 1) : ""}
        </div>
      ))}
    </div>
  );
}
