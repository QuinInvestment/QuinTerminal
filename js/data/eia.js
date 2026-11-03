// U.S. Energy Information Administration, API v2.
// One request returns every weekly balance series (the WPSR); daily spot
// prices and the Short-Term Energy Outlook take one or a few more. Works with
// DEMO_KEY (shared, ~30 calls/hour per IP) — a free personal key is better.

import { getJSON } from "../core/fetcher.js";
import { settings } from "../core/settings.js";
import * as health from "../core/health.js";
import { mean, std, percentileRank } from "../core/stats.js";
import { eiaSnapshot } from "./archive.js";

const BASE = "https://api.eia.gov/v2";
const key = () => (settings.eiaKey || "DEMO_KEY").trim();

export const WEEKLY = {
  WCESTUS1: { name: "US commercial crude stocks", unit: "kb", kind: "stock", invert: true },
  W_EPC0_SAX_YCUOK_MBBL: { name: "Cushing, OK crude stocks", unit: "kb", kind: "stock", invert: true },
  WCSSTUS1: { name: "Strategic Petroleum Reserve", unit: "kb", kind: "stock", invert: true },
  WGTSTUS1: { name: "Total gasoline stocks", unit: "kb", kind: "stock", invert: true },
  WDISTUS1: { name: "Distillate stocks", unit: "kb", kind: "stock", invert: true },
  WKJSTUS1: { name: "Jet fuel stocks", unit: "kb", kind: "stock", invert: true },
  WCRFPUS2: { name: "US crude production", unit: "kb/d", kind: "flow" },
  WCRIMUS2: { name: "Crude imports", unit: "kb/d", kind: "flow" },
  WCREXUS2: { name: "Crude exports", unit: "kb/d", kind: "flow" },
  WTTNTUS2: { name: "Net imports, crude + products", unit: "kb/d", kind: "flow" },
  WCRRIUS2: { name: "Refinery crude runs", unit: "kb/d", kind: "flow" },
  WPULEUS3: { name: "Refinery utilisation", unit: "%", kind: "rate" },
  WRPUPUS2: { name: "Total product supplied", unit: "kb/d", kind: "demand" },
  WGFUPUS2: { name: "Gasoline supplied", unit: "kb/d", kind: "demand" },
  WDIUPUS2: { name: "Distillate supplied", unit: "kb/d", kind: "demand" },
  WKJUPUS2: { name: "Jet fuel supplied", unit: "kb/d", kind: "demand" },
};

// brackets stay literal and spaces become %20: the exact form the API is tested with
export const qs = (pairs) => pairs.map(([k, v]) => `${encodeURIComponent(k).replace(/%5B/g, "[").replace(/%5D/g, "]")}=${encodeURIComponent(v)}`).join("&");

function url(route, params) {
  return `${BASE}/${route}/data/?${qs([["api_key", key()], ...params])}`;
}

async function paged(route, baseParams, { ttl, cacheKey, maxPages = 6 }) {
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const params = [...baseParams, ["length", "5000"], ["offset", String(page * 5000)]];
    let j;
    try {
      j = await getJSON(url(route, params), { ttl, persist: true, source: "eia", key: `${cacheKey}:p${page}:${key() === "DEMO_KEY" ? "demo" : "own"}`, timeout: 30e3 });
    } catch (e) {
      if (/HTTP 429/.test(e.message)) {
        throw new Error(key() === "DEMO_KEY"
          ? "EIA rate limit reached: the shared DEMO_KEY allows only a few dozen calls an hour per network. A free personal key (eia.gov/opendata, one minute) removes the limit: paste it in SYS"
          : "EIA rate limit reached (HTTP 429); the terminal retries on the next refresh");
      }
      throw e;
    }
    if (j?.error) throw new Error(typeof j.error === "string" ? j.error : JSON.stringify(j.error).slice(0, 120));
    const data = j?.response?.data || [];
    rows.push(...data);
    const total = +j?.response?.total || 0;
    if (data.length < 5000 || rows.length >= total) break;
  }
  return rows;
}

function bySeries(rows, idField = "series") {
  const out = {};
  const meta = {};
  for (const r of rows) {
    const id = r[idField];
    const v = r.value == null || r.value === "" ? NaN : +r.value;
    if (!Number.isFinite(v)) continue;
    (out[id] ||= []).push({ t: r.period, v });
    meta[id] ||= { units: r.units || r.unit, desc: r["series-description"] || r.seriesDescription || r.seriesName };
  }
  for (const id of Object.keys(out)) out[id].sort((a, b) => (a.t < b.t ? -1 : 1));
  return { series: out, meta };
}

// ---------------------------------------------------------------- daily archive
// The Daily snapshot workflow (pipeline/snapshot.mjs, job "eia") stores these
// three datasets under data/eia/ with the repository's own EIA key. The app
// falls back to that copy when the live API fails (DEMO_KEY rate limit), and
// reads it first when only DEMO_KEY is available and the copy is current, so
// a visitor without a key spends no shared calls on history.

/** {series: {id: [{t, v}]}, meta} -> compact {series: {id: [[t, v]]}, meta} */
export function pack({ series, meta }) {
  return { series: Object.fromEntries(Object.entries(series).map(([id, pts]) => [id, pts.map((p) => [p.t, p.v])])), meta };
}
export function unpack(a) {
  return { series: Object.fromEntries(Object.entries(a.series || {}).map(([id, pts]) => [id, pts.map(([t, v]) => ({ t, v }))])), meta: a.meta || {}, archivedAt: a.asOf || null };
}

async function withArchive(name, live, { useArchive = true, preferIf } = {}) {
  if (!useArchive) return live();
  const snap = () => eiaSnapshot(name).catch(() => null);
  if (preferIf && key() === "DEMO_KEY") {
    const a = await snap();
    if (a?.series && preferIf(a)) {
      health.report("eia", { ok: true, ms: 0, note: `daily archive of ${String(a.asOf).slice(0, 10)} (no personal key, so no shared DEMO_KEY calls)` });
      return unpack(a);
    }
  }
  try {
    return await live();
  } catch (e) {
    const a = await snap();
    if (!a?.series) throw e;
    health.report("eia", { ok: true, stale: true, note: `live API failed (${String(e.message).slice(0, 60)}…); showing the daily archive of ${String(a.asOf).slice(0, 10)}` });
    return unpack(a);
  }
}

const daysSince = (iso) => (Date.now() - Date.parse(String(iso).slice(0, 10) + "T00:00:00Z")) / 86400000;

/** Weekly petroleum status report series since 2018. Live first: Wednesday releases matter. */
export async function weekly({ archive = true } = {}) {
  const params = [["frequency", "weekly"], ["data[0]", "value"], ["start", "2018-01-01"], ["sort[0][column]", "period"], ["sort[0][direction]", "asc"]];
  for (const s of Object.keys(WEEKLY)) params.push(["facets[series][]", s]);
  return withArchive("weekly", async () => bySeries(await paged("petroleum/sum/sndw", params, { ttl: 6 * 3600e3, cacheKey: "eia:weekly" })), { useArchive: archive });
}

/** Daily spot WTI (Cushing) and Brent (Europe), full history. EIA itself lags about a week. */
export async function spot({ archive = true } = {}) {
  const params = [["frequency", "daily"], ["data[0]", "value"], ["facets[series][]", "RWTC"], ["facets[series][]", "RBRTE"], ["start", "1987-05-01"], ["sort[0][column]", "period"], ["sort[0][direction]", "asc"]];
  return withArchive("spot", async () => bySeries(await paged("petroleum/pri/spt", params, { ttl: 12 * 3600e3, cacheKey: "eia:spot" })), {
    useArchive: archive,
    preferIf: (a) => { const b = a.series?.RBRTE; return b?.length > 1000 && daysSince(b[b.length - 1][0]) <= 10; },
  });
}

/**
 * Short-Term Energy Outlook series, monthly history and forecast (million b/d
 * unless stated). The aggregates were checked against published uses of the
 * API; the country crude series follow STEO's naming (COPR_ + country code) and
 * are optional: the screens show whichever EIA returns.
 */
export const STEO = {
  BREPUUS: { name: "Brent spot price", unit: "$/b" },
  WTIPUUS: { name: "WTI spot price", unit: "$/b" },
  PAPR_WORLD: { name: "World liquids production" },
  PATC_WORLD: { name: "World liquids consumption" },
  PAPR_OPEC: { name: "OPEC liquids production" },
  PAPR_NONOPEC: { name: "Non-OPEC liquids production" },
  PATC_OECD: { name: "OECD consumption" },
  PATC_NON_OECD: { name: "Non-OECD consumption" },
  COPR_OPEC: { name: "OPEC crude production" },
  COPR_OPECPLUS: { name: "OPEC+ crude production" },
  COPR_NONOPECPLUS_XUS: { name: "Non-OPEC+ crude production excluding the US" },
  COPC_OPEC: { name: "OPEC crude production capacity" },
  COPS_OPEC: { name: "OPEC spare crude capacity" },
  COPS_OPEC_R05: { name: "OPEC Middle East spare capacity" },
  PADI_OPEC: { name: "Unplanned outages, OPEC" },
  PADI_NONOPEC: { name: "Unplanned outages, non-OPEC" },
  COPRPUS: { name: "US crude production" },
};
export const PRODUCERS = {
  COPR_SA: "Saudi Arabia", COPR_IZ: "Iraq", COPR_TC: "United Arab Emirates", COPR_KU: "Kuwait", COPR_IR: "Iran",
  COPR_RS: "Russia", COPR_KZ: "Kazakhstan", COPR_CA: "Canada", COPR_BR: "Brazil", COPR_NO: "Norway", COPR_GY: "Guyana",
  COPR_LY: "Libya", COPR_NI: "Nigeria", COPR_VE: "Venezuela", COPR_CH: "China",
};

export async function steo({ archive = true } = {}) {
  const ids = [...Object.keys(STEO), ...Object.keys(PRODUCERS)];
  const params = [["frequency", "monthly"], ["data[0]", "value"], ["start", "2019-01"], ["sort[0][column]", "period"], ["sort[0][direction]", "asc"]];
  for (const s of ids) params.push(["facets[seriesId][]", s]);
  return withArchive("steo", async () => bySeries(await paged("steo", params, { ttl: 12 * 3600e3, cacheKey: "eia:steo", maxPages: 2 }), "seriesId"), {
    useArchive: archive,
    preferIf: (a) => daysSince(a.asOf) <= 7,
  });
}

/**
 * Refined product spot prices, weekly averages since 2018 ($/gal), with WTI and
 * Brent ($/b) for the cracks. Weekly keeps it to one call. ULSD and jet ids
 * follow EIA's spot-price naming; the gasoline and heating-oil ids were checked.
 */
export const PRODUCTS = {
  EER_EPMRU_PF4_Y35NY_DPG: { name: "NY Harbor gasoline (conventional regular)", short: "NYH gasoline", leg: "gasoline" },
  EER_EPMRU_PF4_RGC_DPG: { name: "US Gulf Coast gasoline (conventional regular)", short: "USGC gasoline", leg: "gasoline" },
  EER_EPD2DXL0_PF4_Y35NY_DPG: { name: "NY Harbor ultra-low sulfur diesel", short: "NYH ULSD", leg: "diesel" },
  EER_EPD2DXL0_PF4_RGC_DPG: { name: "US Gulf Coast ultra-low sulfur diesel", short: "USGC ULSD", leg: "diesel" },
  EER_EPD2F_PF4_Y35NY_DPG: { name: "NY Harbor No. 2 heating oil", short: "NYH heating oil", leg: "diesel" },
  EER_EPJK_PF4_RGC_DPG: { name: "US Gulf Coast jet fuel (kerosene-type)", short: "USGC jet", leg: "jet" },
};
export async function products({ archive = true } = {}) {
  const params = [["frequency", "weekly"], ["data[0]", "value"], ["start", "2018-01-01"], ["sort[0][column]", "period"], ["sort[0][direction]", "asc"]];
  for (const s of [...Object.keys(PRODUCTS), "RWTC", "RBRTE"]) params.push(["facets[series][]", s]);
  return withArchive("products", async () => bySeries(await paged("petroleum/pri/spt", params, { ttl: 12 * 3600e3, cacheKey: "eia:products", maxPages: 2 })), {
    useArchive: archive,
    preferIf: (a) => daysSince(a.asOf) <= 8,
  });
}

/** Weekly crack spreads in $/b from EIA spot prices ($/gal for products, $/b for crude). */
export function crackSpreads(S) {
  const G = "EER_EPMRU_PF4_Y35NY_DPG", D = "EER_EPD2DXL0_PF4_Y35NY_DPG", HO = "EER_EPD2F_PF4_Y35NY_DPG", J = "EER_EPJK_PF4_RGC_DPG";
  const map = (id) => new Map((S[id] || []).map((p) => [p.t, p.v]));
  const g = map(G), dU = map(D), dH = map(HO), j = map(J), w = map("RWTC"), b = map("RBRTE");
  const dieselLeg = dU.size ? D : HO;
  const dl = dU.size ? dU : dH;
  const weeks = [...new Set([...(S.RBRTE || []), ...(S.RWTC || [])].map((p) => p.t))].sort();
  const rows = [];
  for (const t of weeks) {
    const G1 = g.get(t), D1 = dl.get(t), J1 = j.get(t), W1 = w.get(t), B1 = b.get(t);
    const r = { t, k321: NaN, diesel: NaN, gas: NaN, jet: NaN };
    if ([G1, D1, W1].every(Number.isFinite)) r.k321 = (2 * G1 * 42 + D1 * 42 - 3 * W1) / 3;
    if (Number.isFinite(D1) && Number.isFinite(B1)) r.diesel = D1 * 42 - B1;
    if (Number.isFinite(G1) && Number.isFinite(B1)) r.gas = G1 * 42 - B1;
    if (Number.isFinite(J1) && Number.isFinite(B1)) r.jet = J1 * 42 - B1;
    if ([r.k321, r.diesel, r.gas, r.jet].some(Number.isFinite)) rows.push(r);
  }
  return { rows, dieselLeg };
}

// ---------------------------------------------------------------- seasonal analysis
export function isoWeek(dateStr) {
  const d = new Date(String(dateStr).slice(0, 10) + "T00:00:00Z");
  const dayNum = d.getUTCDay() || 7;           // Mon=1 .. Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);   // Thursday of the same ISO week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}

/**
 * EIA-style five-year range: for each observation, the min / max / mean of the
 * same ISO week in the five previous years.
 */
export function seasonal(points, years = 5) {
  const idx = new Map(); // "year-week" -> value
  for (const p of points) {
    const { year, week } = isoWeek(p.t);
    idx.set(`${year}-${week}`, p.v);
  }
  const look = (y, w) => idx.get(`${y}-${w}`) ?? idx.get(`${y}-${w === 53 ? 52 : w}`);
  return points.map((p) => {
    const { year, week } = isoWeek(p.t);
    const hist = [];
    for (let y = year - years; y < year; y++) { const v = look(y, week); if (Number.isFinite(v)) hist.push(v); }
    return {
      t: p.t, v: p.v, n: hist.length,
      min: hist.length ? Math.min(...hist) : NaN,
      max: hist.length ? Math.max(...hist) : NaN,
      avg: hist.length ? mean(hist) : NaN,
      sd: hist.length > 2 ? std(hist) : NaN,
      lastYear: look(year - 1, week),
    };
  });
}

/** Summary row for the balance sheet table. */
export function summarise(id, points) {
  if (!points || points.length < 2) return null;
  const s = seasonal(points);
  const last = s[s.length - 1], prev = s[s.length - 2];
  const dev = last.v - last.avg;
  const histSame = [];
  const { week } = isoWeek(last.t);
  for (const p of points) { const w = isoWeek(p.t); if (w.week === week && w.year < isoWeek(last.t).year && w.year >= isoWeek(last.t).year - 5) histSame.push(p.v); }
  // change vs the usual change for this week (seasonal surprise)
  const prevS = s[s.length - 2];
  const normalChange = Number.isFinite(last.avg) && Number.isFinite(prevS.avg) ? last.avg - prevS.avg : NaN;
  return {
    id, ...WEEKLY[id], t: last.t, v: last.v, wow: last.v - prev.v,
    avg5: last.avg, min5: last.min, max5: last.max, dev, devPct: last.avg ? dev / last.avg : NaN,
    z: Number.isFinite(last.sd) && last.sd > 0 ? dev / last.sd : NaN,
    pctile: percentileRank(last.v, histSame),
    yoy: Number.isFinite(last.lastYear) ? last.v - last.lastYear : NaN,
    surprise: last.v - prev.v - normalChange,
    normalChange,
  };
}

export function rollingMean(points, w = 4) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    if (i < w - 1) continue;
    let s = 0;
    for (let j = i - w + 1; j <= i; j++) s += points[j].v;
    out.push({ t: points[i].t, v: s / w });
  }
  return out;
}
