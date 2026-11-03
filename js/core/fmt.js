// Number and date formatting. Every figure on screen goes through here so
// decimals, signs and units stay consistent.

const nf = new Map();
function f(d, opts = {}) {
  const k = d + JSON.stringify(opts);
  if (!nf.has(k)) nf.set(k, new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d, ...opts }));
  return nf.get(k);
}

export const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const num = (v, d = 2) => (isNum(v) ? f(d).format(v) : "—");
export const int = (v) => (isNum(v) ? f(0).format(Math.round(v)) : "—");
export const signed = (v, d = 2) => (isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + f(d).format(Math.abs(v)) : "—");
export const pct = (v, d = 1) => (isNum(v) ? f(d).format(v * 100) + "%" : "—");
export const spct = (v, d = 2) => (isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + f(d).format(Math.abs(v * 100)) + "%" : "—");
export const pp = (v, d = 1) => (isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + f(d).format(Math.abs(v * 100)) + " pts" : "—");
export const usd = (v, d = 2) => (isNum(v) ? (v < 0 ? "−$" : "$") + f(d).format(Math.abs(v)) : "—");

export function compact(v, d = 1) {
  if (!isNum(v)) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1e12) return s + f(d).format(a / 1e12) + "T";
  if (a >= 1e9) return s + f(d).format(a / 1e9) + "B";
  if (a >= 1e6) return s + f(d).format(a / 1e6) + "M";
  if (a >= 1e4) return s + f(d).format(a / 1e3) + "K";
  return s + f(a >= 100 ? 0 : d).format(a);
}

/** Price with sensible decimals for the instrument's magnitude. */
export function px(v) {
  if (!isNum(v)) return "—";
  const a = Math.abs(v);
  if (a >= 10000) return f(0).format(v);
  if (a >= 1000) return f(1).format(v);
  if (a >= 20) return f(2).format(v);
  if (a >= 1) return f(3).format(v);
  return f(4).format(v);
}

export const dirClass = (v) => (isNum(v) ? (v > 0 ? "up" : v < 0 ? "down" : "flat") : "flat");

// ---------------------------------------------------------------- dates
export const toDate = (x) => (x instanceof Date ? x : new Date(x));
export function isoDay(d) {
  const x = toDate(d);
  return isNaN(x) ? "" : x.toISOString().slice(0, 10);
}
export function shortDay(d) {
  const x = toDate(d);
  if (isNaN(x)) return "—";
  return x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}
export function dayYear(d) {
  const x = toDate(d);
  if (isNaN(x)) return "—";
  return x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
export function hhmm(d, tz) {
  const x = toDate(d);
  if (isNaN(x)) return "—";
  return x.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
}
export function hhmmss(d, tz) {
  const x = toDate(d);
  if (isNaN(x)) return "—";
  return x.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: tz });
}
export function ago(ts) {
  if (!ts) return "—";
  const s = Math.max(0, (Date.now() - toDate(ts).getTime()) / 1000);
  if (s < 5) return "now";
  if (s < 60) return Math.round(s) + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400 * 2) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}
export function countdown(ms) {
  if (!isNum(ms)) return "—";
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `${d}d ${hh}h`;
  if (hh > 0) return `${hh}h ${String(mm).padStart(2, "0")}m`;
  return `${mm}m`;
}

/** Thousand barrels -> "412.5 mb"; kb/d -> "13.27 mb/d" */
export const mb = (kb, d = 1) => (isNum(kb) ? f(d).format(kb / 1000) + " mb" : "—");
export const mbd = (kbd, d = 2) => (isNum(kbd) ? f(d).format(kbd / 1000) + " mb/d" : "—");
