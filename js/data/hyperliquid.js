// Hyperliquid HIP-3 perpetuals (trade.xyz deployer, "xyz" dex): the only free,
// keyless, CORS-enabled real-time oil price in a browser. REST for snapshots
// and history, one WebSocket for mids, trades, candles, context and book.
//
// Caveat shown in the UI: these are perps that track a blend of CME/ICE
// futures (rolling ~5-10 business days before expiry). When CME is shut the
// oracle freezes and the perp trades in a bounded weekend discovery band.

import { postJSON } from "../core/fetcher.js";
import { pub, get } from "../core/bus.js";
import * as health from "../core/health.js";

const INFO = "https://api.hyperliquid.xyz/info";
const WS_URL = "wss://api.hyperliquid.xyz/ws";

export const MARKETS = [
  { key: "WTI", coin: "xyz:CL", name: "WTI crude", short: "WTI", unit: "$/bbl", group: "oil", root: "CL" },
  { key: "BRENT", coin: "xyz:BRENTOIL", name: "Brent crude", short: "Brent", unit: "$/bbl", group: "oil", root: "B" },
  { key: "HO", coin: "xyz:HO", name: "NY Harbor ULSD", short: "ULSD", unit: "$/gal", group: "oil" },
  { key: "NG", coin: "xyz:NATGAS", name: "Henry Hub gas", short: "Nat gas", unit: "$/MMBtu", group: "gas" },
  { key: "GOLD", coin: "xyz:GOLD", name: "Gold", short: "Gold", unit: "$/oz", group: "macro" },
  { key: "SPX", coin: "xyz:SP500", name: "S&P 500", short: "S&P 500", unit: "index", group: "macro" },
  { key: "NDX", coin: "xyz:XYZ100", name: "US tech 100", short: "Tech 100", unit: "index", group: "macro" },
  { key: "EUR", coin: "xyz:EUR", name: "EUR/USD", short: "EUR/USD", unit: "", group: "fx" },
  { key: "JPY", coin: "xyz:JPY", name: "USD/JPY", short: "USD/JPY", unit: "", group: "fx" },
  { key: "TLT", coin: "xyz:TLT", name: "US Treasuries 20Y+ (TLT)", short: "TLT", unit: "$", group: "macro" },
  { key: "COPPER", coin: "xyz:COPPER", name: "Copper", short: "Copper", unit: "$/lb", group: "macro" },
  { key: "SILVER", coin: "xyz:SILVER", name: "Silver", short: "Silver", unit: "$/oz", group: "macro" },
  { key: "XLE", coin: "xyz:XLE", name: "Energy equities (XLE)", short: "XLE", unit: "$", group: "equity" },
  { key: "CVX", coin: "xyz:CVX", name: "Chevron", short: "CVX", unit: "$", group: "equity" },
];
export const byKey = Object.fromEntries(MARKETS.map((m) => [m.key, m]));
export const byCoin = Object.fromEntries(MARKETS.map((m) => [m.coin, m]));
export const ILLIQUID_USD = 2e6;

const n = (v) => (v == null ? NaN : +v);

// ---------------------------------------------------------------- REST
export const info = (body, ttl = 15e3) => postJSON(INFO, body, { ttl, source: "hl", timeout: 15e3 });

export async function snapshot(dex = "xyz") {
  const [meta, ctxs] = await info({ type: "metaAndAssetCtxs", dex }, 20e3);
  return meta.universe.map((u, i) => ({ coin: u.name, delisted: !!u.isDelisted, maxLeverage: u.maxLeverage, ...normCtx(ctxs[i]) }));
}

function normCtx(c = {}) {
  return {
    markPx: n(c.markPx), midPx: n(c.midPx), oraclePx: n(c.oraclePx), prevDayPx: n(c.prevDayPx),
    dayNtlVlm: n(c.dayNtlVlm), openInterest: n(c.openInterest), funding: n(c.funding), premium: n(c.premium),
  };
}

export async function candles(coin, interval, startTime, endTime = Date.now(), ttl = 30e3) {
  const rows = await info({ type: "candleSnapshot", req: { coin, interval, startTime: Math.floor(startTime), endTime: Math.floor(endTime) } }, ttl);
  return (rows || []).map((c) => ({ t: c.t, T: c.T, o: n(c.o), h: n(c.h), l: n(c.l), c: n(c.c), v: n(c.v), n: c.n }));
}

export async function book(coin) {
  const b = await info({ type: "l2Book", coin }, 2e3);
  return normBook(b);
}
function normBook(b) {
  if (!b || !b.levels) return null;
  const side = (arr) => arr.map((l) => ({ px: n(l.px), sz: n(l.sz), n: l.n }));
  return { coin: b.coin, time: b.time, bids: side(b.levels[0]), asks: side(b.levels[1]) };
}

export async function fundingHistory(coin, startTime) {
  const rows = await info({ type: "fundingHistory", coin, startTime: Math.floor(startTime) }, 120e3);
  return (rows || []).map((r) => ({ t: r.time, rate: n(r.fundingRate), premium: n(r.premium) }));
}

/** daily closes for several coins since a date: { coin: [{t, c}] } */
export async function dailyCloses(coins, sinceMs) {
  const out = {};
  for (const c of coins) {
    try { out[c] = (await candles(c, "1d", sinceMs, Date.now(), 600e3)).map((k) => ({ t: k.t, c: k.c })); }
    catch { out[c] = []; }
  }
  return out;
}

// ---------------------------------------------------------------- tape state
const ctx = new Map();     // coin -> ctx
const mids = new Map();    // coin -> mid
const sparks = new Map();  // coin -> number[]
const trades = new Map();  // coin -> ring buffer
const lastPx = new Map();

function tapeRow(m) {
  const c = ctx.get(m.coin) || {};
  const mid = mids.get(m.coin);
  const pxNow = Number.isFinite(mid) ? mid : Number.isFinite(c.markPx) ? c.markPx : NaN;
  const prev = c.prevDayPx;
  const ch = Number.isFinite(pxNow) && prev > 0 ? pxNow - prev : NaN;
  return {
    ...m, px: pxNow, prev, ch, chPct: Number.isFinite(ch) ? ch / prev : NaN,
    mark: c.markPx, oracle: c.oraclePx, funding: c.funding, oi: c.openInterest, vol: c.dayNtlVlm,
    basis: Number.isFinite(c.markPx) && c.oraclePx > 0 ? c.markPx / c.oraclePx - 1 : NaN,
    illiquid: !(c.dayNtlVlm >= ILLIQUID_USD), spark: sparks.get(m.coin) || [],
  };
}

let emitQueued = false;
function emitTape() {
  if (emitQueued) return;
  emitQueued = true;
  requestAnimationFrame(() => {
    emitQueued = false;
    const rows = Object.fromEntries(MARKETS.map((m) => [m.key, tapeRow(m)]));
    const w = rows.WTI, b = rows.BRENT, ho = rows.HO;
    const spread = b.px - w.px;
    const spreadPrev = b.prev - w.prev;
    const crack = ho.px * 42 - w.px;
    const crackPrev = ho.prev * 42 - w.prev;
    const derived = {
      BW: { key: "BW", short: "Brent–WTI", name: "Brent minus WTI (perps)", unit: "$/bbl", px: spread, ch: spread - spreadPrev, chPct: NaN, derived: true, illiquid: b.illiquid || w.illiquid },
      CRACK: { key: "CRACK", short: "Diesel crack", name: "ULSD × 42 minus WTI", unit: "$/bbl", px: crack, ch: crack - crackPrev, chPct: NaN, derived: true, illiquid: ho.illiquid },
    };
    pub("tape", { rows, derived, t: Date.now() });
  });
}

export function prices() {
  const t = get("tape");
  if (!t) return {};
  const o = {};
  for (const [k, r] of Object.entries(t.rows)) o[k] = r.px;
  o.BW = t.derived.BW.px;
  o.CRACK = t.derived.CRACK.px;
  return o;
}

export async function loadSnapshot() {
  const snap = await snapshot("xyz");
  for (const s of snap) {
    ctx.set(s.coin, s);
    if (!mids.has(s.coin) && Number.isFinite(s.midPx)) mids.set(s.coin, s.midPx);
  }
  pub("hl:universe", snap);
  emitTape();
  return snap;
}

export async function loadSparks() {
  const since = Date.now() - 36 * 3600e3;
  for (const m of MARKETS) {
    try {
      const k = await candles(m.coin, "30m", since, Date.now(), 300e3);
      sparks.set(m.coin, k.map((x) => x.c));
    } catch { /* keep going */ }
  }
  emitTape();
}

// ---------------------------------------------------------------- stream
class Stream {
  constructor() {
    this.subs = new Map(); // key -> subscription object
    this.ws = null;
    this.backoff = 1000;
    this.pingTimer = null;
    this.lastMsg = 0;
    this.state = "idle";
  }
  key(s) { return JSON.stringify(s); }
  setState(s) {
    this.state = s;
    pub("hl:status", { state: s, t: Date.now() });
    if (s === "live") health.setState("hl", "ok", "stream live");
    else if (s === "down") health.report("hl", { ok: false, err: "stream disconnected, retrying" });
  }
  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this.setState("connecting");
    let ws;
    try { ws = new WebSocket(WS_URL); } catch (e) { this.setState("down"); return this.retry(); }
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 1000;
      this.setState("live");
      for (const s of this.subs.values()) ws.send(JSON.stringify({ method: "subscribe", subscription: s }));
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ method: "ping" }));
        if (Date.now() - this.lastMsg > 75e3) { try { ws.close(); } catch {} }
      }, 30e3);
    };
    ws.onmessage = (e) => { this.lastMsg = Date.now(); this.route(e.data); };
    ws.onclose = () => { clearInterval(this.pingTimer); this.setState("down"); this.retry(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  retry() {
    clearTimeout(this.rt);
    this.rt = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30e3);
  }
  subscribe(s) {
    const k = this.key(s);
    if (this.subs.has(k)) return;
    this.subs.set(k, s);
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ method: "subscribe", subscription: s }));
  }
  unsubscribe(s) {
    const k = this.key(s);
    if (!this.subs.has(k)) return;
    this.subs.delete(k);
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ method: "unsubscribe", subscription: s }));
  }
  route(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const ch = msg.channel, d = msg.data;
    if (ch === "allMids" && d && d.mids) {
      for (const [coin, v] of Object.entries(d.mids)) {
        if (!byCoin[coin]) continue;
        const x = +v;
        const prev = lastPx.get(coin);
        mids.set(coin, x);
        if (prev !== undefined && prev !== x) pub("tick:" + byCoin[coin].key, { px: x, dir: x > prev ? 1 : -1 });
        lastPx.set(coin, x);
      }
      emitTape();
    } else if (ch === "activeAssetCtx" && d && d.coin) {
      ctx.set(d.coin, { ...(ctx.get(d.coin) || {}), ...normCtx(d.ctx) });
      emitTape();
    } else if (ch === "trades" && Array.isArray(d)) {
      for (const t of d) {
        const buf = trades.get(t.coin) || [];
        buf.unshift({ t: t.time, px: +t.px, sz: +t.sz, side: t.side === "B" ? "buy" : "sell", tid: t.tid });
        if (buf.length > 300) buf.length = 300;
        trades.set(t.coin, buf);
        pub("hl:trades:" + t.coin, buf);
      }
    } else if (ch === "candle" && d) {
      for (const c of Array.isArray(d) ? d : [d]) {
        pub(`hl:candle:${c.s}:${c.i}`, { t: c.t, T: c.T, o: +c.o, h: +c.h, l: +c.l, c: +c.c, v: +c.v, n: c.n });
      }
    } else if (ch === "l2Book" && d) {
      pub("hl:book:" + d.coin, normBook(d));
    }
  }
}

export const stream = new Stream();

export function startTape() {
  stream.subscribe({ type: "allMids", dex: "xyz" });
  for (const c of ["xyz:CL", "xyz:BRENTOIL", "xyz:HO", "xyz:NATGAS"]) stream.subscribe({ type: "activeAssetCtx", coin: c });
  for (const c of ["xyz:CL", "xyz:BRENTOIL"]) stream.subscribe({ type: "trades", coin: c });
  stream.connect();
  loadSnapshot().catch((e) => health.report("hl", { ok: false, err: e.message }));
  loadSparks();
  setInterval(() => { if (!document.hidden) loadSnapshot().catch(() => {}); }, 60e3);
  setInterval(() => { if (!document.hidden) loadSparks(); }, 15 * 60e3);
}

export const recentTrades = (coin) => trades.get(coin) || [];
