// IMF PortWatch: daily ship transits through the world's maritime chokepoints,
// counted from AIS by the IMF and Oxford with the UN Global Platform. Public
// ArcGIS feature service, no key. PortWatch publishes weekly, so the latest day
// is usually three to nine days old.
// Cite: "Sources: UN Global Platform; IMF PortWatch (portwatch.imf.org)".

import { getJSON } from "../core/fetcher.js";

const QUERY = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";
export const ATTRIBUTION = "IMF PortWatch, UN Global Platform";

/** The chokepoints that matter for crude and products, matched on PortWatch's names. */
export const OIL_CHOKEPOINTS = [
  { id: "hormuz", like: "Hormuz", name: "Strait of Hormuz", place: "HORMUZ", role: "Gulf exports: about a fifth of world oil before 2026" },
  { id: "malacca", like: "Malacca", name: "Strait of Malacca", place: "MALACCA", role: "Middle East and Africa to China, Japan and Korea" },
  { id: "bab", like: "Mandeb", name: "Bab el-Mandeb", place: "BAB", role: "Red Sea to the Gulf of Aden; Yanbu exports" },
  { id: "suez", like: "Suez", name: "Suez Canal", place: "SUEZ", role: "Red Sea to the Mediterranean, with the SUMED pipeline" },
  { id: "cape", like: "Good Hope", name: "Cape of Good Hope", place: "CAPE", role: "The diversion route around Africa" },
  { id: "bosporus", like: "Bosporus", name: "Bosporus", place: "BLACKSEA", role: "Russian and Kazakh Black Sea exports" },
  { id: "danish", like: "Oresund", name: "Øresund (Danish straits)", place: "BALTIC", role: "Baltic exports; most tankers use the Great Belt" },
  { id: "gibraltar", like: "Gibraltar", name: "Strait of Gibraltar", place: null, role: "Mediterranean to the Atlantic" },
  { id: "panama", like: "Panama", name: "Panama Canal", place: null, role: "US Gulf Coast to Asia and the Pacific coast" },
  { id: "dover", like: "Dover", name: "Dover Strait", place: null, role: "North Sea and Baltic to the Atlantic" },
  { id: "lombok", like: "Lombok", name: "Lombok Strait", place: null, role: "The deep-water route for the largest tankers" },
  { id: "taiwan", like: "Taiwan", name: "Taiwan Strait", place: null, role: "Crude and products into China's east coast" },
];

const FIELDS = "year,month,day,portid,portname,n_tanker,n_total,capacity_tanker";

async function pages(where, key) {
  const out = [];
  for (let page = 0, offset = 0; page < 16; page++) {
    const qs = new URLSearchParams({ where, outFields: FIELDS, returnGeometry: "false", resultOffset: String(offset), resultRecordCount: "2000", f: "json" });
    const j = await getJSON(`${QUERY}?${qs}`, { ttl: 12 * 3600e3, persist: true, source: "portwatch", key: `pw:${key}:${offset}`, timeout: 30e3, via: "auto" });
    if (j?.error) throw new Error(`PortWatch: ${j.error.message || j.error.code || "query refused"}`);
    const feats = j?.features || [];
    for (const f of feats) out.push(f.attributes || f);
    if (!j.exceededTransferLimit || !feats.length) break;
    offset += feats.length;
  }
  return out;
}

/**
 * Daily rows for the oil chokepoints over the last `days` days:
 * [{ id, name, portid, rows: [{ t, tk, tot, cap }] }]. Falls back to every
 * chokepoint (no name filter) if the service refuses the LIKE filter.
 */
export const DAYS = 760; // two years, so every day of the last year has its year-ago match
export async function daily({ days = DAYS } = {}) {
  const from = new Date(Date.now() - days * 86400000);
  const y0 = from.getUTCFullYear(), m0 = from.getUTCMonth() + 1;
  const window = `(year > ${y0} OR (year = ${y0} AND month >= ${m0}))`;
  const names = OIL_CHOKEPOINTS.map((c) => `portname LIKE '%${c.like}%'`).join(" OR ");
  let rows;
  try {
    rows = await pages(`(${names}) AND ${window}`, `oil:${y0}-${m0}`);
  } catch (e) {
    rows = await pages(window, `all:${y0}-${m0}`);
  }
  if (!rows.length) throw new Error("PortWatch returned no transits for the period");
  const by = new Map();
  for (const r of rows) {
    const c = OIL_CHOKEPOINTS.find((x) => String(r.portname || "").toLowerCase().includes(x.like.toLowerCase()));
    if (!c) continue;
    const t = isoDay(r);
    if (!t) continue;
    if (!by.has(c.id)) by.set(c.id, { ...c, portid: r.portid, portname: r.portname, map: new Map() });
    by.get(c.id).map.set(t, { t, tk: num(r.n_tanker), tot: num(r.n_total), cap: num(r.capacity_tanker) });
  }
  return OIL_CHOKEPOINTS.filter((c) => by.has(c.id)).map((c) => {
    const e = by.get(c.id);
    return { ...c, portid: e.portid, portname: e.portname, rows: [...e.map.values()].sort((a, b) => (a.t < b.t ? -1 : 1)) };
  });
}

const num = (v) => (v == null || v === "" ? NaN : +v);
function isoDay(r) {
  if (r.year && r.month && r.day) return `${r.year}-${String(r.month).padStart(2, "0")}-${String(r.day).padStart(2, "0")}`;
  if (Number.isFinite(+r.date)) return new Date(+r.date).toISOString().slice(0, 10);
  return null;
}

// ---------------------------------------------------------------- analytics (pure, tested)
const DAY = 86400000;
const ms = (iso) => Date.parse(iso + "T00:00:00Z");

/** Trailing n-day mean of field f, one point per day that has a full window. */
export function trailing(rows, f = "tk", n = 7) {
  const out = [];
  for (let i = n - 1; i < rows.length; i++) {
    let s = 0, k = 0;
    for (let j = i - n + 1; j <= i; j++) if (Number.isFinite(rows[j][f])) { s += rows[j][f]; k++; }
    if (k >= Math.ceil(n * 0.7)) out.push({ t: rows[i].t, v: s / k });
  }
  return out;
}

/**
 * Board line for one chokepoint: the last 7-day mean of tanker transits, the
 * same seven days 52 weeks earlier, the prior four weeks, and the series a
 * chart needs. Weeks are aligned (364 days) so weekdays match.
 */
export function summarise(cp, f = "tk") {
  const rows = cp.rows;
  if (!rows?.length) return null;
  const ma = trailing(rows, f, 7);
  const last = ma[ma.length - 1];
  if (!last) return null;
  const at = new Map(ma.map((p) => [p.t, p.v]));
  const ly = at.get(new Date(ms(last.t) - 364 * DAY).toISOString().slice(0, 10));
  const prior = ma.filter((p) => ms(p.t) <= ms(last.t) - 7 * DAY && ms(p.t) > ms(last.t) - 35 * DAY).map((p) => p.v);
  const prior4 = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : NaN;
  const lastYear = ma.map((p) => ({ t: new Date(ms(p.t) + 364 * DAY).toISOString().slice(0, 10), v: p.v })).filter((p) => p.t <= last.t && ms(p.t) >= ms(last.t) - 365 * DAY);
  return {
    id: cp.id, name: cp.name, role: cp.role, place: cp.place, asOf: last.t,
    last: last.v, ly: Number.isFinite(ly) ? ly : NaN, prior4,
    yoy: Number.isFinite(ly) && ly > 0 ? last.v / ly - 1 : NaN,
    wow4: Number.isFinite(prior4) && prior4 > 0 ? last.v / prior4 - 1 : NaN,
    ma: ma.filter((p) => ms(p.t) >= ms(last.t) - 365 * DAY),
    lastYear,
    daily: rows.filter((r) => ms(r.t) >= ms(last.t) - 365 * DAY),
  };
}
