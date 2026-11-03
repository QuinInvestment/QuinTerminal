// Futures contract calendar: exchange holidays, last trading days for NYMEX
// WTI (CL) and ICE Brent (B), and the roll window the 24/7 perps use.

export const MONTH_CODES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const d = (y, m, day) => new Date(Date.UTC(y, m, day));
const key = (x) => x.toISOString().slice(0, 10);
const addDays = (x, n) => new Date(x.getTime() + n * 86400000);
const dow = (x) => x.getUTCDay();

function easterSunday(y) {
  // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, dd = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - dd - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const month = Math.floor((hh + l - 7 * m + 114) / 31) - 1, day = ((hh + l - 7 * m + 114) % 31) + 1;
  return d(y, month, day);
}
function nthWeekday(y, m, weekday, n) {
  const first = d(y, m, 1);
  const off = (weekday - dow(first) + 7) % 7;
  return d(y, m, 1 + off + (n - 1) * 7);
}
function lastWeekday(y, m, weekday) {
  const last = d(y, m + 1, 0);
  const off = (dow(last) - weekday + 7) % 7;
  return addDays(last, -off);
}
function observed(x) {
  if (dow(x) === 6) return addDays(x, -1);
  if (dow(x) === 0) return addDays(x, 1);
  return x;
}

const cache = new Map();
export function usHolidays(y) {
  const k = "us" + y;
  if (cache.has(k)) return cache.get(k);
  const set = new Set([
    observed(d(y, 0, 1)), nthWeekday(y, 0, 1, 3), nthWeekday(y, 1, 1, 3), addDays(easterSunday(y), -2),
    lastWeekday(y, 4, 1), observed(d(y, 5, 19)), observed(d(y, 6, 4)), nthWeekday(y, 8, 1, 1),
    nthWeekday(y, 10, 4, 4), observed(d(y, 11, 25)),
  ].map(key));
  cache.set(k, set);
  return set;
}
export function ukHolidays(y) {
  const k = "uk" + y;
  if (cache.has(k)) return cache.get(k);
  const e = easterSunday(y);
  const xmas = d(y, 11, 25), boxing = d(y, 11, 26);
  const xs = [observed(d(y, 0, 1)), addDays(e, -2), addDays(e, 1), nthWeekday(y, 4, 1, 1), lastWeekday(y, 4, 1), lastWeekday(y, 7, 1)];
  // Christmas / Boxing Day substitution
  if (dow(xmas) === 6) xs.push(d(y, 11, 27), d(y, 11, 28));
  else if (dow(xmas) === 0) xs.push(d(y, 11, 26), d(y, 11, 27));
  else if (dow(boxing) === 6) xs.push(xmas, d(y, 11, 28));
  else xs.push(xmas, boxing);
  // ICE treats Christmas Eve and New Year's Eve as non-expiry days for Brent.
  xs.push(d(y, 11, 24), d(y, 11, 31));
  const set = new Set(xs.map(key));
  cache.set(k, set);
  return set;
}

export function isBiz(x, cal = "us") {
  const w = dow(x);
  if (w === 0 || w === 6) return false;
  const hol = cal === "uk" ? ukHolidays(x.getUTCFullYear()) : usHolidays(x.getUTCFullYear());
  return !hol.has(key(x));
}
export function prevBiz(x, cal) { let y = addDays(x, -1); while (!isBiz(y, cal)) y = addDays(y, -1); return y; }
export function addBiz(x, n, cal) {
  let y = x, step = n >= 0 ? 1 : -1, left = Math.abs(n);
  while (left > 0) { y = addDays(y, step); if (isBiz(y, cal)) left--; }
  return y;
}

/**
 * NYMEX CL: trading terminates 3 business days before the 25th calendar day of
 * the month prior to the contract month; if the 25th is not a business day,
 * 3 business days before the business day preceding the 25th.
 */
export function wtiLastTrade(year, month) {
  const pm = month === 0 ? 11 : month - 1, py = month === 0 ? year - 1 : year;
  let anchor = d(py, pm, 25);
  if (!isBiz(anchor, "us")) anchor = prevBiz(anchor, "us");
  return addBiz(anchor, -3, "us");
}
/** ICE Brent: last business day of the second month preceding the contract month. */
export function brentLastTrade(year, month) {
  let m = month - 2, y = year;
  if (m < 0) { m += 12; y -= 1; }
  let x = d(y, m + 1, 0);
  while (!isBiz(x, "uk")) x = addDays(x, -1);
  return x;
}

/** Upcoming contracts: [{root, code, label, year, month, lastTrade, daysLeft}] */
export function upcoming(root = "CL", n = 8, asOf = new Date()) {
  const out = [];
  const today = d(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  let y = asOf.getUTCFullYear(), m = asOf.getUTCMonth();
  for (let i = 0; out.length < n && i < 40; i++) {
    const lt = root === "CL" ? wtiLastTrade(y, m) : brentLastTrade(y, m);
    if (lt >= today) {
      out.push({
        root, year: y, month: m,
        code: `${root === "CL" ? "CL" : "B"}${MONTH_CODES[m]}${String(y).slice(-1)}`,
        yahoo: `${root === "CL" ? "CL" : "BZ"}${MONTH_CODES[m]}${String(y).slice(-2)}.NYM`,
        label: `${MONTHS[m]}-${String(y).slice(-2)}`,
        lastTrade: lt,
        daysLeft: Math.round((lt - today) / 86400000),
      });
    }
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}

/**
 * The trade.xyz WTI perp references a blend of CME contracts and walks from
 * the expiring month into the next in five 20% steps that finish about five
 * business days before expiry (published schedule; this is an estimate).
 */
export function perpReference(root = "CL", asOf = new Date()) {
  const cs = upcoming(root, 3, asOf);
  if (!cs.length) return null;
  const front = cs[0], next = cs[1];
  const cal = root === "CL" ? "us" : "uk";
  const start = addBiz(front.lastTrade, -10, cal), end = addBiz(front.lastTrade, -5, cal);
  const t = asOf.getTime();
  if (t < start.getTime()) return { label: front.code, weightNext: 0, front, next, rollStart: start, rollEnd: end };
  if (t >= end.getTime()) return { label: next.code, weightNext: 1, front: next, next: cs[2], rollStart: start, rollEnd: end };
  const w = Math.min(1, Math.max(0, (t - start.getTime()) / (end.getTime() - start.getTime())));
  return { label: `${front.code}→${next.code}`, weightNext: Math.round(w * 5) / 5, front, next, rollStart: start, rollEnd: end };
}
