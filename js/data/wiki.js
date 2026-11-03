// Public attention index: daily English Wikipedia pageviews for the places and
// institutions that matter to oil. Spikes in reading usually accompany — and
// sometimes lead — headline risk.

import { getJSON } from "../core/fetcher.js";
import { mean, std } from "../core/stats.js";

export const ARTICLES = [
  { title: "Strait_of_Hormuz", label: "Strait of Hormuz", region: "Gulf" },
  { title: "Bab-el-Mandeb", label: "Bab el-Mandeb", region: "Red Sea" },
  { title: "Kharg_Island", label: "Kharg Island", region: "Gulf" },
  { title: "Ras_Tanura", label: "Ras Tanura", region: "Gulf" },
  { title: "Fujairah", label: "Fujairah", region: "Gulf" },
  { title: "Yanbu", label: "Yanbu", region: "Red Sea" },
  { title: "Houthis", label: "Houthis", region: "Red Sea" },
  { title: "Islamic_Revolutionary_Guard_Corps", label: "IRGC", region: "Gulf" },
  { title: "Suez_Canal", label: "Suez Canal", region: "Red Sea" },
  { title: "Strategic_Petroleum_Reserve_(United_States)", label: "US SPR", region: "US" },
  { title: "Price_of_oil", label: "Price of oil", region: "Market" },
  { title: "Brent_Crude", label: "Brent Crude", region: "Market" },
  { title: "OPEC", label: "OPEC", region: "Market" },
  { title: "Oil_tanker", label: "Oil tanker", region: "Shipping" },
];

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

export async function pageviews(title, days = 150) {
  const end = new Date(Date.now() - 86400000);
  const start = new Date(end.getTime() - days * 86400000);
  const u = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title)}/daily/${ymd(start)}/${ymd(end)}`;
  const j = await getJSON(u, { ttl: 3 * 3600e3, source: "wiki", persist: true, timeout: 15e3 });
  return (j?.items || []).map((x) => ({ t: `${x.timestamp.slice(0, 4)}-${x.timestamp.slice(4, 6)}-${x.timestamp.slice(6, 8)}`, v: x.views }));
}

/** z-score of the last 7-day mean of log views vs the 90 days before it */
export function attention(series) {
  if (!series || series.length < 40) return null;
  const lv = series.map((p) => Math.log1p(p.v));
  const recent = lv.slice(-7), base = lv.slice(-97, -7);
  const z = (mean(recent) - mean(base)) / (std(base) || 1);
  const last7 = series.slice(-7).reduce((s, p) => s + p.v, 0) / 7;
  const base90 = series.slice(-97, -7).reduce((s, p) => s + p.v, 0) / Math.max(1, series.slice(-97, -7).length);
  return { z, last7, base90, ratio: base90 ? last7 / base90 : NaN, peak: Math.max(...series.map((p) => p.v)) };
}

export async function all() {
  const out = [];
  const res = await Promise.allSettled(ARTICLES.map((a) => pageviews(a.title)));
  res.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.length) out.push({ ...ARTICLES[i], series: r.value, stats: attention(r.value) });
  });
  if (!out.length && res.length) throw res[0].reason || new Error("No pageview data");
  return out;
}
