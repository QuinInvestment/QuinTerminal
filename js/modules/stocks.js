// STK — US inventories and balances from the EIA weekly report, each against
// its five-year seasonal range. The world balance lives in BAL.

import { h, mount } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { tsOption } from "../core/charts.js";
import { num, int, pct, spct, signed, isNum, shortDay, mb, mbd, dirClass, dayYear } from "../core/fmt.js";
import { eventList } from "../core/clock.js";
import { countdown } from "../core/fmt.js";
import * as eia from "../data/eia.js";
import { load, chartIn, table, ms } from "./kit.js";

const BANDS = [
  { id: "WCESTUS1", title: "US commercial crude stocks", span: 6, rows: 7, lead: true },
  { id: "W_EPC0_SAX_YCUOK_MBBL", title: "Cushing, Oklahoma (WTI delivery hub)", span: 6, rows: 7, floor: 20000 },
  { id: "WGTSTUS1", title: "Gasoline stocks", span: 4, rows: 6 },
  { id: "WDISTUS1", title: "Distillate (diesel, heating oil) stocks", span: 4, rows: 6 },
  { id: "WKJSTUS1", title: "Jet fuel stocks", span: 4, rows: 6 },
  { id: "WPULEUS3", title: "Refinery utilisation", span: 6, rows: 6 },
  { id: "WRPUPUS2", title: "Implied demand: total products supplied (4-week average)", span: 6, rows: 6, smooth: 4 },
];

export default {
  title: "US inventories",
  sub: "The EIA weekly petroleum status against the five-year seasonal range: commercial crude, Cushing, products, the Strategic Petroleum Reserve and trade flows. Global stocks and the world balance are in BAL.",

  async mount(view, { scope, tools }) {
    const next = eventList(10).find((e) => e.tag === "EIA");
    if (next) mount(tools, h("span", { class: "small dim" }, `Next EIA report in ${countdown(next.inMs)} (${next.t.toUTCString().slice(0, 22)} UTC)`));

    const bandPanels = BANDS.map((b) => ({ ...b, p: panel({ title: b.title, span: b.span, rows: b.rows, src: ["eia"], chart: true, lead: b.lead, method: M_BAND }) }));
    const pSpr = panel({ title: "Strategic Petroleum Reserve", span: 6, rows: 6, src: ["eia"], chart: true, method: M_SPR });
    const pFlows = panel({ title: "Crude production, imports and exports (4-week average)", span: 6, rows: 6, src: ["eia"], chart: true });
    const pTable = panel({ title: "Weekly balance sheet", span: 12, rows: 8, src: ["eia"], flush: true, method: M_TABLE });
    view.appendChild(grid(...bandPanels.map((b) => b.p), pSpr, pFlows, pTable));

    const weeklyPanels = [...bandPanels.map((b) => b.p), pSpr, pFlows, pTable];
    for (const p of weeklyPanels) p.state("loading", "Loading the EIA weekly report");
    scope.every(30 * 60e3, async () => {
      let w;
      try { w = await eia.weekly(); } catch (e) {
        for (const p of weeklyPanels) if (!p.updatedAt) p.state("error", "EIA data unavailable", e.message);
        return;
      }
      for (const b of bandPanels) await load(b.p, () => drawBand(b, w.series[b.id]));
      await load(pSpr, () => drawSpr(w.series.WCSSTUS1));
      await load(pFlows, () => drawFlows(w));
      await load(pTable, () => drawTable(w));
      // archived copy: the panel clock shows the archive's age, not the moment we drew it
      if (w.archivedAt) for (const p of weeklyPanels) p.touch(Date.parse(w.archivedAt));
    });
    async function drawBand(b, pts) {
      if (!pts || pts.length < 60) throw new Error("Series not available from EIA");
      let series = pts;
      if (b.smooth) series = eia.rollingMean(pts, b.smooth);
      const sea = eia.seasonal(series).slice(-110);
      const isPct = b.id === "WPULEUS3";
      const scale = isPct ? 1 : 1000;
      const unit = isPct ? "%" : (eia.WEEKLY[b.id].unit === "kb/d" ? " mb/d" : " mb");
      const fmt = (v) => (isPct ? num(v, 0) + "%" : num(v / scale, eia.WEEKLY[b.id].unit === "kb/d" ? 1 : 0));
      const ch = await chartIn(b.p);
      const last = sea[sea.length - 1];
      // keep the operational floor in view when one is drawn
      const lo = Math.min(...sea.map((x) => Math.min(x.v, x.min ?? x.v)).filter(isNum));
      ch.set(tsOption({
        series: [
          { name: "This year and last", data: sea.map((x) => [ms(x.t), x.v]), color: "--s1" },
          { name: "5-year average", data: sea.map((x) => [ms(x.t), x.avg]), color: "--s2", width: 1.5, dashed: true },
        ],
        bands: [{ name: "5-year range", lower: sea.map((x) => [ms(x.t), x.min]), upper: sea.map((x) => [ms(x.t), x.max]), color: "--ink-3" }],
        marks: b.floor ? [{ y: b.floor, label: "operational floor, about 20 mb", color: "--hazard" }] : [],
        yMin: b.floor ? Math.floor(Math.min(lo, b.floor) * 0.92 / 1000) * 1000 : undefined,
        yFmt: fmt, tipFmt: (v) => (isPct ? num(v, 1) + "%" : num(v / scale, 2) + unit),
      }));
      const dev = last.v - last.avg;
      b.p.setFoot([h("span", {}, `${shortDay(ms(last.t))}: ${isPct ? num(last.v, 1) + "%" : num(last.v / scale, 1) + unit}`),
        h("span", { class: dirClass(dev) }, `${isPct ? signed(dev, 1) + " pts" : signed(dev / scale, 1) + unit} vs 5y (${spct(dev / last.avg, 1)})`),
        isNum(last.lastYear) ? h("span", {}, `vs last year ${isPct ? signed(last.v - last.lastYear, 1) + " pts" : signed((last.v - last.lastYear) / scale, 1) + unit}`) : null]);
      b.p.setData([{ label: "Week" }, { label: "Value", num: true }, { label: "5y min", num: true }, { label: "5y avg", num: true }, { label: "5y max", num: true }], sea.map((x) => [x.t, x.v, x.min, x.avg, x.max]));
    }

    async function drawSpr(pts) {
      if (!pts?.length) throw new Error("SPR series missing");
      const ch = await chartIn(pSpr);
      ch.set(tsOption({
        series: [{ name: "SPR", data: pts.map((p) => [ms(p.t), p.v / 1000]), color: "--s4", area: 0.1 }],
        marks: [{ x: ms("2022-03-01"), label: "2022 emergency sales" }, { x: ms("2026-02-28"), label: "Hormuz closure" }],
        yFmt: (v) => num(v, 0) + " mb", tipFmt: (v) => num(v, 1) + " mb", legend: false,
      }));
      const last = pts[pts.length - 1], y = pts.find((p) => p.t >= "2026-02-27");
      pSpr.setFoot([h("span", {}, `${shortDay(ms(last.t))}: ${num(last.v / 1000, 1)} mb`), y ? h("span", {}, `${signed((last.v - y.v) / 1000, 1)} mb since the closure`) : null, h("span", {}, `${num(last.v / 1000 / 4.4, 0)} days at the 4.4 mb/d maximum drawdown rate`)]);
      pSpr.setData([{ label: "Week" }, { label: "SPR kb", num: true }], pts.map((p) => [p.t, p.v]));
    }

    async function drawFlows(w) {
      const avg = (id) => eia.rollingMean(w.series[id] || [], 4).filter((p) => p.t >= "2022-01-01").map((p) => [ms(p.t), p.v / 1000]);
      const ch = await chartIn(pFlows);
      ch.set(tsOption({
        series: [{ name: "Production", data: avg("WCRFPUS2"), color: "--s1" }, { name: "Imports", data: avg("WCRIMUS2"), color: "--s2" }, { name: "Exports", data: avg("WCREXUS2"), color: "--s3" }],
        yFmt: (v) => num(v, 0) + " mb/d", tipFmt: (v) => num(v, 2) + " mb/d",
      }));
    }

    async function drawTable(w) {
      const rows = Object.keys(eia.WEEKLY).map((id) => eia.summarise(id, w.series[id])).filter(Boolean);
      const f = (r, v) => (r.unit === "%" ? num(v, 1) + "%" : r.unit === "kb/d" ? num(v / 1000, 2) : num(v / 1000, 1));
      const fd = (r, v) => (r.unit === "%" ? signed(v, 1) : r.unit === "kb/d" ? signed(v / 1000, 2) : signed(v / 1000, 1));
      mount(pTable.body, table([
        { label: "Series", get: (r) => r.name },
        { label: "Unit", get: (r) => (r.unit === "kb" ? "mb" : r.unit === "kb/d" ? "mb/d" : r.unit) },
        { label: "Week to", get: (r) => shortDay(ms(r.t)) },
        { label: "Level", r: true, get: (r) => f(r, r.v) },
        { label: "Weekly change", r: true, cls: (r) => (r.kind === "stock" ? dirClass(r.wow) : ""), get: (r) => fd(r, r.wow) },
        { label: "Seasonal surprise", r: true, title: "Weekly change minus the average change for this week over five years", cls: (r) => (r.kind === "stock" ? dirClass(r.surprise) : ""), get: (r) => fd(r, r.surprise) },
        { label: "5y average", r: true, get: (r) => f(r, r.avg5) },
        { label: "vs 5y", r: true, cls: (r) => (r.kind === "stock" ? dirClass(r.dev) : ""), get: (r) => spct(r.devPct, 1) },
        { label: "z-score", r: true, get: (r) => signed(r.z, 2) },
        { label: "5y range", r: true, get: (r) => `${f(r, r.min5)} – ${f(r, r.max5)}` },
        { label: "vs last year", r: true, get: (r) => fd(r, r.yoy) },
      ], rows));
      pTable.setData([{ label: "Series ID" }, { label: "Name" }, { label: "Week" }, { label: "Level", num: true }, { label: "Weekly change", num: true }, { label: "Seasonal surprise", num: true }, { label: "5y avg", num: true }, { label: "Dev %", num: true }, { label: "z", num: true }], rows.map((r) => [r.id, r.name, r.t, r.v, r.wow, r.surprise, r.avg5, r.devPct, r.z]));
    }
  },
};

const M_BAND = `<p>EIA Weekly Petroleum Status Report, API v2. The shaded band is the minimum to maximum of the same ISO week in the five previous years; the dashed line their average, the convention EIA uses in its own charts. "Seasonal surprise" in the table subtracts the usual change for that week, which is what moves prices on report day (alongside the gap to analysts' expectations, which is not public).</p>`;
const M_SPR = `<p>U.S. Strategic Petroleum Reserve, end of week, thousand barrels. The maximum design drawdown rate is about 4.4 mb/d. The reserve was cut by the 2022 emergency sales and is being drawn again during the 2026 Gulf crisis.</p>`;
const M_TABLE = `<p>All series from one EIA API call (weekly supply estimates). z-score = deviation from the 5-year same-week average divided by the standard deviation of those five values. For stock series, red means a draw or a below-normal level (supportive for prices), green a build.</p>`;
