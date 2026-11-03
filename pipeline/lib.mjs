// Small helpers for the snapshot job: retrying fetch, CSV read / upsert.

import fs from "node:fs/promises";
import path from "node:path";

// QT_BACKOFF_MS shortens retry waits in tests
const BACKOFF = process.env.QT_BACKOFF_MS != null ? +process.env.QT_BACKOFF_MS : 1500;

export const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export async function fetchRetry(url, { tries = 3, timeout = 20e3, headers = {} } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(timeout) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      last = e;
      await new Promise((res) => setTimeout(res, BACKOFF * (i + 1)));
    }
  }
  throw last;
}

const q = (v) => {
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "";
  const s = typeof v === "number" ? String(+v.toPrecision(10)) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(header, rows) {
  return [header.join(","), ...rows.map((r) => header.map((k) => q(r[k])).join(","))].join("\n") + "\n";
}

export function parseCsv(text) {
  const lines = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") lines.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); lines.push(row); }
  if (!lines.length) return [];
  const [head, ...body] = lines;
  return body.map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""])));
}

export async function readCsv(file) {
  try { return parseCsv(await fs.readFile(file, "utf8")); } catch { return []; }
}

/**
 * Insert or replace rows keyed by keyCols, keep the file sorted by sortCols.
 * Re-running the job on the same day therefore replaces that day's rows.
 */
export async function upsertCsv(file, header, rows, keyCols, sortCols = keyCols) {
  const old = await readCsv(file);
  const k = (r) => keyCols.map((c) => String(r[c])).join("|");
  const fresh = new Set(rows.map(k));
  const merged = [...old.filter((r) => !fresh.has(k(r))), ...rows];
  merged.sort((a, b) => {
    for (const c of sortCols) {
      const x = a[c], y = b[c];
      if (String(x) === String(y)) continue;
      const nx = Number(x), ny = Number(y);
      if (x !== "" && y !== "" && Number.isFinite(nx) && Number.isFinite(ny)) return nx - ny;
      return String(x) < String(y) ? -1 : 1;
    }
    return 0;
  });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, toCsv(header, merged));
  return merged.length;
}

export async function writeJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 1) + "\n");
}

/**
 * JSON with one [t, v] point per line under "series": compact (about 22 bytes
 * a point) and append-friendly, so a daily update is a few-line git diff.
 */
export async function writeSeriesJson(file, { series, ...head }) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const top = JSON.stringify(head).slice(0, -1);
  const body = Object.entries(series).map(([id, pts]) => `${JSON.stringify(id)}:[\n${pts.map((p) => JSON.stringify(p)).join(",\n")}\n]`).join(",\n");
  await fs.writeFile(file, `${top}${top.length > 1 ? "," : ""}"series":{\n${body}\n}}\n`);
}

export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** n weekdays after an ISO date (exchange holidays ignored). */
export function addWeekdays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}
