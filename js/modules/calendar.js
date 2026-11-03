// CAL — the oil market's calendar: weekly releases, OPEC and EIA reports,
// OPEC+ meetings and futures expiries, as a month grid and an agenda.

import { h, mount } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { countdown } from "../core/fmt.js";
import { get } from "../core/bus.js";
import { events, zoned } from "../core/calendar.js";
import { seg } from "./kit.js";

const KIND = { data: "Data release", expiry: "Futures expiry", policy: "Policy meeting", politics: "Politics" };

export default {
  title: "Oil market calendar",
  sub: "Releases, reports, meetings and expiries that move crude, in your local time. Weekly releases follow their regular schedules with the usual US holiday shifts; dated events were checked against their publishers.",

  async mount(view, { scope, tools }) {
    const pMonth = panel({ title: "Month", span: 8, rows: 13, src: [], method: M_CAL });
    const pAgenda = panel({ title: "Next three weeks", span: 4, rows: 13, src: [], flush: true, method: M_CAL });
    view.appendChild(grid(pMonth, pAgenda));

    const now = new Date();
    let offset = 0;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    mount(tools, seg([{ value: 0, label: "This month" }, { value: 1, label: "Next month" }, { value: 2, label: "In two months" }], 0, (v) => { offset = v; paintMonth(); }),
      h("span", { class: "small dim" }, `Times in ${tz.replace(/_/g, " ")}`));

    function paintMonth() {
      const z = zoned(new Date(), tz);
      const first = new Date(Date.UTC(z.y, z.m + offset, 1));
      const y = first.getUTCFullYear(), m = first.getUTCMonth();
      const startDow = (first.getUTCDay() + 6) % 7; // Monday first
      const gridStart = new Date(Date.UTC(y, m, 1 - startDow));
      const cells = 42;
      const from = new Date(gridStart.getTime() - 86400000), to = new Date(gridStart.getTime() + (cells + 1) * 86400000);
      const evs = events(from, to, { extra: get("events:extra") || [] });
      const byDay = new Map();
      for (const e of evs) {
        const k = localDay(e.t, tz, e.allDay);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(e);
      }
      const today = localDay(new Date(), tz);
      const head = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => h("div", { class: "dow" }, d));
      const days = [];
      for (let i = 0; i < cells; i++) {
        const d = new Date(gridStart.getTime() + i * 86400000);
        const k = d.toISOString().slice(0, 10);
        const list = byDay.get(k) || [];
        days.push(h("div", { class: "day" + (d.getUTCMonth() !== m ? " out" : "") + (k === today ? " today" : "") },
          h("span", { class: "dnum" }, String(d.getUTCDate())),
          list.map((e) => h("div", { class: "ev " + e.kind, title: `${e.name}${e.allDay ? "" : ", " + time(e.t, tz)}. ${e.note || ""}` }, e.allDay ? (e.short || e.name) : `${time(e.t, tz)} ${e.short || e.name}`))));
      }
      pMonth.setTitle(first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }));
      mount(pMonth.body, h("div", { class: "cal" }, head, days),
        h("div", { class: "row", style: { marginTop: "10px", gap: "16px" } }, Object.entries(KIND).map(([k, label]) => h("span", { class: "tiny muted", style: { display: "inline-flex", alignItems: "center", gap: "6px" } }, h("span", { class: "cal-key " + k }), label))));
      pMonth.setData([{ label: "UTC time" }, { label: "Event" }, { label: "Kind" }], evs.filter((e) => e.t.getUTCMonth() === m).map((e) => [e.t.toISOString(), e.name, KIND[e.kind]]));
      pMonth.touch();
    }

    function paintAgenda() {
      const now = new Date();
      const list = events(now, new Date(now.getTime() + 21 * 86400000), { extra: get("events:extra") || [] }).filter((e) => e.t > now || e.allDay);
      let lastDay = "";
      const rows = [];
      for (const e of list) {
        const k = localDay(e.t, tz, e.allDay);
        if (k !== lastDay) {
          lastDay = k;
          rows.push(h("div", { style: { padding: "10px 12px 4px", fontSize: "var(--t-11)", color: "var(--muted)", fontWeight: 500, borderBottom: "1px solid var(--line)" } }, new Date(k + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })));
        }
        rows.push(h("div", { class: "feed-item", style: { gridTemplateColumns: "48px 1fr" } },
          h("span", { class: "t" }, e.allDay ? "day" : time(e.t, tz)),
          h("div", {},
            h("div", { class: "h" }, e.name),
            h("div", { class: "m" }, h("span", { class: "tag" + (e.kind === "expiry" ? " ac" : "") }, e.tag), e.allDay ? null : h("span", { class: "mono" }, "in " + countdown(e.t - now)), h("span", {}, e.note || "")))));
      }
      mount(pAgenda.body, rows.length ? rows : h("div", { class: "note", style: { padding: "12px" } }, "Nothing scheduled in the next three weeks."));
      pAgenda.touch();
    }

    paintMonth();
    paintAgenda();
    scope.every(60e3, paintAgenda, { now: false });
    void now;
  },
};

function localDay(t, tz, allDay) {
  if (allDay) return t.toISOString().slice(0, 10);
  const z = zoned(t, tz);
  return `${z.y}-${String(z.m + 1).padStart(2, "0")}-${String(z.d).padStart(2, "0")}`;
}
function time(t, tz) {
  const z = zoned(t, tz);
  return `${String(z.hh).padStart(2, "0")}:${String(z.mm).padStart(2, "0")}`;
}

const M_CAL = `<p>Weekly releases on their regular schedules: API inventories Tuesday 16:30 New York time, EIA's Weekly Petroleum Status Report Wednesday 10:30 (Thursday 11:00 after a Monday holiday), Baker Hughes rigs Friday 13:00, CFTC Commitments of Traders Friday 15:30. Holiday shifts follow the usual pattern; the publishers announce exceptions on their own sites.</p>
<p>Expiries follow the exchange rules: NYMEX WTI stops trading three business days before the 25th of the month before delivery; ICE Brent on the last business day of the second month before delivery.</p>
<p>Dated events checked on 2 November 2026: EIA's STEO release schedule, and OPEC's report and meeting dates.</p>`;
