// REF — refining and products: crack spreads (live from the perps, weekly
// history from EIA spot prices), US refinery runs and utilisation, and product
// demand against the five-year range.

import { h, mount } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { tsOption } from "../core/charts.js";
import { num, signed, spct, usd, isNum, dirClass, shortDay } from "../core/fmt.js";
import { get } from "../core/bus.js";
import * as eia from "../data/eia.js";
import * as hl from "../data/hyperliquid.js";
import { load, chartIn, stat, table, ms } from "./kit.js";

const HO = "EER_EPD2F_PF4_Y35NY_DPG";

export default {
  title: "Refining and products",
  sub: "What refiners earn for turning crude into fuels, how hard US plants are running, and how much gasoline, diesel and jet fuel the market takes. Crack spreads live from the perps and weekly since 2018 from EIA spot prices.",

  async mount(view, { scope }) {
    const pKpi = panel({ title: "Margins now", span: 12, rows: 3, src: ["hl", "eia"], method: M_CRACK });
    const pHist = panel({ title: "Crack spreads, weekly, $ per barrel", span: 8, rows: 8, src: ["eia"], chart: true, method: M_CRACK });
    const pLive = panel({ title: "Diesel crack, live, 7 days", span: 4, rows: 8, src: ["hl"], chart: true, method: M_LIVE });
    const pUtil = panel({ title: "US refinery utilisation", span: 6, rows: 6, src: ["eia"], chart: true, method: M_BAND });
    const pRuns = panel({ title: "US refinery crude runs (4-week average)", span: 6, rows: 6, src: ["eia"], chart: true, method: M_BAND });
    const pGas = panel({ title: "Gasoline demand (4-week average)", span: 4, rows: 6, src: ["eia"], chart: true, method: M_BAND });
    const pDist = panel({ title: "Distillate demand (4-week average)", span: 4, rows: 6, src: ["eia"], chart: true, method: M_BAND });
    const pJet = panel({ title: "Jet fuel demand (4-week average)", span: 4, rows: 6, src: ["eia"], chart: true, method: M_BAND });
    const pTable = panel({ title: "Product prices", span: 12, rows: 6, src: ["eia"], flush: true, method: M_TABLE });
    view.appendChild(grid(pKpi, pHist, pLive, pUtil, pRuns, pGas, pDist, pJet, pTable));

    const ctx = { prod: null, cracks: null, weekly: null };
    for (const p of [pHist, pTable]) p.state("loading", "Loading EIA product prices");

    // ------------------------------------------------ weekly cracks from EIA spot
    scope.every(6 * 3600e3, async () => {
      try {
        ctx.prod = await eia.products();
      } catch (e) {
        for (const p of [pHist, pTable]) if (!p.updatedAt) p.state("error", "EIA product prices unavailable", e.message);
        return;
      }
      ctx.cracks = eia.crackSpreads(ctx.prod.series);
      await load(pHist, drawHist);
      await load(pTable, drawTable);
      paintKpi();
      if (ctx.prod.archivedAt) for (const p of [pHist, pTable]) p.touch(Date.parse(ctx.prod.archivedAt));
    });

    async function drawHist() {
      const c = ctx.cracks;
      if (!c.rows.length) throw new Error("Product price series missing from the EIA response");
      const pick = (f) => c.rows.filter((r) => isNum(r[f])).map((r) => [ms(r.t), r[f]]);
      const ch = await chartIn(pHist);
      ch.set(tsOption({
        series: [
          { name: "3-2-1 crack (NY Harbor, vs WTI)", data: pick("k321"), color: "--s1" },
          { name: "Diesel vs Brent", data: pick("diesel"), color: "--s2" },
          { name: "Gasoline vs Brent", data: pick("gas"), color: "--s3" },
          { name: "Jet vs Brent", data: pick("jet"), color: "--s4" },
        ],
        marks: [{ x: ms("2022-02-24"), label: "Russia invades Ukraine" }, { x: ms("2026-02-28"), label: "Hormuz" }],
        zoom: true, yFmt: (v) => usd(v, 0), tipFmt: (v) => usd(v, 2),
      }));
      const last = c.rows[c.rows.length - 1];
      pHist.setFoot([h("span", {}, `Week to ${shortDay(ms(last.t))}`), h("span", {}, `3-2-1 ${usd(last.k321, 1)}`), h("span", {}, `diesel ${usd(last.diesel, 1)}`), h("span", {}, `gasoline ${usd(last.gas, 1)}`), isNum(last.jet) ? h("span", {}, `jet ${usd(last.jet, 1)}`) : null, h("span", {}, c.dieselLeg === HO ? "Diesel leg: NY Harbor heating oil (ULSD series not returned)" : "Diesel leg: NY Harbor ULSD")]);
      pHist.setData([{ label: "Week" }, { label: "3-2-1", num: true }, { label: "Diesel-Brent", num: true }, { label: "Gasoline-Brent", num: true }, { label: "Jet-Brent", num: true }], c.rows.map((r) => [r.t, r.k321, r.diesel, r.gas, r.jet]));
    }

    function drawTable() {
      const S = ctx.prod.series;
      const brent = new Map((S.RBRTE || []).map((p) => [p.t, p.v]));
      const rows = Object.entries(eia.PRODUCTS).map(([id, m]) => {
        const pts = S[id] || [];
        if (!pts.length) return null;
        const last = pts[pts.length - 1];
        const m4 = pts[pts.length - 5], y1 = pts[pts.length - 53];
        const b = brent.get(last.t);
        return { id, ...m, t: last.t, v: last.v, bbl: last.v * 42, crack: isNum(b) ? last.v * 42 - b : NaN, ch4: m4 ? last.v / m4.v - 1 : NaN, ch52: y1 ? last.v / y1.v - 1 : NaN };
      }).filter(Boolean);
      for (const [id, name] of [["RBRTE", "Brent (Europe)"], ["RWTC", "WTI (Cushing)"]]) {
        const pts = S[id] || [];
        if (!pts.length) continue;
        const last = pts[pts.length - 1], m4 = pts[pts.length - 5], y1 = pts[pts.length - 53];
        rows.push({ id, name, short: name, t: last.t, v: last.v / 42, bbl: last.v, crack: NaN, ch4: m4 ? last.v / m4.v - 1 : NaN, ch52: y1 ? last.v / y1.v - 1 : NaN, crude: true });
      }
      if (!rows.length) throw new Error("No product prices returned");
      mount(pTable.body, table([
        { label: "Product", get: (r) => r.name },
        { label: "Week to", get: (r) => shortDay(ms(r.t)) },
        { label: "$ per gallon", r: true, get: (r) => (r.crude ? "—" : num(r.v, 3)) },
        { label: "$ per barrel", r: true, get: (r) => num(r.bbl, 2) },
        { label: "Crack vs Brent", r: true, get: (r) => (isNum(r.crack) ? usd(r.crack, 2) : "—") },
        { label: "4 weeks", r: true, cls: (r) => dirClass(r.ch4), get: (r) => spct(r.ch4, 1) },
        { label: "1 year", r: true, cls: (r) => dirClass(r.ch52), get: (r) => spct(r.ch52, 1) },
      ], rows));
      pTable.setData([{ label: "EIA series" }, { label: "Product" }, { label: "Week" }, { label: "$/b", num: true }, { label: "Crack vs Brent $/b", num: true }], rows.map((r) => [r.id, r.name, r.t, r.bbl, r.crack]));
    }

    // ------------------------------------------------ live crack from the perps
    scope.every(5 * 60e3, () => load(pLive, async () => {
      const since = Date.now() - 7 * 86400000;
      const [cl, b, ho] = await Promise.all([hl.candles("xyz:CL", "1h", since), hl.candles("xyz:BRENTOIL", "1h", since), hl.candles("xyz:HO", "1h", since)]);
      const mB = new Map(b.map((c) => [c.t, c.c])), mC = new Map(cl.map((c) => [c.t, c.c]));
      const vsB = ho.filter((c) => mB.has(c.t)).map((c) => [c.t, c.c * 42 - mB.get(c.t)]);
      const vsW = ho.filter((c) => mC.has(c.t)).map((c) => [c.t, c.c * 42 - mC.get(c.t)]);
      if (!vsB.length) throw new Error("No ULSD perp candles");
      const ch = await chartIn(pLive);
      ch.set(tsOption({ series: [{ name: "ULSD × 42 − Brent", data: vsB, color: "--s1" }, { name: "ULSD × 42 − WTI", data: vsW, color: "--s2" }], yFmt: (v) => usd(v, 0), tipFmt: (v) => usd(v, 2) }));
      pLive.setFoot("Hourly closes of the trade.xyz perps. The ULSD perp is thin: use the level with care.");
      pLive.setData([{ label: "Hour" }, { label: "vs Brent", num: true }, { label: "vs WTI", num: true }], vsB.map(([t, v], i) => [new Date(t).toISOString(), v, vsW[i]?.[1]]));
    }));
    scope.sub("tape", () => paintKpi());

    // ------------------------------------------------ US refinery runs and product demand
    for (const p of [pUtil, pRuns, pGas, pDist, pJet]) p.state("loading", "Loading the EIA weekly report");
    scope.every(30 * 60e3, async () => {
      try { ctx.weekly = await eia.weekly(); } catch (e) {
        for (const p of [pUtil, pRuns, pGas, pDist, pJet]) if (!p.updatedAt) p.state("error", "EIA data unavailable", e.message);
        return;
      }
      const w = ctx.weekly;
      await load(pUtil, () => band(pUtil, w.series.WPULEUS3, { pct: true }));
      await load(pRuns, () => band(pRuns, eia.rollingMean(w.series.WCRRIUS2 || [], 4), {}));
      await load(pGas, () => band(pGas, eia.rollingMean(w.series.WGFUPUS2 || [], 4), {}));
      await load(pDist, () => band(pDist, eia.rollingMean(w.series.WDIUPUS2 || [], 4), {}));
      await load(pJet, () => band(pJet, eia.rollingMean(w.series.WKJUPUS2 || [], 4), {}));
      if (w.archivedAt) for (const p of [pUtil, pRuns, pGas, pDist, pJet]) p.touch(Date.parse(w.archivedAt));
      paintKpi();
    });

    async function band(p, pts, { pct = false }) {
      if (!pts || pts.length < 60) throw new Error("Series not available from EIA");
      const sea = eia.seasonal(pts).slice(-110);
      const fmt = (v) => (pct ? num(v, 0) + "%" : num(v / 1000, 1));
      const ch = await chartIn(p);
      ch.set(tsOption({
        series: [
          { name: "This year and last", data: sea.map((x) => [ms(x.t), x.v]), color: "--s1" },
          { name: "5-year average", data: sea.map((x) => [ms(x.t), x.avg]), color: "--s2", width: 1.5, dashed: true },
        ],
        bands: [{ name: "5-year range", lower: sea.map((x) => [ms(x.t), x.min]), upper: sea.map((x) => [ms(x.t), x.max]), color: "--ink-3" }],
        yFmt: fmt, tipFmt: (v) => (pct ? num(v, 1) + "%" : num(v / 1000, 2) + " mb/d"),
      }));
      const last = sea[sea.length - 1], dev = last.v - last.avg;
      p.setFoot([h("span", {}, `${shortDay(ms(last.t))}: ${pct ? num(last.v, 1) + "%" : num(last.v / 1000, 2) + " mb/d"}`), h("span", { class: dirClass(dev) }, `${pct ? signed(dev, 1) + " pts" : signed(dev / 1000, 2) + " mb/d"} vs the 5-year average`)]);
      p.setData([{ label: "Week" }, { label: "Value", num: true }, { label: "5y min", num: true }, { label: "5y avg", num: true }, { label: "5y max", num: true }], sea.map((x) => [x.t, x.v, x.min, x.avg, x.max]));
    }

    function paintKpi() {
      const t = get("tape");
      const liveB = t && isNum(t.rows.HO?.px) && isNum(t.rows.BRENT?.px) ? t.rows.HO.px * 42 - t.rows.BRENT.px : NaN;
      const last = ctx.cracks?.rows?.[ctx.cracks.rows.length - 1];
      const prev = ctx.cracks?.rows?.[ctx.cracks.rows.length - 5];
      const util = ctx.weekly ? eia.summarise("WPULEUS3", ctx.weekly.series.WPULEUS3) : null;
      const d = (f) => (last && prev && isNum(last[f]) && isNum(prev[f]) ? `${signed(last[f] - prev[f], 1)} in 4 weeks` : "");
      mount(pKpi.body, h("div", { class: "stats", style: { gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" } },
        stat("Diesel crack, live", isNum(liveB) ? usd(liveB, 1) : "—", "ULSD perp × 42 − Brent perp"),
        stat("3-2-1 crack", last ? usd(last.k321, 1) : "—", d("k321"), { deltaCls: last && prev ? dirClass(last.k321 - prev.k321) : "" }),
        stat("Diesel vs Brent", last ? usd(last.diesel, 1) : "—", d("diesel"), { deltaCls: last && prev ? dirClass(last.diesel - prev.diesel) : "" }),
        stat("Gasoline vs Brent", last ? usd(last.gas, 1) : "—", d("gas"), { deltaCls: last && prev ? dirClass(last.gas - prev.gas) : "" }),
        stat("Jet vs Brent", last && isNum(last.jet) ? usd(last.jet, 1) : "—", d("jet"), { deltaCls: last && prev ? dirClass(last.jet - prev.jet) : "" }),
        stat("US refinery utilisation", util ? num(util.v, 1) + "%" : "—", util ? `${signed(util.dev, 1)} pts vs 5-year average` : "", { deltaCls: util ? dirClass(util.dev) : "" })));
      pKpi.touch();
      pKpi.state("ok");
    }
  },
};

const M_CRACK = `<p>A crack spread is the value of the products a refinery makes from a barrel minus the cost of that barrel. The 3-2-1 crack assumes three barrels of WTI make two of gasoline and one of diesel: (2 × gasoline + 1 × diesel) × 42 − 3 × WTI, divided by three, in $ per barrel. Single-product cracks use Brent, the seaborne marker.</p>
<p>Prices: EIA weekly averages of daily spot assessments, New York Harbor conventional gasoline (EER_EPMRU_PF4_Y35NY_DPG), NY Harbor ULSD (EER_EPD2DXL0_PF4_Y35NY_DPG, or No. 2 heating oil when ULSD is not returned), US Gulf Coast jet fuel (EER_EPJK_PF4_RGC_DPG), WTI Cushing and Brent. EIA publishes them with a lag of about a week; the live crack comes from the perps.</p>`;
const M_LIVE = `<p>trade.xyz perpetuals on Hyperliquid: NY Harbor ULSD ($ per gallon, × 42 for a barrel) minus Brent or WTI, hourly closes. The perps track CME and ICE futures through an oracle and trade around the clock; they are not exchange settlements, and the ULSD perp is thin.</p>`;
const M_BAND = `<p>EIA Weekly Petroleum Status Report. The band is the minimum to maximum of the same ISO week in the five previous years, the dashed line their average. Demand is "product supplied", EIA's proxy for consumption: refinery and blender output plus imports minus exports and stock change.</p>`;
const M_TABLE = `<p>EIA weekly averages of daily spot prices. Crack vs Brent = product price × 42 − Brent, $ per barrel, the same week.</p>`;
