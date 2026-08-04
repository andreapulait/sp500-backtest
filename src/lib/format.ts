const nf = (min: number, max: number) =>
  new Intl.NumberFormat("it-IT", { minimumFractionDigits: min, maximumFractionDigits: max });

const int = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });

/** Percentuale con segno opzionale: 0.0123 -> "1,23%" */
export function pct(v: number | null | undefined, digits = 2, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = nf(digits, digits).format(v * 100);
  return `${signed && v > 0 ? "+" : ""}${s}%`;
}

/** Punti indice: 6842.5 -> "6.842,50" */
export function points(v: number | null | undefined, digits = 2, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${signed && v > 0 ? "+" : ""}${nf(digits, digits).format(v)}`;
}

/** Deviazioni standard: 0.618 -> "0,62 σ" */
export function sd(v: number | null | undefined, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${signed && v > 0 ? "+" : ""}${nf(2, 2).format(v)} σ`;
}

export function count(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return int.format(v);
}

/** ISO -> "4 ago 2026" */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
