// GDELT DOC 2.0: global news search and coverage-intensity timelines.
// The API is slow and drops CORS headers on its error pages, so calls are
// paced (one every ~5.6 s), cached, and fall back to the edge proxy if set.

import { getJSON } from "../core/fetcher.js";

const BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

export const THEMES = [
  { id: "hormuz", label: "Hormuz & Iran", q: '("strait of hormuz" OR hormuz OR iran) (tanker OR oil OR strait OR blockade)' },
  { id: "redsea", label: "Red Sea & Houthis", q: '(houthi OR "red sea" OR "bab el-mandeb" OR yanbu) (ship OR tanker OR missile OR oil)' },
  { id: "russia", label: "Russia energy", q: '(russia OR russian) (refinery OR "oil terminal" OR primorsk OR "ust-luga" OR novorossiysk OR "shadow fleet") (drone OR strike OR sanctions)' },
  { id: "opec", label: "OPEC+ policy", q: '(opec OR "opec+") (output OR production OR quota OR cut OR increase)' },
  { id: "spr", label: "Stock releases", q: '("strategic petroleum reserve" OR "emergency stocks" OR "iea release")' },
];

function ts(s) {
  // 20261027T184500Z -> ms
  const m = String(s).match(/(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : NaN;
}

export async function articles(query, { timespan = "2d", max = 60 } = {}) {
  const u = `${BASE}?query=${encodeURIComponent(query + " sourcelang:english")}&mode=artlist&format=json&sort=datedesc&maxrecords=${max}&timespan=${timespan}`;
  const j = await getJSON(u, { ttl: 20 * 60e3, source: "gdelt", timeout: 30e3, via: "auto", persist: true });
  return (j?.articles || []).map((a) => ({ title: a.title, url: a.url, src: a.domain, t: ts(a.seendate), country: a.sourcecountry, lang: a.language }));
}

export async function timeline(query, { timespan = "3m", mode = "timelinevolraw" } = {}) {
  const u = `${BASE}?query=${encodeURIComponent(query)}&mode=${mode}&format=json&timespan=${timespan}`;
  const j = await getJSON(u, { ttl: 60 * 60e3, source: "gdelt", timeout: 30e3, via: "auto", persist: true });
  const s = j?.timeline?.[0]?.data || [];
  return s.map((p) => ({ t: ts(p.date), v: +p.value, norm: p.norm != null ? +p.norm : NaN })).filter((p) => Number.isFinite(p.t));
}
