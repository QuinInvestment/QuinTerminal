// POS — who is positioned how: CFTC Commitments of Traders for crude and
// products, and the funding/open interest of the 24/7 perps.

import { h, mount } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { tsOption, heatOption } from "../core/charts.js";
import { num, int, pct, spct, signed, isNum, shortDay, compact, dirClass } from "../core/fmt.js";
import { eventList } from "../core/clock.js";
import { countdown } from "../core/fmt.js";
import * as S from "../core/stats.js";
import * as cftc from "../data/cftc.js";
import * as hl from "../data/hyperliquid.js";
import { load, chartIn, table, ms } from "./kit.js";

export default {
  title: "Positioning",
  sub: "CFTC Commitments of Traders for WTI, Brent, gasoline, diesel and gas, and the funding and open interest of the 24/7 oil perps.",

  async mount(view, { scope, tools }) {
    const next = eventList(10).find((e) => e.tag === "COT");
    if (next) mount(tools, h("span", { class: "small dim" }, `Next COT release in ${countdown(next.inMs)}`));
    const pMain = panel({ title: "WTI: managed-money longs, shorts and net", span: 8, rows: 8, src: ["cftc"], chart: true, lead: true, method: M_COT });
    const pBoard = panel({ title: "Positioning board", span: 4, rows: 8, src: ["cftc"], flush: true, method: M_BOARD });
    const pWho = panel({ title: "WTI net positions by trader group", span: 6, rows: 7, src: ["cftc"], chart: true });
    const pHeat = panel({ title: "Speculator net length, z-score by week", span: 6, rows: 7, src: ["cftc"], chart: true, method: M_HEAT });
    const pFund = panel({ title: "Perp funding, annualised (7 days)", span: 6, rows: 6, src: ["hl"], chart: true, method: M_FUND });
    const pTraders = panel({ title: "WTI: number of managed-money traders", span: 6, rows: 6, src: ["cftc"], chart: true });
    view.appendChild(grid(pMain, pBoard, pWho, pHeat, pFund, pTraders));

    scope.every(60 * 60e3, async () => {
      let by;
      try { by = await cftc.cot(); } catch (e) { for (const p of [pMain, pBoard, pWho, pHeat, pTraders]) p.state("error", "CFTC data unavailable", e.message); return; }
      const wti = by["067651"] || [];
      await load(pMain, async () => {
        const ch = await chartIn(pMain);
        ch.set(tsOption({
          series: [
            // 300+ weekly reports: thin bars alias into stripes, filled steps read cleanly
            { name: "Long", data: wti.map((r) => [ms(r.t), r.mmL / 1000]), color: "--s3", area: 0.12, width: 1, step: "end" },
            { name: "Short (shown negative)", data: wti.map((r) => [ms(r.t), -r.mmS / 1000]), color: "--s8", area: 0.12, width: 1, step: "end" },
            { name: "Net", data: wti.map((r) => [ms(r.t), r.mmNet / 1000]), color: "--s1", width: 2 },
          ],
          marks: [{ y: 0 }, { x: ms("2026-02-28"), label: "Hormuz closure" }],
          yFmt: (v) => num(v, 0) + "k", tipFmt: (v) => num(v, 1) + "k contracts", zoom: true,
        }));
        pMain.setData([{ label: "Report date" }, { label: "MM long", num: true }, { label: "MM short", num: true }, { label: "MM net", num: true }, { label: "Open interest", num: true }], wti.map((r) => [r.t, r.mmL, r.mmS, r.mmNet, r.oi]));
      });
      await load(pBoard, async () => {
        const rows = Object.entries(cftc.CONTRACTS).map(([code, c]) => ({ code, ...c, s: cftc.positioning(by[code]) })).filter((r) => r.s);
        mount(pBoard.body, table([
          { label: "Contract", get: (r) => r.name.replace(" (NYMEX)", "") },
          { label: "Net", r: true, get: (r) => compact(r.s.net, 0) },
          { label: "Week", r: true, cls: (r) => dirClass(r.s.wow), get: (r) => signed(r.s.wow / 1000, 1) + "k" },
          { label: "% OI", r: true, get: (r) => pct(r.s.netPct, 1) },
          { label: "3y pctile", r: true, get: (r) => h("span", { class: r.s.pctile > 0.85 ? "tag warn" : r.s.pctile < 0.15 ? "tag ok" : "", title: r.s.pctile > 0.85 ? "Crowded long" : r.s.pctile < 0.15 ? "Crowded short" : "" }, pct(r.s.pctile, 0)) },
        ], rows),
          h("p", { class: "note", style: { padding: "8px 10px" } }, `Data as of Tuesday ${rows[0] ? shortDay(ms(rows[0].s.t)) : ""}. Above the 85th percentile, speculators are crowded long: a source of downside if the news turns. Below the 15th, the reverse.`));
        pBoard.setData([{ label: "Contract" }, { label: "Net", num: true }, { label: "Weekly change", num: true }, { label: "Net % OI", num: true }, { label: "3y percentile", num: true }, { label: "z", num: true }], rows.map((r) => [r.name, r.s.net, r.s.wow, r.s.netPct, r.s.pctile, r.s.z]));
      });
      await load(pWho, async () => {
        const ch = await chartIn(pWho);
        ch.set(tsOption({
          series: [
            { name: "Managed money", data: wti.map((r) => [ms(r.t), r.mmNet / 1000]), color: "--s1" },
            { name: "Producers and merchants", data: wti.map((r) => [ms(r.t), r.pmNet / 1000]), color: "--s4" },
            { name: "Swap dealers", data: wti.map((r) => [ms(r.t), r.swNet / 1000]), color: "--s7" },
            { name: "Other reportables", data: wti.map((r) => [ms(r.t), (r.orL - r.orS) / 1000]), color: "--s3", width: 1.5 },
          ],
          marks: [{ y: 0 }], yFmt: (v) => num(v, 0) + "k", tipFmt: (v) => num(v, 1) + "k contracts",
        }));
      });
      await load(pHeat, async () => {
        const codes = Object.keys(cftc.CONTRACTS).filter((c) => by[c]?.length > 60);
        const weeks = (by["067651"] || []).slice(-26).map((r) => r.t);
        const cells = [];
        codes.forEach((code, yi) => {
          const rows = by[code];
          weeks.forEach((wk, xi) => {
            const i = rows.findIndex((r) => r.t === wk);
            if (i < 0) return;
            const hist = rows.slice(Math.max(0, i - 156), i + 1).map((r) => r.mmNetPct);
            const z = (rows[i].mmNetPct - S.mean(hist)) / (S.std(hist) || 1);
            cells.push([xi, yi, +z.toFixed(2)]);
          });
        });
        const ch = await chartIn(pHeat);
        ch.set(heatOption({ xCats: weeks.map((w) => w.slice(5)), yCats: codes.map((c) => cftc.CONTRACTS[c].key), cells, min: -2.5, max: 2.5, fmt: (v) => (v > 0 ? "+" : "") + num(v, 1) + "σ" }));
      });
      await load(pTraders, async () => {
        const ch = await chartIn(pTraders);
        ch.set(tsOption({ series: [{ name: "Long traders", data: wti.map((r) => [ms(r.t), r.tMmL]), color: "--s3" }, { name: "Short traders", data: wti.map((r) => [ms(r.t), r.tMmS]), color: "--s8" }], yFmt: (v) => num(v, 0) }));
      });
    });

    scope.every(10 * 60e3, () => load(pFund, async () => {
      const since = Date.now() - 7 * 86400000;
      const [cl, b] = await Promise.all([hl.fundingHistory("xyz:CL", since), hl.fundingHistory("xyz:BRENTOIL", since)]);
      const ann = (r) => r * 24 * 365 * 100;
      const ch = await chartIn(pFund);
      ch.set(tsOption({ series: [{ name: "WTI perp", data: cl.map((x) => [x.t, ann(x.rate)]), color: "--s1" }, { name: "Brent perp", data: b.map((x) => [x.t, ann(x.rate)]), color: "--s2" }], marks: [{ y: 0 }], yFmt: (v) => num(v, 0) + "%", tipFmt: (v) => num(v, 2) + "%/yr" }));
      const t = (await import("../core/bus.js")).get("tape");
      if (t) pFund.setFoot([h("span", {}, `Open interest: WTI ${compact(t.rows.WTI.oi)} bbl, Brent ${compact(t.rows.BRENT.oi)} bbl`), h("span", {}, "Positive funding = longs pay shorts (crowded long)")]);
    }));
  },
};

const M_COT = `<p>CFTC disaggregated Commitments of Traders, futures only, NYMEX WTI (code 067651). "Managed money" are commodity trading advisers and hedge funds. Positions are as of Tuesday and published on Friday afternoon, so the data are three days old on release.</p>`;
const M_BOARD = `<p>Net length is longs minus shorts in contracts. % OI scales it by open interest so contracts of different size compare. The percentile ranks the latest net length against the last three years. Extremes matter more than levels: positioning is a contrarian indicator at the tails.</p>`;
const M_HEAT = `<p>For each contract and week, managed-money net length as a share of open interest, standardised against the previous three years (156 weeks). Red is unusually long, blue unusually short.</p>`;
const M_FUND = `<p>Hourly funding on the Hyperliquid perps, annualised. Funding is what longs pay shorts (or the reverse) to keep the perp anchored to its oracle. Persistent positive funding means leveraged traders are paying up to stay long.</p>`;
