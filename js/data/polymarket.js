// Polymarket: market-implied probabilities for the events that move oil
// (Hormuz reopening, US–Iran escalation, Bab el-Mandeb, price barriers).
// Gamma API for discovery, CLOB for probability history. Both CORS-enabled.

import { getJSON } from "../core/fetcher.js";
import * as health from "../core/health.js";
import * as straits from "./straits.js";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";

const QUERIES = ["hormuz", "iran", "crude oil", "oil price", "opec", "bab el-mandeb", "houthi", "saudi", "red sea", "tanker", "petroleum reserve", "wti"];
const RELEVANT = /\b(crude|oil|opec\+?|hormuz|iran|iranian|houthis?|bab el-mandeb|red sea|saudi|aramco|tankers?|petroleum|gasoline|refiner(y|ies)|strait|wti|brent crude|khamenei|israel x iran|us x iran)\b/i;
const NOISE = /\b(fc|football|soccer|nba|nfl|nhl|mlb|premier league|award|trophy|champion(ship)?|nascar|coach|goalscorer|grammy|oscar|bitcoin|ethereum|tweet)\b/i;

const num = (v) => (v == null || v === "" ? NaN : +v);
function parseArr(x) {
  if (Array.isArray(x)) return x;
  try { return JSON.parse(x || "[]"); } catch { return []; }
}

function normMarket(m, ev) {
  const prices = parseArr(m.outcomePrices).map(Number);
  const outcomes = parseArr(m.outcomes);
  const tokens = parseArr(m.clobTokenIds);
  const yesIdx = Math.max(0, outcomes.findIndex((o) => /^yes$/i.test(o)));
  return {
    id: m.id, slug: m.slug, eventSlug: ev?.slug, eventTitle: ev?.title,
    q: m.question || m.groupItemTitle || ev?.title,
    item: m.groupItemTitle || "",
    p: prices.length ? prices[yesIdx] : NaN,
    d1: num(m.oneDayPriceChange), d7: num(m.oneWeekPriceChange),
    bid: num(m.bestBid), ask: num(m.bestAsk), last: num(m.lastTradePrice),
    vol: num(m.volumeNum ?? m.volume), liq: num(m.liquidityNum ?? m.liquidity),
    end: m.endDate || ev?.endDate, closed: !!m.closed, active: m.active !== false,
    token: tokens[yesIdx] || tokens[0] || null,
    url: ev?.slug ? `https://polymarket.com/event/${ev.slug}` : null,
  };
}

export async function search(q, limit = 20) {
  const u = `${GAMMA}/public-search?q=${encodeURIComponent(q)}&limit_per_type=${limit}&events_status=active`;
  const j = await getJSON(u, { ttl: 5 * 60e3, source: "poly", timeout: 15e3 });
  return (j?.events || []).filter((e) => !e.closed);
}

/**
 * The event board. Polymarket is unreachable from some networks (several
 * countries block it at the ISP level); the terminal then falls back to the
 * key Polymarket and Kalshi markets that straits.live republishes, and says so.
 */
export async function board() {
  try {
    return await boardDirect();
  } catch (e) {
    let relay = [];
    try { relay = fromRelay((await straits.status())?.predictionMarkets); } catch { /* both down */ }
    if (!relay.length) throw e;
    health.report("poly", { ok: true, stale: true, note: "Polymarket unreachable from this network: showing the markets straits.live republishes" });
    return relay;
  }
}

/** straits.live predictionMarkets -> the board's event shape (no history token). */
export function fromRelay(list = []) {
  const out = (list || []).filter((m) => Number.isFinite(+m.probability)).map((m) => {
    const q = m.question || m.title || "";
    const usd = m.volumeUnit === "usd" ? +m.volumeUsd : NaN;
    const id = m.id ?? "relay:" + q; // callers de-duplicate by id: never leave it undefined
    return {
      id, slug: null, title: q, end: m.closeAt, vol: +m.volumeUsd || NaN, liq: +m.liquidityUsd || NaN, venue: m.venue, relay: true,
      markets: [{ id, q, item: "", p: +m.probability, d1: NaN, d7: NaN, bid: NaN, ask: NaN, last: NaN, vol: usd, liq: +m.liquidityUsd || NaN,
        end: m.closeAt, closed: false, active: true, token: null, url: m.sourceUrl || m.url || null, venue: m.venue, relay: true, eventTitle: q }],
    };
  });
  out.sort((a, b) => (b.vol || 0) - (a.vol || 0));
  out.relay = true;
  return out;
}

/** Merge several searches into one relevant, de-duplicated event board. */
async function boardDirect() {
  const seen = new Map();
  const results = await Promise.allSettled(QUERIES.map((q) => search(q)));
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const e of r.value) {
      if (seen.has(e.id)) continue;
      const title = e.title || "";
      if (!RELEVANT.test(title) || NOISE.test(title)) continue;
      seen.set(e.id, e);
    }
  }
  if (!seen.size && results.every((r) => r.status === "rejected")) throw results[0].reason;
  const events = [...seen.values()].map((e) => ({
    id: e.id, slug: e.slug, title: e.title, end: e.endDate, vol: num(e.volume), liq: num(e.liquidity),
    markets: (e.markets || []).map((m) => normMarket(m, e)).filter((m) => !m.closed && Number.isFinite(m.p)),
  })).filter((e) => e.markets.length);
  events.sort((a, b) => (b.vol || 0) - (a.vol || 0));
  return events;
}

/** Probability history for a Yes token: [{t: ms, p}] */
export async function history(token, { interval = "max", fidelity = 720 } = {}) {
  if (!token) return [];
  const j = await getJSON(`${CLOB}/prices-history?market=${encodeURIComponent(token)}&interval=${interval}&fidelity=${fidelity}`, { ttl: 10 * 60e3, source: "poly", timeout: 15e3 });
  return (j?.history || []).map((x) => ({ t: x.t * 1000, p: +x.p })).filter((x) => Number.isFinite(x.p));
}

// ---------------------------------------------------------------- derived views
const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

function parseDeadline(text, fallbackYear) {
  const m = text.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
  if (!m) return null;
  const y = m[3] ? +m[3] : fallbackYear;
  return new Date(Date.UTC(y, MONTHS[m[1].toLowerCase()], +m[2], 23, 59));
}

/** Term structure of "Hormuz traffic returns to normal by <date>" markets. */
export function reopenCurve(events) {
  const pts = [];
  for (const e of events) {
    for (const m of e.markets) {
      if (!/hormuz/i.test(m.q) || !/return(s)? to normal/i.test(m.q)) continue;
      // closing times often fall just after midnight UTC of the next day: infer the year from end − 2 days
      const endMs = Date.parse(m.end || e.end || "");
      const year = Number.isFinite(endMs) ? new Date(endMs - 2 * 86400000).getUTCFullYear() : new Date().getUTCFullYear();
      let d = parseDeadline(m.q, year);
      const inMonth = m.q.match(/in (january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
      if (!d && inMonth) continue; // month-bucket markets are not cumulative
      if (!d) continue;
      if (Number.isFinite(endMs) && d.getTime() > endMs + 3 * 86400000) d = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate(), 23, 59));
      pts.push({ t: d.getTime(), p: m.p, d1: m.d1, q: m.q, token: m.token, vol: m.vol, url: m.url });
    }
  }
  const by = new Map();
  for (const p of pts) if (!by.has(p.t) || (by.get(p.t).vol || 0) < (p.vol || 0)) by.set(p.t, p);
  return [...by.values()].sort((a, b) => a.t - b.t);
}

/**
 * Price-barrier ladders: "Will WTI Crude Oil (WTI) hit (HIGH) $130 in November?"
 * Returns [{dir: "HIGH"|"LOW", K, p, start, end, q, window}]
 */
export function barrierLadders(events, now = new Date()) {
  const out = [];
  for (const e of events) {
    const title = e.title || "";
    const monthly = title.match(/what will wti crude oil.*hit in (\w+) (\d{4})/i);
    const weekly = title.match(/wti.*hit.*week of (\w+) (\d{1,2}) (\d{4})/i);
    if (!monthly && !weekly) continue;
    let start, end;
    if (monthly) {
      const mo = MONTHS[monthly[1].toLowerCase()], yr = +monthly[2];
      start = new Date(Date.UTC(yr, mo, 1)); end = new Date(Date.UTC(yr, mo + 1, 0, 23, 59));
    } else {
      const mo = MONTHS[weekly[1].toLowerCase()], yr = +weekly[3];
      start = new Date(Date.UTC(yr, mo, +weekly[2])); end = new Date(start.getTime() + 5 * 86400000);
    }
    if (e.end) end = new Date(Math.min(end.getTime(), new Date(e.end).getTime()));
    for (const m of e.markets) {
      const mm = m.q.match(/\((HIGH|LOW)\)\s*\$?([\d.,]+)/i);
      if (!mm) continue;
      out.push({ dir: mm[1].toUpperCase(), K: +mm[2].replace(/,/g, ""), p: m.p, start: start.getTime(), end: end.getTime(), q: m.q, window: monthly ? "month" : "week", event: title, vol: m.vol });
    }
  }
  return out.filter((x) => x.end > now.getTime()).sort((a, b) => a.end - b.end || a.K - b.K);
}

/** "WTI closes above $X on <date>?" binary ladders -> implied CDF points */
export function closeLadders(events) {
  const out = [];
  for (const e of events) {
    for (const m of e.markets) {
      const mm = m.q.match(/(wti|brent).*closes? above \$?([\d.]+) on (\w+ \d{1,2})/i);
      if (!mm) continue;
      const year = e.end ? new Date(e.end).getUTCFullYear() : new Date().getUTCFullYear();
      const d = parseDeadline(mm[3], year);
      out.push({ sym: mm[1].toUpperCase(), K: +mm[2], p: m.p, t: d ? d.getTime() : null, q: m.q, liq: m.liq });
    }
  }
  return out.sort((a, b) => (a.t || 0) - (b.t || 0) || a.K - b.K);
}

export const HEADLINE_PATTERNS = [
  { re: /hormuz.*return(s)? to normal by december 31/i, label: "Hormuz traffic normal by 31 Dec" },
  { re: /us.*invade iran/i, label: "US invades Iran before 2027" },
  { re: /ceasefire continues through the midterms/i, label: "US–Iran ceasefire holds through midterms" },
  { re: /crude oil reach a new all-time high by december/i, label: "Crude makes a new all-time high in 2026" },
  { re: /bab el-mandeb.*effectively closed/i, label: "Bab el-Mandeb effectively closed" },
  { re: /iran leadership change/i, label: "Iran leadership change" },
];
