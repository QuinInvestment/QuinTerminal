// BAL — the world oil balance from the EIA's Short-Term Energy Outlook:
// supply against demand, the implied stock change, OPEC's spare capacity,
// unplanned outages, supply and demand by bloc, and the main producers.

import { h, mount } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { tsOption, makeChart } from "../core/charts.js";
import { num, signed, pct, isNum, dirClass } from "../core/fmt.js";
import * as eia from "../data/eia.js";
import { load, chartIn, stat, table } from "./kit.js";

const mid = (t) => Date.parse(t + "-15T00:00:00Z");
const first = (t) => Date.parse(t + "-01T00:00:00Z");
const PREWAR = "2026-02";

export default {
  title: "World oil balance",
  sub: "Supply against demand, the implied stock change, OPEC spare capacity and supply outages, by bloc and by producer. EIA Short-Term Energy Outlook: history and the official forecast to the end of next year.",

  async mount(view, { scope, tools }) {
    const pKpi = panel({ title: "The balance at a glance", span: 12, rows: 3, src: ["eia"], method: M_KPI });
    const pStock = panel({ title: "Implied global stock change", span: 7, rows: 7, src: ["eia"], chart: true, method: M_STOCK });
    const pSD = panel({ title: "World supply and demand", span: 5, rows: 7, src: ["eia"], chart: true, method: M_SD });
    const pSpare = panel({ title: "Spare capacity and the price of Brent", span: 7, rows: 9, src: ["eia"], method: M_SPARE });
    const pOut = panel({ title: "Unplanned supply outages", span: 5, rows: 9, src: ["eia"], chart: true, method: M_OUT });
    const pSup = panel({ title: "Supply by bloc", span: 6, rows: 6, src: ["eia"], chart: true, method: M_BLOC });
    const pDem = panel({ title: "Demand by bloc", span: 6, rows: 6, src: ["eia"], chart: true, method: M_BLOC });
    const pProd = panel({ title: "Crude production by country", span: 12, rows: 8, src: ["eia"], flush: true, method: M_PROD });
    view.appendChild(grid(pKpi, pStock, pSD, pSpare, pOut, pSup, pDem, pProd));

    const all = [pKpi, pStock, pSD, pSpare, pOut, pSup, pDem, pProd];
    for (const p of all) p.state("loading", "Loading the EIA outlook");

    scope.every(6 * 3600e3, async () => {
      let s;
      try { s = await eia.steo(); } catch (e) {
        for (const p of all) if (!p.updatedAt) p.state("error", "EIA outlook unavailable", e.message);
        return;
      }
      const now = new Date().toISOString().slice(0, 7);
      const S = s.series;
      const fcStart = first(now);
      const lastOf = (id) => (S[id] || []).filter((p) => p.t < now).pop();
      const at = (id, t) => (S[id] || []).find((p) => p.t === t);
      const ahead = (id, k) => (S[id] || []).filter((p) => p.t >= now)[k];
      const forecastArea = (series) => (series.length ? [{ from: fcStart, to: mid(series[series.length - 1].t) + 15 * 86400000, label: "EIA forecast" }] : []);
      mount(tools, h("span", { class: "small dim" }, `EIA STEO ${s.archivedAt ? "archive of " + s.archivedAt.slice(0, 10) : "live"}. Months from ${now} on are forecasts.`));

      // ------------------------------------------------ balance series
      const pr = S.PAPR_WORLD || [], co = S.PATC_WORLD || [];
      const cm = new Map(co.map((p) => [p.t, p.v]));
      const bal = pr.filter((p) => cm.has(p.t)).map((p) => ({ t: p.t, v: p.v - cm.get(p.t), prod: p.v, cons: cm.get(p.t) }));

      await load(pKpi, async () => {
        if (!bal.length) throw new Error("World balance series missing from the EIA response");
        const cur = bal.filter((p) => p.t < now).pop();
        const next6 = bal.filter((p) => p.t >= now).slice(0, 6);
        const avg6 = next6.length ? next6.reduce((a, p) => a + p.v, 0) / next6.length : NaN;
        const spare = lastOf("COPS_OPEC"), dem = lastOf("PATC_WORLD");
        const outO = lastOf("PADI_OPEC"), outN = lastOf("PADI_NONOPEC");
        const outages = (outO?.v || 0) + (outN?.v || 0);
        const b6 = ahead("BREPUUS", 6);
        mount(pKpi.body, h("div", { class: "stats", style: { gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" } },
          stat(`Supply, ${label(cur?.t)}`, cur ? num(cur.prod, 2) : "—", "million b/d, world liquids"),
          stat(`Demand, ${label(cur?.t)}`, cur ? num(cur.cons, 2) : "—", "million b/d"),
          stat("Implied stock change", cur ? signed(cur.v, 2) : "—", cur ? (cur.v < 0 ? "million b/d, stocks drawing" : "million b/d, stocks building") : "", { cls: cur ? dirClass(cur.v) : "" }),
          stat("Next six months", isNum(avg6) ? signed(avg6, 2) : "—", "EIA forecast, average million b/d", { cls: dirClass(avg6) }),
          stat("OPEC spare capacity", spare ? num(spare.v, 2) : "—", spare && dem ? `million b/d, ${pct(spare.v / dem.v, 1)} of demand` : "million b/d"),
          stat("Unplanned outages", outO || outN ? num(outages, 2) : "—", "million b/d, OPEC and others"),
          stat(`EIA Brent, ${b6 ? label(b6.t) : "in six months"}`, b6 ? "$" + num(b6.v, 0) : "—", "forecast, monthly average")));
        pKpi.setData([{ label: "Month" }, { label: "Supply mb/d", num: true }, { label: "Demand mb/d", num: true }, { label: "Balance mb/d", num: true }], bal.map((p) => [p.t, p.prod, p.cons, p.v]));
      });

      await load(pStock, async () => {
        if (!bal.length) throw new Error("World balance series missing");
        const ch = await chartIn(pStock);
        ch.set(tsOption({
          series: [
            { name: "Stocks build (surplus)", data: bal.map((p) => [mid(p.t), p.v >= 0 ? p.v : null]), color: "--div-pos", type: "bar" },
            { name: "Stocks draw (deficit)", data: bal.map((p) => [mid(p.t), p.v < 0 ? p.v : null]), color: "--div-neg", type: "bar" },
          ],
          areas: forecastArea(bal),
          marks: [{ x: first(PREWAR) + 27 * 86400000, label: "Hormuz disruption" }],
          yFmt: (v) => num(v, 1), tipFmt: (v) => signed(v, 2) + " mb/d",
        }));
        const fut = bal.filter((p) => p.t >= now);
        const cum = fut.reduce((a, p) => a + p.v * 30.4, 0);
        pStock.setFoot([h("span", {}, "World production minus consumption, million b/d."), fut.length ? h("span", { class: dirClass(cum) }, `Forecast months add up to ${signed(cum, 0)} million barrels of ${cum < 0 ? "draws" : "builds"}.`) : null]);
        pStock.setData([{ label: "Month" }, { label: "Balance mb/d", num: true }], bal.map((p) => [p.t, p.v]));
      });

      await load(pSD, async () => {
        if (!bal.length) throw new Error("World balance series missing");
        const ch = await chartIn(pSD);
        ch.set(tsOption({
          series: [
            { name: "Supply", data: bal.map((p) => [mid(p.t), p.prod]), color: "--s1" },
            { name: "Demand", data: bal.map((p) => [mid(p.t), p.cons]), color: "--s2" },
          ],
          areas: forecastArea(bal),
          yFmt: (v) => num(v, 0), tipFmt: (v) => num(v, 2) + " mb/d",
        }));
        pSD.setFoot("World liquids: crude, condensate, natural gas liquids, biofuels and refinery gains, million b/d.");
      });

      // ------------------------------------------------ spare capacity, small multiples over the same months
      await load(pSpare, async () => {
        const sp = S.COPS_OPEC || [], me = S.COPS_OPEC_R05 || [], br = S.BREPUUS || [];
        if (!sp.length && !br.length) throw new Error("Spare capacity and price series missing");
        if (!pSpare._boxes) {
          const top = h("div", { class: "chart-box", style: { height: "54%", minHeight: "120px" } });
          const cap = h("div", { class: "tiny muted", style: { margin: "6px 0 2px 8px" } }, "Brent, monthly average and EIA path, $ per barrel");
          const bottom = h("div", { class: "chart-box", style: { height: "calc(46% - 26px)", minHeight: "100px" } });
          pSpare.body.style.padding = "8px 8px 4px";
          pSpare.body.append(h("div", { class: "tiny muted", style: { margin: "0 0 2px 8px" } }, "OPEC spare crude capacity, million b/d"), top, cap, bottom);
          pSpare._boxes = { top: await makeChart(top), bottom: await makeChart(bottom) };
          scope.add(() => { pSpare._boxes.top.dispose(); pSpare._boxes.bottom.dispose(); });
        }
        const x0 = mid((sp[0] || br[0]).t), x1 = mid((sp[sp.length - 1] || br[br.length - 1]).t);
        const common = { areas: forecastArea(sp.length ? sp : br), grid: { left: 8, right: 14 } };
        const o1 = tsOption({ series: [{ name: "OPEC", data: sp.map((p) => [mid(p.t), p.v]), color: "--s1", area: 0.1 }, me.length ? { name: "of which Middle East", data: me.map((p) => [mid(p.t), p.v]), color: "--s3" } : null].filter(Boolean), yFmt: (v) => num(v, 1), tipFmt: (v) => num(v, 2) + " mb/d", ...common });
        const o2 = tsOption({ series: [{ name: "Brent", data: br.map((p) => [mid(p.t), p.v]), color: "--s2" }], legend: false, yFmt: (v) => "$" + num(v, 0), tipFmt: (v) => "$" + num(v, 1), ...common });
        for (const o of [o1, o2]) { o.xAxis.min = x0; o.xAxis.max = x1; }
        pSpare._boxes.top.set(o1);
        pSpare._boxes.bottom.set(o2);
        const last = sp.filter((p) => p.t < now).pop(), pre = sp.find((p) => p.t === PREWAR);
        pSpare.setFoot(last ? [h("span", {}, `Spare capacity ${num(last.v, 2)} mb/d in ${label(last.t)}`), pre ? h("span", {}, `${signed(last.v - pre.v, 2)} mb/d since ${label(PREWAR)}`) : null, h("span", {}, "A thin buffer leaves less room to absorb the next outage.")] : "");
        pSpare.setData([{ label: "Month" }, { label: "OPEC spare mb/d", num: true }, { label: "Middle East spare mb/d", num: true }, { label: "Brent $/b", num: true }], (sp.length ? sp : br).map((p) => [p.t, at("COPS_OPEC", p.t)?.v, at("COPS_OPEC_R05", p.t)?.v, at("BREPUUS", p.t)?.v]));
      });

      await load(pOut, async () => {
        const o = S.PADI_OPEC || [], n = S.PADI_NONOPEC || [];
        if (!o.length && !n.length) throw new Error("Outage series (PADI) not returned by EIA");
        const ch = await chartIn(pOut);
        const opt = tsOption({
          series: [
            { name: "OPEC", data: o.map((p) => [mid(p.t), p.v]), color: "--s1", type: "bar" },
            { name: "Others", data: n.map((p) => [mid(p.t), p.v]), color: "--s3", type: "bar" },
          ],
          areas: forecastArea(o.length ? o : n),
          yFmt: (v) => num(v, 1), tipFmt: (v) => num(v, 2) + " mb/d",
        });
        for (const sr of opt.series) if (sr.type === "bar") sr.stack = "out";
        ch.set(opt);
        const lo = o.filter((p) => p.t < now).pop(), ln = n.filter((p) => p.t < now).pop();
        pOut.setFoot(lo || ln ? `${label((lo || ln).t)}: ${num((lo?.v || 0) + (ln?.v || 0), 2)} million b/d offline that would otherwise flow (wars, sanctions, accidents, strikes). EIA estimate.` : "");
        pOut.setData([{ label: "Month" }, { label: "OPEC mb/d", num: true }, { label: "Others mb/d", num: true }], o.map((p) => [p.t, p.v, at("PADI_NONOPEC", p.t)?.v]));
      });

      await load(pSup, async () => {
        const a = S.PAPR_OPEC || [], b = S.PAPR_NONOPEC || [];
        if (!a.length && !b.length) throw new Error("Bloc supply series missing");
        const ch = await chartIn(pSup);
        ch.set(tsOption({ series: [{ name: "Non-OPEC", data: b.map((p) => [mid(p.t), p.v]), color: "--s1" }, { name: "OPEC", data: a.map((p) => [mid(p.t), p.v]), color: "--s2" }], areas: forecastArea(a.length ? a : b), yFmt: (v) => num(v, 0), tipFmt: (v) => num(v, 2) + " mb/d" }));
        pSup.setFoot("Liquids production, million b/d. Non-OPEC includes the US, Brazil, Guyana, Canada and Norway, which set the pace of growth.");
        pSup.setData([{ label: "Month" }, { label: "OPEC", num: true }, { label: "Non-OPEC", num: true }], a.map((p) => [p.t, p.v, at("PAPR_NONOPEC", p.t)?.v]));
      });

      await load(pDem, async () => {
        const a = S.PATC_OECD || [], b = S.PATC_NON_OECD || [];
        if (!a.length && !b.length) throw new Error("Bloc demand series missing");
        const ch = await chartIn(pDem);
        ch.set(tsOption({ series: [{ name: "Non-OECD", data: b.map((p) => [mid(p.t), p.v]), color: "--s1" }, { name: "OECD", data: a.map((p) => [mid(p.t), p.v]), color: "--s2" }], areas: forecastArea(a.length ? a : b), yFmt: (v) => num(v, 0), tipFmt: (v) => num(v, 2) + " mb/d" }));
        pDem.setFoot("Consumption, million b/d. Non-OECD demand (China, India, the Middle East) drives the growth; OECD demand is flat to falling.");
        pDem.setData([{ label: "Month" }, { label: "OECD", num: true }, { label: "Non-OECD", num: true }], a.map((p) => [p.t, p.v, at("PATC_NON_OECD", p.t)?.v]));
      });

      // ------------------------------------------------ producers
      await load(pProd, async () => {
        const rows = Object.entries(eia.PRODUCERS).map(([id, name]) => {
          const pts = S[id] || [];
          if (!pts.length) return null;
          const last = pts.filter((p) => p.t < now).pop();
          if (!last) return null;
          const yago = pts.find((p) => p.t === shiftMonth(last.t, -12));
          const pre = pts.find((p) => p.t === PREWAR);
          const f6 = pts.filter((p) => p.t >= now)[6];
          return { id, name, t: last.t, v: last.v, pre: pre?.v, yago: yago?.v, f6: f6?.v, f6t: f6?.t };
        }).filter(Boolean).sort((a, b) => b.v - a.v);
        const us = lastOf("COPRPUS");
        if (us) rows.push({ id: "COPRPUS", name: "United States", t: us.t, v: us.v, pre: at("COPRPUS", PREWAR)?.v, yago: at("COPRPUS", shiftMonth(us.t, -12))?.v, f6: ahead("COPRPUS", 6)?.v });
        rows.sort((a, b) => b.v - a.v);
        if (rows.length < 3) {
          // the country series are optional: fall back to the blocs
          const bl = ["COPR_OPECPLUS", "COPR_OPEC", "COPR_NONOPECPLUS_XUS", "COPRPUS"].map((id) => {
            const l = lastOf(id);
            return l ? { id, name: eia.STEO[id].name, t: l.t, v: l.v, pre: at(id, PREWAR)?.v, yago: at(id, shiftMonth(l.t, -12))?.v, f6: ahead(id, 6)?.v } : null;
          }).filter(Boolean);
          if (!bl.length) throw new Error("No production series returned by EIA");
          rows.splice(0, rows.length, ...bl);
        }
        const byCountry = rows.every((r) => r.id in eia.PRODUCERS || r.id === "COPRPUS");
        const total = byCountry ? rows.reduce((a, r) => a + r.v, 0) : NaN;
        mount(pProd.body, table([
          { label: "Producer", get: (r) => r.name },
          { label: "Month", get: (r) => label(r.t) },
          { label: "Crude, mb/d", r: true, get: (r) => num(r.v, 2) },
          { label: `vs ${label(PREWAR)}`, r: true, title: "Change since the month before the Hormuz disruption", cls: (r) => dirClass(r.v - r.pre), get: (r) => (isNum(r.pre) ? signed(r.v - r.pre, 2) : "—") },
          { label: "vs a year ago", r: true, cls: (r) => dirClass(r.v - r.yago), get: (r) => (isNum(r.yago) ? signed(r.v - r.yago, 2) : "—") },
          { label: "EIA in six months", r: true, get: (r) => (isNum(r.f6) ? num(r.f6, 2) : "—") },
          { label: "Change to then", r: true, cls: (r) => dirClass(r.f6 - r.v), get: (r) => (isNum(r.f6) ? signed(r.f6 - r.v, 2) : "—") },
          { label: "Share of listed", r: true, get: (r) => (isNum(total) && total > 0 ? pct(r.v / total, 1) : "—") },
        ], rows));
        pProd.setData([{ label: "Series" }, { label: "Producer" }, { label: "Month" }, { label: "mb/d", num: true }, { label: "Pre-disruption", num: true }, { label: "Year ago", num: true }, { label: "EIA +6m", num: true }], rows.map((r) => [r.id, r.name, r.t, r.v, r.pre, r.yago, r.f6]));
      });

      if (s.archivedAt) for (const p of all) p.touch(Date.parse(s.archivedAt));
    });
  },
};

function shiftMonth(t, k) {
  const [y, m] = t.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return d.toISOString().slice(0, 7);
}
function label(t) {
  if (!t) return "—";
  return new Date(first(t)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

const M_KPI = `<p>U.S. EIA Short-Term Energy Outlook through API v2, monthly. The latest month before today is an EIA estimate; the months after are the official forecast, revised each month (the release dates are in CAL).</p><p>Implied stock change = world liquids production minus consumption. Spare capacity is OPEC crude capacity that could be brought online within 30 days and held for 90 days, as EIA defines it. Outages are unplanned crude and liquids disruptions.</p>`;
const M_STOCK = `<p>World production minus world consumption, million barrels a day. Positive months build inventories (bearish), negative months draw them (bullish). The shaded months are EIA's forecast. A month of a 1 mb/d deficit removes about 30 million barrels from global stocks.</p>`;
const M_SD = `<p>World liquids production and consumption from STEO table 3a. Levels sit near 100 mb/d, so the gap that matters is drawn separately in the stock change chart rather than on a second axis.</p>`;
const M_SPARE = `<p>Two charts over the same months instead of one chart with two axes. Spare capacity (EIA series COPS_OPEC; the Middle East part is COPS_OPEC_R05) is the market's shock absorber: when it is thin, any outage passes straight into prices. Most of it sits in Saudi Arabia, the UAE and Kuwait, behind Hormuz, which is why a Gulf disruption both removes supply and locks up the buffer.</p>`;
const M_OUT = `<p>EIA's estimate of unplanned production outages (PADI_OPEC and PADI_NONOPEC): output lost to conflict, sanctions, accidents or strikes, not voluntary cuts. Stacked bars, million b/d.</p>`;
const M_BLOC = `<p>Production by OPEC membership (PAPR_OPEC, PAPR_NONOPEC) and consumption by OECD membership (PATC_OECD, PATC_NON_OECD), million b/d, from the STEO. The shaded months are forecasts.</p>`;
const M_PROD = `<p>Crude oil production by country from STEO table 3d (series COPR_ followed by the country code), million b/d. If EIA does not return the country series, the table falls back to the blocs: OPEC+, OPEC, non-OPEC+ excluding the US, and the US.</p><p>"vs Feb 2026" compares with the last month before the Hormuz disruption.</p>`;
