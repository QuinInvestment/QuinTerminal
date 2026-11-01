// World clocks, exchange session state and the event clock (EIA, API, CFTC,
// rig count, contract expiries, fixed political dates).

import { h, mount, $ } from "./dom.js";
import { hhmm, countdown } from "./fmt.js";
import { usHolidays, upcoming } from "./contracts.js";
import { get, sub } from "./bus.js";

export const CLOCKS = [
  { city: "New York", tz: "America/New_York", market: "cme" },
  { city: "London", tz: "Europe/London", market: "ice" },
  { city: "Riyadh", tz: "Asia/Riyadh" },
  { city: "Singapore", tz: "Asia/Singapore" },
  { city: "Paris", tz: "Europe/Paris" },
];

const partsFmt = new Map();
export function zoned(date, tz) {
  if (!partsFmt.has(tz)) partsFmt.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  const p = Object.fromEntries(partsFmt.get(tz).formatToParts(date).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, m: +p.month - 1, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second, wd };
}

/** wall-clock time in a zone -> UTC Date */
export function zonedToUtc(y, m, d, hh, mm, tz) {
  let t = Date.UTC(y, m, d, hh, mm);
  for (let i = 0; i < 3; i++) {
    const z = zoned(new Date(t), tz);
    const asUtc = Date.UTC(z.y, z.m, z.d, z.hh, z.mm);
    const diff = Date.UTC(y, m, d, hh, mm) - asUtc;
    if (!diff) break;
    t += diff;
  }
  return new Date(t);
}

export function cmeOpen(now = new Date()) {
  const z = zoned(now, "America/New_York");
  const mins = z.hh * 60 + z.mm;
  if (z.wd === 6) return false;
  if (z.wd === 0) return mins >= 18 * 60;
  if (z.wd === 5) return mins < 17 * 60;
  return !(mins >= 17 * 60 && mins < 18 * 60);
}
export function iceOpen(now = new Date()) {
  const z = zoned(now, "Europe/London");
  const mins = z.hh * 60 + z.mm;
  // ICE Brent: Sun 23:00 -> Mon 23:00, then Tue-Fri 01:00-23:00 London time
  if (z.wd === 6) return false;
  if (z.wd === 0) return mins >= 23 * 60;
  if (z.wd === 1) return mins < 23 * 60;
  return mins >= 60 && mins < 23 * 60;
}

export function renderClocks() {
  const el = $("#clocks");
  const tick = () => {
    const now = new Date();
    mount(el, CLOCKS.map((c) => {
      const open = c.market === "cme" ? cmeOpen(now) : c.market === "ice" ? iceOpen(now) : null;
      return h("div", { class: "clock", title: c.market ? `${c.market === "cme" ? "CME Globex energy" : "ICE Futures Europe"} ${open ? "open" : "closed"}` : c.city },
        h("span", { class: "city" }, open != null ? h("span", { class: "mk" + (open ? " open" : "") }) : null, c.city),
        h("span", { class: "time" }, hhmm(now, c.tz)));
    }));
    const sb = $("#sbClock");
    if (sb) sb.textContent = `UTC ${now.toISOString().slice(11, 16)}`;
  };
  tick();
  setInterval(tick, 15000);
}

// ---------------------------------------------------------------- event clock
function nextWeekdayAt(now, weekday, hh, mm, tz, shiftIfMondayHoliday = null) {
  for (let add = 0; add < 15; add++) {
    const base = new Date(now.getTime() + add * 86400000);
    const z = zoned(base, tz);
    if (z.wd !== weekday) continue;
    let y = z.y, m = z.m, d = z.d, H = hh, M = mm;
    if (shiftIfMondayHoliday) {
      const monday = new Date(Date.UTC(y, m, d - (weekday - 1)));
      if (usHolidays(y).has(monday.toISOString().slice(0, 10))) {
        const s = new Date(Date.UTC(y, m, d + 1));
        y = s.getUTCFullYear(); m = s.getUTCMonth(); d = s.getUTCDate();
        [H, M] = shiftIfMondayHoliday;
      }
    }
    const t = zonedToUtc(y, m, d, H, M, tz);
    if (t > now) return t;
  }
  return null;
}

export function upcomingEvents(now = new Date()) {
  const ev = [];
  const ny = "America/New_York";
  const eia = nextWeekdayAt(now, 3, 10, 30, ny, [11, 0]);
  if (eia) ev.push({ t: eia, name: "EIA weekly petroleum status", kind: "data", tag: "EIA" });
  const api = nextWeekdayAt(now, 2, 16, 30, ny, [16, 30]);
  if (api) ev.push({ t: api, name: "API weekly inventories (private survey)", kind: "data", tag: "API" });
  const cot = nextWeekdayAt(now, 5, 15, 30, ny);
  if (cot) ev.push({ t: cot, name: "CFTC Commitments of Traders", kind: "data", tag: "COT" });
  const bh = nextWeekdayAt(now, 5, 13, 0, ny);
  if (bh) ev.push({ t: bh, name: "Baker Hughes rig count", kind: "data", tag: "RIGS" });
  for (const root of ["CL", "B"]) {
    const c = upcoming(root, 2, now)[0];
    if (c) ev.push({ t: zonedToUtc(c.lastTrade.getUTCFullYear(), c.lastTrade.getUTCMonth(), c.lastTrade.getUTCDate(), root === "CL" ? 14 : 19, 30, root === "CL" ? ny : "Europe/London"), name: `${root === "CL" ? "WTI" : "Brent"} ${c.label} last trade (${c.code})`, kind: "expiry", tag: "EXP" });
  }
  const fixed = [
    { t: new Date("2026-11-03T12:00:00Z"), name: "US midterm elections", kind: "politics", tag: "POL" },
  ];
  for (const f of fixed) if (f.t > now) ev.push(f);
  for (const x of get("events:extra") || []) if (x.t > now) ev.push(x);
  return ev.sort((a, b) => a.t - b.t);
}

export function eventList(limit = 8) {
  const now = new Date();
  return upcomingEvents(now).slice(0, limit).map((e) => ({ ...e, inMs: e.t - now }));
}

export function onExtraEvents(fn) { return sub("events:extra", fn); }
export { countdown };
