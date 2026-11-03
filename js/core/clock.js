// World clocks, exchange session state and the event clock.

import { h, mount, $ } from "./dom.js";
import { hhmm, countdown } from "./fmt.js";
import { get, sub } from "./bus.js";
import { zoned, zonedToUtc, events as calendarEvents } from "./calendar.js";

export const CLOCKS = [
  { city: "New York", tz: "America/New_York", market: "cme" },
  { city: "London", tz: "Europe/London", market: "ice" },
  { city: "Riyadh", tz: "Asia/Riyadh" },
  { city: "Singapore", tz: "Asia/Singapore" },
  { city: "Paris", tz: "Europe/Paris" },
];

export { zoned, zonedToUtc };

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
// The next three weeks of the oil calendar (see calendar.js), plus any events
// a module publishes on the bus.
export function upcomingEvents(now = new Date()) {
  const extra = (get("events:extra") || []).filter((x) => x.t > now);
  return calendarEvents(now, new Date(now.getTime() + 21 * 86400000), { extra }).filter((e) => e.t > now);
}

export function eventList(limit = 8) {
  const now = new Date();
  return upcomingEvents(now).slice(0, limit).map((e) => ({ ...e, inMs: e.t - now }));
}

export function onExtraEvents(fn) { return sub("events:extra", fn); }
export { countdown };
