// FLOW — the world's oil chokepoints: daily tanker transits from IMF PortWatch
// against the same weeks a year earlier, one small chart per strait, a detail
// view, and the EIA's estimates of the oil that moves through each one.

import { h, mount } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { tsOption, makeChart } from "../core/charts.js";
import { num, int, spct, pct, isNum, dirClass, shortDay } from "../core/fmt.js";
import { get } from "../core/bus.js";
import * as pw from "../data/portwatch.js";
import { CHOKEPOINTS } from "../data/static/infrastructure.js";
import { load, chartIn, table, ms } from "./kit.js";

export default {
  title: "Chokepoints and tanker flows",
  sub: "Tankers crossing the twelve straits that carry most seaborne oil, from AIS (IMF PortWatch), against the same weeks last year. Select a strait for its daily detail.",

  async mount(view, { scope, tools, arg, go }) {
    const pBoard = panel({ title: "Tanker transits, 7-day average against the same weeks last year", span: 12, rows: 7, src: ["portwatch"], flush: true, method: M_BOARD });
    const pDetail = panel({ title: "Detail", span: 8, rows: 8, src: ["portwatch"], chart: true, method: M_DETAIL });
    const pOil = panel({ title: "Oil through the chokepoints (EIA)", span: 4, rows: 8, src: [], flush: true, method: M_OIL });
    const pTable = panel({ title: "All chokepoints", span: 12, rows: 7, src: ["portwatch"], flush: true, method: M_BOARD });
    view.appendChild(grid(pBoard, pDetail, pOil, pTable));

    let board = [];
    let sel = (arg || "").toLowerCase() || "hormuz";
    const minis = [];
    scope.add(() => minis.forEach((c) => c.dispose()));

    paintOil();
    pBoard.state("loading", "Loading PortWatch transits");
    scope.every(3 * 3600e3, () => load(pBoard, async () => {
      const cps = await pw.daily();
      board = cps.map((c) => pw.summarise(c)).filter(Boolean);
      if (!board.length) throw new Error("No chokepoint had enough days to average");
      if (!board.some((b) => b.id === sel)) sel = board[0].id;
      await paintBoard();
      paintTable();
      await paintDetail();
      const asOf = board.map((b) => b.asOf).sort().pop();
      mount(tools, h("span", { class: "small dim" }, `PortWatch data to ${shortDay(ms(asOf))}. Published weekly, so the last days lag.`));
    }));

    async function paintBoard() {
      minis.forEach((c) => c.dispose());
      minis.length = 0;
      const wrap = h("div", { class: "multiples" });
      mount(pBoard.body, wrap);
      for (const b of board) {
        const box = h("div", { class: "m-chart" });
        const cell = h("button", { class: "mult", type: "button", "aria-pressed": String(b.id === sel), title: b.role, onclick: () => { sel = b.id; wrap.querySelectorAll(".mult").forEach((x) => x.setAttribute("aria-pressed", String(x === cell))); paintDetail(); paintTable(); } },
          h("div", { class: "m-head" }, h("span", { class: "m-name" }, b.name), h("span", { class: "m-chg " + dirClass(b.yoy) }, isNum(b.yoy) ? spct(b.yoy, 0) : "—")),
          h("div", { class: "m-val" }, num(b.last, b.last < 10 ? 1 : 0), h("span", { class: "tiny muted", style: { marginLeft: "6px", fontWeight: 400 } }, "tankers a day")),
          h("div", { class: "m-sub" }, isNum(b.ly) ? `${num(b.ly, b.ly < 10 ? 1 : 0)} a year ago` : "no year-ago data"),
          box);
        wrap.appendChild(cell);
        const ch = await makeChart(box);
        minis.push(ch);
        const o = tsOption({
          series: [
            { name: "This year", data: b.ma.map((p) => [ms(p.t), p.v]), color: "--s1", width: 1.5 },
            { name: "Last year", data: b.lastYear.map((p) => [ms(p.t), p.v]), color: "--ref", width: 1, dashed: true },
          ],
          legend: false, yFmt: (v) => num(v, 0), tipFmt: (v) => num(v, 1) + " a day", grid: { left: 0, right: 0, top: 4, bottom: 0, containLabel: false },
        });
        o.xAxis.show = false; o.yAxis.show = false; o.yAxis.min = 0;
        ch.set(o);
      }
      pBoard.setData([{ label: "Chokepoint" }, { label: "As of" }, { label: "Tankers/day 7d", num: true }, { label: "Year ago", num: true }, { label: "Change", num: true }, { label: "Prior 4 weeks", num: true }],
        board.map((b) => [b.name, b.asOf, b.last, b.ly, b.yoy, b.prior4]));
      // a strait running at less than half last year's traffic is a supply event
      for (const b of board) if (isNum(b.yoy) && b.yoy < -0.5 && b.ly >= 3) {
        const { raise } = await import("../core/alerts.js");
        raise({ id: `flow-${b.id}-${b.asOf}`, sev: "warn", title: `${b.name}: tanker traffic ${spct(b.yoy, 0)} on last year`, text: `${num(b.last, 1)} tankers a day over the last week (IMF PortWatch).`, source: "PortWatch", quiet: true });
      }
    }

    async function paintDetail() {
      const b = board.find((x) => x.id === sel);
      if (!b) return;
      pDetail.setTitle(`${b.name}: daily tanker transits`);
      const ch = await chartIn(pDetail);
      ch.set(tsOption({
        series: [
          { name: "Daily", data: b.daily.map((r) => [ms(r.t), r.tk]), color: "--s1", type: "bar", opacity: 0.3, z: 1 },
          { name: "7-day average", data: b.ma.map((p) => [ms(p.t), p.v]), color: "--s1", z: 4 },
          { name: "Same weeks last year", data: b.lastYear.map((p) => [ms(p.t), p.v]), color: "--ref", dashed: true, width: 1.5, z: 3 },
        ],
        marks: b.id === "hormuz" || b.id === "bab" || b.id === "suez" || b.id === "cape" ? [{ x: ms("2026-02-28"), label: "Hormuz disruption" }] : [],
        yMin: 0, yFmt: (v) => num(v, 0), tipFmt: (v) => num(v, 1) + " tankers",
      }));
      const tot = b.daily.slice(-7).map((r) => r.tot).filter(isNum);
      const cap = b.daily.slice(-7).map((r) => r.cap).filter(isNum);
      pDetail.setFoot([
        h("span", {}, b.role),
        tot.length ? h("span", {}, `All ships: ${num(tot.reduce((a, v) => a + v, 0) / tot.length, 0)} a day`) : null,
        cap.length ? h("span", {}, `Tanker capacity: ${num(cap.reduce((a, v) => a + v, 0) / cap.length / 1e6, 2)} million dwt a day`) : null,
        b.place ? h("button", { class: "btn ghost", type: "button", onclick: () => go("MAP", b.place) }, "Show on the map") : null,
      ]);
      pDetail.setData([{ label: "Day" }, { label: "Tankers", num: true }, { label: "All ships", num: true }, { label: "Tanker dwt", num: true }], b.daily.map((r) => [r.t, r.tk, r.tot, r.cap]));
    }

    function paintTable() {
      mount(pTable.body, table([
        { label: "Chokepoint", get: (b) => b.name },
        { label: "Data to", get: (b) => shortDay(ms(b.asOf)) },
        { label: "Tankers a day", r: true, title: "7-day average", get: (b) => num(b.last, 1) },
        { label: "Same weeks last year", r: true, get: (b) => num(b.ly, 1) },
        { label: "Change on the year", r: true, cls: (b) => dirClass(b.yoy), get: (b) => spct(b.yoy, 0) },
        { label: "Prior four weeks", r: true, get: (b) => num(b.prior4, 1) },
        { label: "Change on the month", r: true, cls: (b) => dirClass(b.wow4), get: (b) => spct(b.wow4, 0) },
        { label: "Why it matters", get: (b) => h("span", { class: "muted" }, b.role) },
      ], board, { onRow: (b) => { sel = b.id; paintDetail(); paintTable(); pBoard.body.querySelectorAll(".mult").forEach((x, i) => x.setAttribute("aria-pressed", String(board[i]?.id === sel))); }, selected: board.findIndex((b) => b.id === sel) }));
    }

    function paintOil() {
      const d = get("straits:digest");
      const rows = CHOKEPOINTS.map((c) => ({ ...c }));
      mount(pOil.body, table([
        { label: "Route", get: (r) => r.name },
        { label: "1H 2025", r: true, title: "Oil flow, million b/d, before the disruption", get: (r) => num(r.pre, 1) },
        { label: "2Q 2026", r: true, title: "Oil flow, million b/d, during the disruption", get: (r) => num(r.now, 1) },
        { label: "Change", r: true, cls: (r) => dirClass(r.now - r.pre), get: (r) => spct(r.now / r.pre - 1, 0) },
      ], rows),
      h("p", { class: "note", style: { padding: "8px 12px 0" } }, `Million barrels a day of crude and products, EIA and press estimates compiled in the reference layer. The routes overlap (a cargo can cross several), so they do not add up to world trade.`),
      d?.trade ? h("p", { class: "note", style: { padding: "0 12px" } }, `straits.live puts ${pct((d.trade.oilAtRisk || 0) / 100, 0)} of world oil trade at risk from the Gulf disruption, with ${num(d.trade.extraDays, 0)} extra days on the alternative routes.`) : null);
      pOil.setData([{ label: "Route" }, { label: "1H 2025 mb/d", num: true }, { label: "2Q 2026 mb/d", num: true }], rows.map((r) => [r.name, r.pre, r.now]));
    }
  },
};

const M_BOARD = `<p>IMF PortWatch counts the ships that cross each chokepoint every day from AIS positions (UN Global Platform, with the University of Oxford). Each cell shows the 7-day average of tanker crossings, its change on the same seven days 52 weeks earlier (weekdays aligned), and a year of the 7-day average with last year's line dashed.</p>
<p>Limits: AIS misses ships that sail dark, which matters most where sanctions or war apply; PortWatch publishes weekly, so the last few days are missing; tanker counts do not separate crude from products or laden from ballast voyages. Capacity (deadweight tonnes) is a better proxy for volumes than the count when ship sizes shift.</p>`;
const M_DETAIL = `<p>Daily tanker crossings (bars), their 7-day average, and the same weeks of the previous year moved forward 364 days. The footer adds all ship types and the tanker deadweight crossing per day.</p>`;
const M_OIL = `<p>Oil flows through the main routes, compiled from EIA's World Oil Transit Chokepoints estimates for 2025 and press and agency estimates for the second quarter of 2026. They are reference values, not live data: the live signal is the PortWatch transit count on the left.</p>`;
