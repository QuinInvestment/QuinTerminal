// The oil market's calendar: weekly data releases on their regular schedules
// (with the usual US holiday shifts), contract expiries from the exchange
// rules, and dated events checked against their publishers.

import { usHolidays, upcoming } from "./contracts.js";

const NY = "America/New_York";
const DAY = 86400000;

// ---------------------------------------------------------------- time zones
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

const iso = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const isHol = (y, m, d) => usHolidays(new Date(Date.UTC(y, m, d)).getUTCFullYear()).has(iso(y, m, d));
const at = (y, m, d, hh, mm, tz = NY) => zonedToUtc(...norm(y, m, d), hh, mm, tz);
function norm(y, m, d) { const x = new Date(Date.UTC(y, m, d)); return [x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()]; }

// ---------------------------------------------------------------- dated events
// Checked on 2 November 2026: EIA STEO release schedule (eia.gov/outlooks/steo/
// release_schedule.php), OPEC report and meeting dates (OPEC calendar as listed
// by Trading Economics). Times are the publishers' usual ones.
export const DATED = [
  { d: "2026-11-03", name: "US midterm elections", short: "US midterms", kind: "politics", tag: "POL", allDay: true, note: "Energy policy, sanctions and the SPR are on the ballot indirectly." },
  { d: "2026-11-10", hh: 12, mm: 0, name: "EIA Short-Term Energy Outlook", short: "EIA STEO", kind: "data", tag: "STEO", note: "EIA's monthly world balance and price forecast. Feeds BAL." },
  { d: "2026-11-11", name: "OPEC Monthly Oil Market Report", short: "OPEC MOMR", kind: "data", tag: "MOMR", allDay: true, note: "OPEC's demand forecast and the secondary-source estimates of its members' output." },
  { d: "2026-12-06", name: "OPEC and non-OPEC ministerial meeting", short: "OPEC+ ministers", kind: "policy", tag: "OPEC+", allDay: true, note: "Production policy of OPEC and its partners for the coming months." },
  { d: "2026-12-08", hh: 12, mm: 0, name: "EIA Short-Term Energy Outlook", short: "EIA STEO", kind: "data", tag: "STEO", note: "EIA's monthly world balance and price forecast. Feeds BAL." },
  { d: "2026-12-14", name: "OPEC Monthly Oil Market Report", short: "OPEC MOMR", kind: "data", tag: "MOMR", allDay: true, note: "OPEC's demand forecast and the secondary-source estimates of its members' output." },
  { d: "2027-01-12", hh: 12, mm: 0, name: "EIA Short-Term Energy Outlook", short: "EIA STEO", kind: "data", tag: "STEO", note: "First outlook to cover 2028." },
  { d: "2027-02-09", hh: 12, mm: 0, name: "EIA Short-Term Energy Outlook", short: "EIA STEO", kind: "data", tag: "STEO", note: "EIA's monthly world balance and price forecast." },
  { d: "2027-03-09", hh: 12, mm: 0, name: "EIA Short-Term Energy Outlook", short: "EIA STEO", kind: "data", tag: "STEO", note: "EIA's monthly world balance and price forecast." },
];

// ---------------------------------------------------------------- generator
/**
 * Every event between two dates: [{ t: Date, name, kind, tag, note, allDay }].
 * kind: "data" (releases), "expiry" (futures last trade), "policy", "politics".
 */
export function events(from, to, { extra = [] } = {}) {
  const out = [];
  const push = (e) => { if (e.t >= from && e.t <= to) out.push(e); };
  // walk the weeks: anchor on each Monday (New York date)
  const start = zoned(new Date(from.getTime() - 7 * DAY), NY);
  let monday = Date.UTC(start.y, start.m, start.d - ((start.wd + 6) % 7));
  for (; monday <= to.getTime() + 7 * DAY; monday += 7 * DAY) {
    const m = new Date(monday);
    const Y = m.getUTCFullYear(), M = m.getUTCMonth(), D = m.getUTCDate();
    const monHol = isHol(Y, M, D);
    // API survey: Tuesday 16:30 ET, a day later after a Monday holiday
    push({ t: at(Y, M, D + (monHol ? 2 : 1), 16, 30), name: "API weekly inventories", short: "API stocks", kind: "data", tag: "API", note: "Private survey of US stocks, the evening before EIA." });
    // EIA weekly petroleum status: Wednesday 10:30 ET, Thursday 11:00 after a Monday or midweek holiday
    const wedHol = isHol(Y, M, D + 2);
    const late = monHol || wedHol;
    push({ t: at(Y, M, D + (late ? 3 : 2), late ? 11 : 10, late ? 0 : 30), name: "EIA weekly petroleum status", short: "EIA stocks", kind: "data", tag: "EIA", note: "US crude, gasoline and distillate stocks, refinery runs and trade. The weekly number for WTI." });
    // Baker Hughes rig count: Friday 13:00 ET, Wednesday in Thanksgiving week, Thursday if Friday is a holiday
    const thanks = isHol(Y, M, D + 3) && M === 10;
    const friHol = isHol(Y, M, D + 4);
    push({ t: at(Y, M, D + (thanks ? 2 : friHol ? 3 : 4), 13, 0), name: "Baker Hughes rig count", short: "Rig count", kind: "data", tag: "RIGS", note: "US oil and gas drilling, a lead on shale supply." });
    // CFTC Commitments of Traders: Friday 15:30 ET, the next Monday if Friday is a holiday
    push({ t: at(Y, M, D + (friHol ? 7 : 4), 15, 30), name: "CFTC Commitments of Traders", short: "CFTC COT", kind: "data", tag: "COT", note: "Positions of funds, producers and swap dealers as of Tuesday. Feeds POS." });
  }
  // futures expiries
  for (const root of ["CL", "B"]) {
    for (const c of upcoming(root, 6, new Date(from.getTime() - 40 * DAY))) {
      const lt = c.lastTrade;
      const t = root === "CL" ? at(lt.getUTCFullYear(), lt.getUTCMonth(), lt.getUTCDate(), 14, 30) : zonedToUtc(lt.getUTCFullYear(), lt.getUTCMonth(), lt.getUTCDate(), 19, 30, "Europe/London");
      push({ t, name: `${root === "CL" ? "NYMEX WTI" : "ICE Brent"} ${c.label} last trade (${c.code})`, short: `${root === "CL" ? "WTI" : "Brent"} ${c.label} expiry`, kind: "expiry", tag: root === "CL" ? "CL" : "BRENT", note: root === "CL" ? "Three business days before the 25th of the prior month. Physical delivery at Cushing." : "Last business day of the second month before delivery. Cash-settled on the ICE Brent Index." });
    }
  }
  for (const e of DATED) {
    const [y, mo, d] = e.d.split("-").map(Number);
    const t = e.allDay ? new Date(Date.UTC(y, mo - 1, d, 12)) : at(y, mo - 1, d, e.hh, e.mm);
    push({ ...e, t });
  }
  for (const e of extra) push(e);
  return out.sort((a, b) => a.t - b.t);
}
