/**
 * Scarica lo storico giornaliero da Yahoo Finance e lo scrive in src/data/
 * in formato colonnare compatto.
 *
 *   node scripts/fetch-data.mjs
 *
 * XSP non viene scaricato: la serie nativa parte dal 2021 ed e' troppo corta.
 * Viene derivata da SPX/10 a runtime (l'indice XSP e' definito come 1/10 di SPX).
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** period1 negativo = 1920, Yahoo restituisce tutto lo storico disponibile */
const PERIOD1 = -1577923200;

const SERIES = [
  { key: "spx", yahoo: "^GSPC", label: "S&P 500 Index" },
  { key: "spy", yahoo: "SPY", label: "SPDR S&P 500 ETF" },
  { key: "ndx", yahoo: "^NDX", label: "Nasdaq 100 Index" },
  { key: "vix", yahoo: "^VIX", label: "CBOE Volatility Index" },
];

async function fetchSeries(yahooSymbol) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}` +
    `?period1=${PERIOD1}&period2=9999999999&interval=1d`;

  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${yahooSymbol}: HTTP ${res.status}`);

  const json = await res.json();
  if (json.chart?.error) throw new Error(`${yahooSymbol}: ${json.chart.error.description}`);

  const result = json.chart.result?.[0];
  if (!result) throw new Error(`${yahooSymbol}: risposta senza result`);

  const ts = result.timestamp ?? [];
  const q = result.indicators.quote?.[0] ?? {};
  return { ts, open: q.open ?? [], high: q.high ?? [], low: q.low ?? [], close: q.close ?? [] };
}

const toISO = (epochSeconds) => new Date(epochSeconds * 1000).toISOString().slice(0, 10);

/**
 * Yahoo restituisce null sparsi e, sulle serie piu' antiche, barre in cui
 * open/high/low replicano il close. Teniamo solo le barre con close valido e
 * ricostruiamo i campi mancanti dal close: e' preferibile a scartare la barra,
 * che spezzerebbe la continuita' delle finestre rolling.
 */
function normalize(raw, key) {
  const date = [];
  const o = [];
  const h = [];
  const l = [];
  const c = [];

  const anomalies = { nullClose: 0, missingOHL: 0, highLowSwap: 0, nonPositive: 0 };
  let prevDate = "";

  for (let i = 0; i < raw.ts.length; i++) {
    const close = raw.close[i];
    if (close == null || !Number.isFinite(close)) {
      anomalies.nullClose++;
      continue;
    }
    if (close <= 0) {
      anomalies.nonPositive++;
      continue;
    }

    const d = toISO(raw.ts[i]);
    // Yahoo puo' restituire duplicati sull'ultima barra (sessione in corso)
    if (d === prevDate) {
      date.pop(); o.pop(); h.pop(); l.pop(); c.pop();
    }
    prevDate = d;

    let open = raw.open[i];
    let high = raw.high[i];
    let low = raw.low[i];

    if (![open, high, low].every((v) => v != null && Number.isFinite(v) && v > 0)) {
      anomalies.missingOHL++;
      open = open ?? close;
      high = high ?? close;
      low = low ?? close;
    }
    if (low > high) {
      anomalies.highLowSwap++;
      [high, low] = [low, high];
    }

    // il close deve stare dentro il range: se non lo e', allarghiamo il range
    high = Math.max(high, close, open);
    low = Math.min(low, close, open);

    date.push(d);
    o.push(round(open));
    h.push(round(high));
    l.push(round(low));
    c.push(round(close));
  }

  return { key, date, o, h, l, c, anomalies };
}

const round = (v) => Math.round(v * 100) / 100;

/** Controlli che devono fallire rumorosamente: indicano dati inutilizzabili. */
function assertIntegrity(s) {
  const n = s.date.length;
  if (n < 100) throw new Error(`${s.key}: solo ${n} barre, serie troppo corta`);

  for (let i = 1; i < n; i++) {
    if (s.date[i] <= s.date[i - 1]) {
      throw new Error(`${s.key}: date non monotone a ${s.date[i - 1]} -> ${s.date[i]}`);
    }
  }
  for (let i = 0; i < n; i++) {
    if (s.l[i] > s.c[i] || s.c[i] > s.h[i]) {
      throw new Error(`${s.key}: close fuori range il ${s.date[i]}`);
    }
  }

  // Salti di prezzo implausibili: su un indice un >30% overnight e' quasi
  // sempre un errore dati, non un evento. Segnaliamo senza bloccare, perche'
  // il 1987 e il 2020 producono legittimamente code larghe.
  const jumps = [];
  for (let i = 1; i < n; i++) {
    const r = s.c[i] / s.c[i - 1] - 1;
    if (Math.abs(r) > 0.3) jumps.push(`${s.date[i]} ${(r * 100).toFixed(1)}%`);
  }
  return jumps;
}

/** Buchi di calendario oltre i 10 giorni: chiusure di borsa eccezionali o dati mancanti. */
function calendarGaps(s) {
  const gaps = [];
  for (let i = 1; i < s.date.length; i++) {
    const days = (Date.parse(s.date[i]) - Date.parse(s.date[i - 1])) / 86_400_000;
    if (days > 10) gaps.push(`${s.date[i - 1]} -> ${s.date[i]} (${days}g)`);
  }
  return gaps;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = [];

  for (const { key, yahoo, label } of SERIES) {
    process.stdout.write(`${key.padEnd(4)} ${yahoo.padEnd(7)} ... `);

    const raw = await fetchSeries(yahoo);
    const s = normalize(raw, key);
    const jumps = assertIntegrity(s);
    const gaps = calendarGaps(s);

    const payload = {
      symbol: key.toUpperCase(),
      label,
      source: `yahoo:${yahoo}`,
      fetchedAt: new Date().toISOString(),
      date: s.date,
      o: s.o,
      h: s.h,
      l: s.l,
      c: s.c,
    };

    const file = join(OUT_DIR, `${key}.json`);
    await writeFile(file, JSON.stringify(payload));

    const bytes = Buffer.byteLength(JSON.stringify(payload));
    console.log(
      `${s.date.length} barre  ${s.date[0]} -> ${s.date[s.date.length - 1]}  ${(bytes / 1024 / 1024).toFixed(2)} MB`
    );

    const notes = [];
    if (s.anomalies.nullClose) notes.push(`${s.anomalies.nullClose} barre senza close (scartate)`);
    if (s.anomalies.missingOHL) notes.push(`${s.anomalies.missingOHL} barre con OHL ricostruito dal close`);
    if (s.anomalies.highLowSwap) notes.push(`${s.anomalies.highLowSwap} barre con high/low invertiti`);
    if (s.anomalies.nonPositive) notes.push(`${s.anomalies.nonPositive} barre con prezzo <= 0`);
    for (const note of notes) console.log(`     ! ${note}`);
    if (gaps.length) console.log(`     ! ${gaps.length} buchi >10g, primo: ${gaps[0]}`);
    if (jumps.length) console.log(`     ! ${jumps.length} salti >30%: ${jumps.slice(0, 3).join(", ")}`);

    manifest.push({
      symbol: key.toUpperCase(),
      label,
      bars: s.date.length,
      from: s.date[0],
      to: s.date[s.date.length - 1],
    });
  }

  await writeFile(
    join(OUT_DIR, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), series: manifest }, null, 2)
  );
  console.log("\nmanifest.json scritto.");
}

main().catch((err) => {
  console.error("\nIngestion fallita:", err.message);
  process.exit(1);
});
