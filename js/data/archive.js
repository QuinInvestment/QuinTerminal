// The daily archive written by pipeline/snapshot.mjs (GitHub Actions) and
// served from the app's own origin under data/. Before the workflow's first
// run the files do not exist: callers get null / [] and say so.

import { getJSON, getText, parseCSV } from "../core/fetcher.js";
import * as health from "../core/health.js";

const BASE = new URL("../../data/", import.meta.url).href;

async function load(file, as, ttl, { optional = false } = {}) {
  try {
    return await (as === "json" ? getJSON : getText)(BASE + file, { ttl, source: optional ? undefined : "archive", timeout: 15e3 });
  } catch (e) {
    if (/HTTP 404/.test(e.message)) {
      // an optional file (e.g. the EIA snapshot without an EIA_KEY secret) says nothing about the rest
      if (!optional) health.setState("archive", "off", "not created yet: enable the Daily snapshot workflow (see README)");
      return null;
    }
    throw e;
  }
}

export const manifest = () => load("manifest.json", "json", 10 * 60e3);
export const curveLatest = () => load("curve/latest.json", "json", 15 * 60e3);
/** EIA snapshot written by the pipeline's eia job: "weekly" | "spot" | "steo" | "products", or null */
export const eiaSnapshot = (name) => load(`eia/${name}.json`, "json", 60 * 60e3, { optional: true });

/** rows of data/history/<name>.csv as objects (strings), [] when absent */
export async function history(name) {
  const text = await load(`history/${name}.csv`, "text", 15 * 60e3);
  return text ? parseCSV(text) : [];
}

const n = (v) => (v === "" || v == null ? NaN : +v);

/**
 * Calendar-spread history from data/history/curve.csv: for each snapshot date
 * and root, contracts sorted by last trade; M1 is the first still trading.
 * Returns { CL: [{date, m1, m1m2, m1m6, m1m12}], BZ: [...] }.
 */
export function spreads(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.date + "|" + r.root;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ ...r, price: n(r.price) });
  }
  const out = { CL: [], BZ: [] };
  for (const [k, list] of by) {
    const [date, root] = k.split("|");
    const live = list.filter((c) => c.last_trade >= date && Number.isFinite(c.price)).sort((a, b) => (a.last_trade < b.last_trade ? -1 : 1));
    if (live.length < 2 || !out[root]) continue;
    const at = (i) => live[i]?.price;
    out[root].push({ date, m1: at(0), m1m2: at(0) - at(1), m1m6: live.length > 5 ? at(0) - at(5) : NaN, m1m12: live.length > 11 ? at(0) - at(11) : NaN, contracts: live.length });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

/**
 * Score archived forecasts whose target date has passed against the perp's
 * daily close on that date. `closes` maps ISO date -> close for the instrument.
 * Pinball loss averaged over the 5%, 25%, 50%, 75%, 95% quantiles; the naive
 * benchmark is a driftless lognormal at the 20-day realised vol of the day.
 */
export const QS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.6448536, -0.6744898, 0, 0.6744898, 1.6448536];
const pinball = (y, qs) => qs.reduce((s, q, i) => s + Math.max(QS[i] * (y - q), (QS[i] - 1) * (y - q)), 0) / qs.length;

export function score(forecasts, closesByInst, today = new Date().toISOString().slice(0, 10)) {
  const done = [];
  for (const f of forecasts) {
    if (!(f.target < today)) continue;
    const closes = closesByInst[f.inst];
    const y = closes?.get(f.target);
    if (!Number.isFinite(y)) continue;
    const s0 = n(f.s0), h = n(f.h), rv = n(f.rv20);
    const g = ["g_q05", "g_q25", "g_q50", "g_q75", "g_q95"].map((c) => n(f[c]));
    const m = ["m_q05", "m_q25", "m_q50", "m_q75", "m_q95"].map((c) => n(f[c]));
    const sd = rv * Math.sqrt(h / 252);
    const naive = Z.map((z) => s0 * Math.exp(-0.5 * sd * sd + sd * z));
    done.push({
      ...f, y, h,
      g, m, naive,
      lossG: pinball(y, g), lossM: pinball(y, m), lossN: pinball(y, naive),
      in90G: y >= g[0] && y <= g[4], in50G: y >= g[1] && y <= g[3],
      in90M: y >= m[0] && y <= m[4], in50M: y >= m[1] && y <= m[3],
    });
  }
  return done;
}

export function summarise(scored) {
  const groups = new Map();
  for (const s of scored) {
    const k = s.inst + "|" + s.h;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return [...groups.entries()].map(([k, xs]) => {
    const [inst, h] = k.split("|");
    const lossG = avg(xs.map((x) => x.lossG)), lossM = avg(xs.map((x) => x.lossM)), lossN = avg(xs.map((x) => x.lossN));
    return {
      inst, h: +h, n: xs.length,
      cov90G: avg(xs.map((x) => +x.in90G)), cov50G: avg(xs.map((x) => +x.in50G)),
      cov90M: avg(xs.map((x) => +x.in90M)), cov50M: avg(xs.map((x) => +x.in50M)),
      lossG, lossM, lossN, skillG: 1 - lossG / lossN, skillM: 1 - lossM / lossN,
    };
  }).sort((a, b) => (a.inst === b.inst ? a.h - b.h : a.inst < b.inst ? -1 : 1));
}
