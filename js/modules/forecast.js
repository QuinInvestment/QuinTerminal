// FCST — the forecast lab. A statistical model (GARCH + filtered historical
// simulation), a scenario mixture linked to prediction markets, market-implied
// volatility from barrier markets, an honest backtest, a walk-forward signal
// test, a Black-76 pricer and a supply-shock calculator.

import { h, mount } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { get, pub } from "../core/bus.js";
import { settings, save } from "../core/settings.js";
import { tsOption, barOption, catLineOption, theme, tooltipStyle, ttRow, color, makeChart } from "../core/charts.js";
import { px, num, pct, spct, signed, isNum, shortDay, usd } from "../core/fmt.js";
import * as S from "../core/stats.js";
import * as model from "../data/model.js";
import * as poly from "../data/polymarket.js";
import * as eia from "../data/eia.js";
import * as cftc from "../data/cftc.js";
import * as hl from "../data/hyperliquid.js";
import * as archive from "../data/archive.js";
import { load, chartIn, stat, seg, table, empty } from "./kit.js";

const HZ = [{ label: "1 week", value: 5 }, { label: "1 month", value: 21 }, { label: "3 months", value: 63 }];

export default {
  title: "Forecast lab",
  sub: "Three lenses on where crude can trade: a fitted volatility model, explicit scenarios weighted by prediction markets, and market-implied volatility. With the backtests that keep them honest.",

  async mount(view, { scope, tools, arg }) {
    const st = {
      inst: settings.fcst.instrument || "BRENT",
      H: settings.fcst.horizon || 21,
      scen: null, linked: true,
    };
    mount(tools,
      seg([{ label: "Brent", value: "BRENT" }, { label: "WTI", value: "WTI" }], st.inst, (v) => { st.inst = v; settings.fcst.instrument = v; save(); st.scen = null; refresh(); }),
      seg(HZ, st.H, (v) => { st.H = v; settings.fcst.horizon = v; save(); st.scen = null; refresh(); }));

    const pFan = panel({ title: "Price distribution", span: 8, rows: 8, src: ["eia", "hl"], chart: true, lead: true, method: M_FAN });
    const pProb = panel({ title: "Probabilities at the horizon", span: 4, rows: 8, src: ["poly"], flush: true, method: M_PROB });
    const pScen = panel({ title: "Scenario mixture", span: 6, rows: 8, src: ["poly"], method: M_SCEN });
    const pVol = panel({ title: "Volatility", span: 6, rows: 8, src: ["eia", "hl", "poly"], method: M_VOL });
    const pBack = panel({ title: "Does the risk model hold up? (backtest)", span: 6, rows: 7, src: ["eia"], method: M_BACK });
    const pSig = panel({ title: "Signal lab: can fundamentals call next week? (walk-forward)", span: 6, rows: 7, src: ["eia", "cftc"], method: M_SIG });
    const pTrack = panel({ title: "Live track record: archived forecasts against outcomes", span: 12, rows: 7, src: ["archive", "hl"], method: M_TRACK });
    const pOpt = panel({ title: "Option pricer (Black-76)", span: 6, rows: 8, method: M_OPT });
    const pShock = panel({ title: "Supply-shock calculator", span: 6, rows: 8, method: M_SHOCK });
    view.appendChild(grid(pFan, pProb, pScen, pVol, pBack, pSig, pTrack, pOpt, pShock));

    let ctx = null; // { hist, g, sim, S0, ... }

    async function compute() {
      const I = model.INSTRUMENTS[st.inst];
      const [hist, gres] = [await model.dailyHistory(st.inst), await model.garch(st.inst)];
      const tape = get("tape");
      const live = tape?.rows?.[st.inst]?.px;
      // the forecast is for the perp (front-month futures), so fall back to its close, not the physical spot
      const S0 = isNum(live) ? live : (hist.perpPts.at(-1)?.v ?? hist.points.at(-1).v);
      const g = gres.g;
      const sim = S.fhsSimulate(g, S0, st.H, { paths: 8000, seed: 11 });
      let board = get("poly:board");
      if (!board) { try { board = await poly.board(); pub("poly:board", board); } catch { board = null; } }
      const prewar = hist.points.filter((p) => p.t <= "2026-02-27").pop()?.v;
      const gVol = S.garchHorizonVol(g, st.H);
      if (!st.scen) st.scen = model.defaultScenarios({ S0, prewar, hDays: Math.round(st.H * 365 / 252), events: board, gVol });
      ctx = { I, hist, g, returns: gres.returns, sim, S0, board, prewar, gVol };
      return ctx;
    }

    async function refresh() {
      await load(pFan, async () => {
        await compute();
        drawFan();
        drawProb();
        drawScen();
        drawVol();
      });
      drawOpt();
      drawShock();
      if (!pBack.updatedAt) load(pBack, drawBacktest);
      if (!pSig.updatedAt) load(pSig, drawSignal);
      if (!pTrack.updatedAt) load(pTrack, drawTrack);
    }

    // ------------------------------------------------ fan chart
    async function drawFan() {
      const { hist, sim, S0, I } = ctx;
      // history in the forecast's own units: the perp's daily closes; the
      // physical spot (EIA) is drawn separately so its premium stays visible
      const usePerp = hist.perpPts.length >= 20;
      const from = Date.now() - 200 * 86400000;
      const dayMs = (t) => Date.parse(t + "T00:00:00Z");
      const histLine = (usePerp ? hist.perpPts : hist.points).filter((p) => dayMs(p.t) >= from);
      const spotLine = usePerp ? hist.spotPts.filter((p) => dayMs(p.t) >= from) : [];
      const spotName = st.inst === "BRENT" ? "Dated Brent spot (EIA, physical)" : "WTI Cushing spot (EIA)";
      const t0 = Date.now();
      const stepMs = (365 / 252) * 86400000;
      const xs = sim.bands.map((_, i) => t0 + (i + 1) * stepMs);
      const band = (lo, hi) => ({ lower: [[t0, S0], ...xs.map((x, i) => [x, sim.bands[i][lo]])], upper: [[t0, S0], ...xs.map((x, i) => [x, sim.bands[i][hi]])] });
      const T = st.H / 252;
      const mix = model.mixture(st.scen, T);
      const mixPath = (p) => [[t0, S0], ...xs.map((x, i) => {
        const tt = (i + 1) / st.H;
        const comps = mix.comps.map((c) => ({ ...c, median: S0 * Math.pow(c.median / S0, tt) }));
        return [x, S.mixQuantile(p, comps, T * tt)];
      })];
      const ch = await chartIn(pFan);
      ch.set(tsOption({
        series: [
          { name: usePerp ? `${I.name} perp, daily close` : `${I.name} (daily close)`, data: histLine.map((p) => [dayMs(p.t), p.v]), color: "--s1" },
          ...(spotLine.length ? [{ name: spotName, data: spotLine.map((p) => [dayMs(p.t), p.v]), color: "--ink-3", width: 1.2, dashed: true }] : []),
          { name: "Statistical median", data: [[t0, S0], ...xs.map((x, i) => [x, sim.bands[i][2]])], color: "--s1", dashed: true },
          { name: "Scenario median", data: mixPath(0.5), color: "--s2", dashed: true },
          { name: "Scenario 5% / 95%", data: mixPath(0.05), color: "--s2", width: 1, opacity: 0.8 },
          { name: "Scenario 95%", data: mixPath(0.95), color: "--s2", width: 1, opacity: 0.8, noLegend: true },
        ],
        bands: [
          { name: "Statistical 5–95%", ...band(0, 4), color: "--s1", opacity: 0.1 },
          { name: "Statistical 25–75%", ...band(1, 3), color: "--s1", opacity: 0.18 },
        ],
        marks: [{ x: t0, label: "now" }],
        yFmt: (v) => "$" + num(v, 0), tipFmt: (v) => "$" + num(v, 2),
      }));
      const q = sim.bands[st.H - 1];
      pFan.setData([{ label: "Step" }, { label: "P5", num: true }, { label: "P25", num: true }, { label: "P50", num: true }, { label: "P75", num: true }, { label: "P95", num: true }], sim.bands.map((b, i) => [i + 1, ...b]));
      pFan.setFoot([h("span", {}, `Now ${px(S0)} (perp)`), h("span", {}, `Statistical ${st.H}d: 5% $${num(q[0], 1)}, median $${num(q[2], 1)}, 95% $${num(q[4], 1)}`), h("span", {}, `Scenario: 5% $${num(mix.q5, 1)}, median $${num(mix.q50, 1)}, 95% $${num(mix.q95, 1)}`),
        isNum(hist.premium) && st.inst === "BRENT" ? h("span", {}, `Dated Brent ${signed(hist.premium, 2)} vs perp on ${hist.premiumDate}`) : null,
        hist.splicedDays ? h("span", { title: "The volatility model uses EIA spot returns, then perp returns after EIA's last print" }, `model returns: EIA to ${hist.eiaLast}, perp after`) : null]);
    }

    // ------------------------------------------------ probability table
    function drawProb() {
      const { sim, S0, board } = ctx;
      const T = st.H / 252;
      const mix = model.mixture(st.scen, T);
      const step = S0 > 60 ? 10 : 5;
      const levels = [];
      for (let k = Math.floor((S0 * 0.6) / step) * step; k <= S0 * 1.5; k += step) levels.push(k);
      const ladders = board && st.inst === "WTI" ? poly.barrierLadders(board) : [];
      const horizonEnd = Date.now() + st.H * (365 / 252) * 86400000;
      const rows = levels.map((K) => {
        const above = S.probAboveSorted(sim.terminal, K);
        const touch = S.touchProbSim(sim, K, S0);
        const mixAbove = 1 - mix.cdf(K);
        const lad = ladders.find((l) => l.K === K && Math.abs(l.end - horizonEnd) < 20 * 86400000 && ((l.dir === "HIGH" && K > S0) || (l.dir === "LOW" && K < S0)));
        return { K, above, touch, mixAbove, mkt: lad ? lad.p : NaN, mktLabel: lad ? lad.event : "" };
      });
      mount(pProb.body, table([
        { label: "Level", get: (r) => h("span", { class: Math.abs(r.K - S0) < 5 ? "ac" : "" }, "$" + r.K) },
        { label: `Above in ${st.H}d`, r: true, title: "Statistical model, terminal price", get: (r) => pct(r.above, r.above < 0.01 ? 2 : 0) },
        { label: "Scenarios", r: true, title: "Scenario mixture, terminal price", get: (r) => pct(r.mixAbove, r.mixAbove < 0.01 ? 2 : 0) },
        { label: "Touch", r: true, title: "Statistical model: probability the price trades at this level at some point", get: (r) => pct(r.touch, r.touch < 0.01 ? 2 : 0) },
        { label: "Market", r: true, title: "Polymarket 'hit' price for a matching window (WTI only)", get: (r) => (isNum(r.mkt) ? pct(r.mkt, r.mkt < 0.01 ? 2 : 0) : "—") },
      ], rows));
      pProb.setData([{ label: "Level" }, { label: "P(above) model", num: true }, { label: "P(above) scenarios", num: true }, { label: "P(touch) model", num: true }, { label: "Market touch", num: true }], rows.map((r) => [r.K, r.above, r.mixAbove, r.touch, r.mkt]));
      pProb.touch();
    }

    // ------------------------------------------------ scenarios
    let scenChart = null;
    async function drawScen() {
      const { S0, sim } = ctx;
      const T = st.H / 252;
      const card = (s, i) => {
        const set = (k, v) => { s[k] = v; if (k === "p") normalise(i); drawScen(); drawFan(); drawProb(); };
        const row = (label, k, min, max, stp, fmtv) => h("div", {},
          h("div", { class: "row", style: { justifyContent: "space-between" } }, h("span", { class: "tiny muted" }, label), h("span", { class: "small num" }, fmtv(s[k]))),
          h("input", { type: "range", min, max, step: stp, value: s[k], "aria-label": `${s.name} ${label}`, oninput: (e) => { st.linked = false; set(k, +e.target.value); } }));
        return h("div", { style: { border: "1px solid var(--line)", borderTop: `3px solid ${color(["--s3", "--s1", "--s5"][i])}`, padding: "8px 10px", minWidth: 0 } },
          h("div", { class: "small", style: { fontWeight: 500, color: "var(--text)", marginBottom: "4px" } }, s.name),
          row("Probability", "p", 0, 1, 0.01, (v) => pct(v, 0)),
          row("Median price", "target", Math.round(S0 * 0.4), Math.round(S0 * 1.8), 1, (v) => "$" + v),
          row("Volatility", "vol", 0.1, 1.2, 0.01, (v) => pct(v, 0)),
          h("div", { class: "tiny muted", title: s.why }, s.src));
      };
      const normalise = (changed) => {
        const others = st.scen.filter((_, j) => j !== changed);
        const rest = Math.max(0, 1 - st.scen[changed].p);
        const tot = others.reduce((a, b) => a + b.p, 0) || 1;
        others.forEach((o) => (o.p = (o.p / tot) * rest));
      };
      const mix = model.mixture(st.scen, T);
      const box = h("div", { style: { height: "150px", marginTop: "8px" } });
      mount(pScen.body,
        h("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "8px" } }, st.scen.map(card)),
        h("div", { class: "row", style: { justifyContent: "space-between", marginTop: "6px" } },
          h("span", { class: "small" }, `Mixture: mean $${num(mix.mean, 1)}, median $${num(mix.q50, 1)}, 90% range $${num(mix.q5, 0)}–$${num(mix.q95, 0)}`),
          h("button", { class: "btn ghost", type: "button", onclick: () => { st.scen = null; st.linked = true; refresh(); } }, st.linked ? "Linked to markets" : "Reset to market-linked")),
        box);
      if (scenChart) scenChart.dispose();
      scenChart = await makeChart(box);
      scope.add(() => scenChart && scenChart.dispose());
      // densities on one price axis: mixture pdf vs histogram of the statistical model
      const lo = Math.min(mix.q5, sim.terminal[Math.floor(sim.terminal.length * 0.01)]) * 0.85, hi = Math.max(mix.q95, sim.terminal[Math.floor(sim.terminal.length * 0.99)]) * 1.1;
      const n = 60, w = (hi - lo) / n;
      const xs = Array.from({ length: n }, (_, i) => lo + (i + 0.5) * w);
      const hist = new Array(n).fill(0);
      for (const v of sim.terminal) { const k = Math.floor((v - lo) / w); if (k >= 0 && k < n) hist[k]++; }
      const T2 = theme();
      scenChart.set({
        animation: false, textStyle: { fontFamily: T2.font },
        grid: { left: 8, right: 10, top: 22, bottom: 4, containLabel: true },
        legend: { type: "scroll", top: 0, left: 0, right: 0, itemWidth: 14, itemHeight: 3, icon: "rect", textStyle: { color: T2.ink2, fontSize: 11 } },
        tooltip: { trigger: "axis", ...tooltipStyle(T2), formatter: (ps) => `<div style="opacity:.7">$${num(+ps[0].axisValue, 1)}</div>` + ps.map((p) => ttRow(p.color, p.seriesName, num(p.value[1] * 100, 2) + "% per $")).join("") },
        xAxis: { type: "value", min: lo, max: hi, axisLabel: { color: T2.ink3, fontSize: 10, formatter: (v) => "$" + Math.round(v) }, axisLine: { lineStyle: { color: T2.line } }, splitLine: { show: false } },
        yAxis: { type: "value", show: false },
        series: [
          { name: "Statistical model", type: "line", step: "middle", symbol: "none", data: xs.map((x, i) => [x, hist[i] / sim.terminal.length / w]), lineStyle: { color: color("--s1"), width: 1.5 }, itemStyle: { color: color("--s1") }, areaStyle: { color: color("--s1"), opacity: 0.1 } },
          { name: "Scenario mixture", type: "line", smooth: true, symbol: "none", data: xs.map((x) => [x, mix.pdf(x)]), lineStyle: { color: color("--s2"), width: 2 }, itemStyle: { color: color("--s2") } },
        ],
      });
      pScen.touch();
    }

    // ------------------------------------------------ volatility
    let volChart = null;
    scope.add(() => volChart && volChart.dispose());
    async function drawVol() {
      const { g, returns, hist, S0, board } = ctx;
      const rv = model.realized(returns);
      const pts = hist.points.slice(-returns.length - 1);
      const dates = pts.slice(1).map((p) => Date.parse(p.t + "T00:00:00Z"));
      const cond = g.sigma2.map((v) => Math.sqrt(v * 252) * 100);
      const r20 = S.rolling(returns, 20, (a) => S.realizedVol(a) * 100);
      const from = Math.max(0, dates.length - 520); // short (perp-only) histories have fewer than 520 days
      const lad = board ? model.ladderVols(poly.barrierLadders(board), get("tape")?.rows?.WTI?.px || S0) : [];
      const box = h("div", { style: { height: "170px" } });
      mount(pVol.body,
        h("div", { class: "stats" },
          stat("GARCH now", pct(Math.sqrt(g.nextSigma2 * 252), 0), `long-run ${pct(Math.sqrt(g.vbar * 252), 0)}`),
          stat(`Horizon ${st.H}d`, pct(S.garchHorizonVol(g, st.H), 0), "average expected vol"),
          stat("Realised 20d", pct(rv.d20, 0), `60d ${pct(rv.d60, 0)}`),
          stat("Persistence", num(g.persistence, 3), `half-life ${num(g.halfLife, 0)} days`),
          stat("α / β", `${num(g.alpha, 3)} / ${num(g.beta, 3)}`, `n = ${g.n} returns`),
          lad.length ? stat("Barrier-implied", pct(S.median(lad.map((x) => x.iv)), 0), `${lad.length} WTI markets`) : null),
        g.n < 500 ? h("p", { class: "note", style: { margin: "4px 0 0", color: "var(--hazard)" } },
          `Limited history. Only ${g.n} daily returns: the EIA history did not load, so the fit uses the perp alone. Treat α, β and the half-life as rough; persistence ${g.persistence >= 0.999 ? "sits at its 0.9995 cap" : "is poorly identified"}.`) : null,
        box,
        lad.length ? h("div", { style: { marginTop: "6px" } }, table([
          { label: "Market", get: (l) => `${l.dir === "HIGH" ? "Hits" : "Falls to"} $${l.K} (${l.window} to ${shortDay(l.end)})` },
          { label: "Price", r: true, get: (l) => pct(l.p, 1) },
          { label: "Implied vol", r: true, get: (l) => pct(l.iv, 0) },
        ], lad.slice(0, 8))) : h("p", { class: "tiny muted" }, "No live WTI barrier markets to back out an implied volatility."));
      if (volChart) volChart.dispose();
      volChart = await makeChart(box);
      const ch = volChart;
      ch.set(tsOption({
        series: [
          { name: "GARCH conditional vol", data: dates.slice(from).map((t, i) => [t, cond[from + i]]), color: "--s1" },
          { name: "Realised 20-day", data: dates.slice(from).map((t, i) => [t, r20[from + i]]), color: "--s3", width: 1.5 },
        ],
        yFmt: (v) => num(v, 0) + "%",
      }));
      pVol.touch();
    }

    // ------------------------------------------------ backtest
    async function drawBacktest() {
      const { returns } = await model.garch(st.inst);
      const n = returns.length;
      const fitN = Math.max(750, n - 1500);
      const g = S.garchFit(returns.slice(0, fitN));
      const zs = [...g.z].sort((a, b) => a - b);
      const q05 = S.qSorted(zs, 0.05), q01 = S.qSorted(zs, 0.01);
      let s2 = g.nextSigma2, e95 = 0, e99 = 0, eN95 = 0, cnt = 0;
      const sdNaive = S.std(returns.slice(0, fitN));
      const pits = [];
      const H = 21;
      const sig = [];
      for (let t = fitN; t < n; t++) {
        const s = Math.sqrt(s2);
        sig.push(s2);
        const r = returns[t];
        if (r - g.mu < s * q05) e95++;
        if (r - g.mu < s * q01) e99++;
        if (r < -1.645 * sdNaive) eN95++;
        cnt++;
        const eps = r - g.mu;
        s2 = g.omega + g.alpha * eps * eps + g.beta * s2;
      }
      // 21-day PIT using expected average variance over the window (normal approx)
      for (let k = 0; k + H <= sig.length; k += 5) {
        let v = 0, s2k = sig[k];
        for (let h2 = 1; h2 <= H; h2++) { v += g.vbar + Math.pow(g.alpha + g.beta, h2 - 1) * (s2k - g.vbar); }
        const R = returns.slice(fitN + k, fitN + k + H).reduce((a, b) => a + b, 0);
        pits.push(S.normCdf((R - H * g.mu) / Math.sqrt(v)));
      }
      const bins = new Array(10).fill(0);
      for (const p of pits) bins[Math.min(9, Math.floor(p * 10))]++;
      const cover90 = pits.filter((p) => p > 0.05 && p < 0.95).length / pits.length;
      const k95 = S.kupiec(e95, cnt, 0.05), k99 = S.kupiec(e99, cnt, 0.01), kN = S.kupiec(eN95, cnt, 0.05);
      const verdict = (k) => (k.pValue > 0.05 ? h("span", { class: "tag ok" }, "passes") : h("span", { class: "tag crit" }, "rejected"));
      const box = h("div", { style: { height: "130px", marginTop: "6px" } });
      mount(pBack.body,
        h("p", { class: "tiny muted", style: { marginTop: 0 } }, `Parameters fitted on the first ${fitN} days, then frozen and run forward over the last ${cnt} trading days (out of sample).`),
        table([
          { label: "Test", get: (r) => r.n },
          { label: "Expected", r: true, get: (r) => r.exp },
          { label: "Observed", r: true, get: (r) => r.obs },
          { label: "Kupiec p", r: true, get: (r) => num(r.k.pValue, 2) },
          { label: "", get: (r) => verdict(r.k) },
        ], [
          { n: "1-day VaR 95%, GARCH-FHS", exp: num(cnt * 0.05, 0), obs: e95, k: k95 },
          { n: "1-day VaR 99%, GARCH-FHS", exp: num(cnt * 0.01, 0), obs: e99, k: k99 },
          { n: "1-day VaR 95%, constant vol", exp: num(cnt * 0.05, 0), obs: eN95, k: kN },
        ]),
        h("div", { class: "small", style: { marginTop: "6px" } }, `21-day 90% interval covered ${pct(cover90, 0)} of outcomes (target 90%, ${pits.length} overlapping windows). The histogram below should be flat if the model is calibrated.`),
        box);
      const ch = await makeChart(box);
      scope.add(() => ch.dispose());
      ch.set(barOption({ cats: bins.map((_, i) => `${i * 10}–${i * 10 + 10}%`), values: bins.map((b) => b / pits.length * 100), fmt: (v) => num(v, 0) + "%", colorVar: "--s1", labels: false }));
      pBack.setData([{ label: "Test" }, { label: "Observed", num: true }, { label: "Trials", num: true }, { label: "Kupiec p", num: true }], [["VaR95 FHS", e95, cnt, k95.pValue], ["VaR99 FHS", e99, cnt, k99.pValue], ["VaR95 const", eN95, cnt, kN.pValue]]);
    }

    // ------------------------------------------------ walk-forward signal lab
    async function drawSignal() {
      const [w, cot, spot] = await Promise.all([eia.weekly(), cftc.cot().catch(() => null), eia.spot()]);
      const brent = spot.series.RBRTE || [];
      const wti = spot.series.RWTC || [];
      const wtiMap = new Map(wti.map((p) => [p.t, p.v]));
      // weekly close on/before each EIA week date (EIA weeks end Friday)
      const priceOn = (arr, d) => { let lo = 0, hi = arr.length - 1, best = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t <= d) { best = arr[m]; lo = m + 1; } else hi = m - 1; } return best; };
      const crude = w.series.WCESTUS1 || [], cush = w.series.W_EPC0_SAX_YCUOK_MBBL || [];
      const crudeS = eia.seasonal(crude), cushS = eia.seasonal(cush);
      const cotRows = cot ? cot["067651"] || [] : [];
      const rows = [];
      for (let i = 13; i < crude.length - 1; i++) {
        const d = crude[i].t, dn = crude[i + 1].t;
        const p0 = priceOn(brent, d), p1 = priceOn(brent, dn), p4 = priceOn(brent, crude[i - 4].t), p12 = priceOn(brent, crude[i - 12].t);
        if (!p0 || !p1 || !p4 || !p12 || p1.t === p0.t) continue;
        const surprise = (crudeS[i].v - crudeS[i - 1].v) - ((crudeS[i].avg - crudeS[i - 1].avg) || 0);
        const cushDev = cushS[i].avg ? cushS[i].v / cushS[i].avg - 1 : NaN;
        const c0 = cotRows.filter((r) => r.t <= d).pop(), c1 = cotRows.filter((r) => r.t <= crude[i - 4].t).pop();
        const mmCh = c0 && c1 ? c0.mmNetPct - c1.mmNetPct : NaN;
        const w0 = wtiMap.get(p0.t);
        const spread = isNum(w0) ? p0.v - w0 : NaN;
        const fwd = Math.log(p1.v / p0.v);
        rows.push({ d, x: [surprise / 1000, cushDev, Math.log(p0.v / p4.v), Math.log(p0.v / p12.v), mmCh, spread], y: fwd > 0 ? 1 : 0, fwd });
      }
      const usable = rows.filter((r) => r.x.every(isNum));
      if (usable.length < 160) throw new Error("Not enough aligned weekly history yet");
      const start = 104;
      const preds = [];
      let model_ = null;
      for (let i = start; i < usable.length; i++) {
        if ((i - start) % 4 === 0 || !model_) {
          const train = usable.slice(0, i);
          const stdz = S.standardiser(train.map((r) => r.x));
          const m = S.logistic(train.map((r) => stdz(r.x)), train.map((r) => r.y), { lambda: 2 });
          model_ = { m, stdz };
        }
        const p = model_.m.predict(model_.stdz(usable[i].x));
        preds.push({ d: usable[i].d, p, y: usable[i].y, fwd: usable[i].fwd });
      }
      const hit = preds.filter((q) => (q.p > 0.5) === (q.y === 1)).length / preds.length;
      const base = Math.max(S.mean(preds.map((q) => q.y)), 1 - S.mean(preds.map((q) => q.y)));
      const aucV = S.auc(preds.map((q) => q.p), preds.map((q) => q.y));
      const brier = S.mean(preds.map((q) => (q.p - q.y) ** 2));
      const brierClim = S.mean(preds.map((q) => (S.mean(preds.map((z) => z.y)) - q.y) ** 2));
      let eq = 0, bh = 0;
      const curve = preds.map((q) => { eq += (q.p > 0.5 ? 1 : -1) * q.fwd; bh += q.fwd; return { t: Date.parse(q.d + "T00:00:00Z"), eq, bh }; });
      const stratR = preds.map((q) => (q.p > 0.5 ? 1 : -1) * q.fwd);
      const sharpe = (S.mean(stratR) / (S.std(stratR) || 1)) * Math.sqrt(52);
      const names = ["Crude stock surprise (mb)", "Cushing vs 5y", "4-week momentum", "12-week momentum", "Speculator net change", "Brent–WTI spread"];
      const box = h("div", { style: { height: "120px", marginTop: "6px" } });
      mount(pSig.body,
        h("div", { class: "stats" },
          stat("Hit rate", pct(hit, 1), `naive ${pct(base, 1)}`, { cls: hit > base + 0.02 ? "up" : "" }),
          stat("AUC", num(aucV, 3), "0.5 = coin flip"),
          stat("Brier skill", spct(1 - brier / brierClim, 1), "vs climatology"),
          stat("Signal Sharpe", num(sharpe, 2), `${preds.length} weeks out of sample`)),
        box,
        h("p", { class: "tiny muted" }, `Coefficients (last fit, standardised): ${names.map((n, i) => `${n} ${signed(model_.m.w[i + 1], 2)}`).join("; ")}.`),
        h("p", { class: "tiny muted" }, "Next-week direction is close to a coin flip in most samples. Treat any edge here as fragile, before costs, and unstable across regimes."));
      const ch = await makeChart(box);
      scope.add(() => ch.dispose());
      ch.set(tsOption({ series: [{ name: "Long/short on the signal", data: curve.map((c) => [c.t, c.eq * 100]), color: "--s2" }, { name: "Buy and hold", data: curve.map((c) => [c.t, c.bh * 100]), color: "--s1", width: 1.5 }], yFmt: (v) => num(v, 0) + "%" }));
      pSig.setData([{ label: "Week" }, { label: "P(up)", num: true }, { label: "Outcome up", num: true }, { label: "Next-week log return", num: true }], preds.map((q) => [q.d, q.p, q.y, q.fwd]));
    }

    // ------------------------------------------------ live track record (daily archive)
    async function drawTrack() {
      const fc = await archive.history("forecasts");
      if (!fc.length) {
        mount(pTrack.body, h("div", { class: "note" },
          h("p", { style: { marginTop: 0 } }, "No archived forecasts yet. Each weekday after the settlement, the Daily snapshot workflow records this lab's Brent and WTI forecasts (statistical and scenario lenses, 1 week, 1 month, 3 months). As horizons pass, this panel scores every forecast against the perp's actual close: interval coverage, pinball loss and skill against a naive random walk."),
          h("p", {}, "A backtest can be tuned after the fact; this record cannot. That is the point of keeping it.")));
        return;
      }
      const first = fc[0].date;
      const since = Date.parse(first + "T00:00:00Z") - 2 * 86400000;
      const closes = {};
      for (const inst of ["BRENT", "WTI"]) {
        const c = await hl.candles(model.INSTRUMENTS[inst].coin, "1d", since, Date.now(), 30 * 60e3);
        closes[inst] = new Map(c.map((k) => [new Date(k.t).toISOString().slice(0, 10), k.c]));
      }
      const scored = archive.score(fc, closes);
      const sum = archive.summarise(scored);
      const pending = fc.filter((f) => !scored.some((x) => x.date === f.date && x.inst === f.inst && x.h === +f.h));
      const nextDue = pending.map((f) => f.target).sort()[0];
      const days = new Set(fc.map((f) => f.date)).size;
      const head = h("p", { class: "small", style: { marginTop: 0 } }, `${fc.length} forecasts archived over ${days} days since ${first}; ${scored.length} have matured${nextDue ? `, next due ${nextDue}` : ""}. Out of sample by construction: each row was written before its outcome existed.`);
      if (!scored.length) { mount(pTrack.body, head, h("p", { class: "note" }, "Nothing has matured yet. The first one-week forecasts are scored five weekdays after the first snapshot.")); return; }
      const hz = (n) => ({ 5: "1 week", 21: "1 month", 63: "3 months" })[n] || n + "d";
      const cov = (v, target) => h("span", { class: Math.abs(v - target) > 0.2 ? "down" : "" }, pct(v, 0));
      const box = h("div", { style: { height: "170px", marginTop: "8px" } });
      mount(pTrack.body, head,
        table([
          { label: "Market", get: (r) => (r.inst === "BRENT" ? "Brent" : "WTI") },
          { label: "Horizon", get: (r) => hz(r.h) },
          { label: "Scored", r: true, get: (r) => r.n },
          { label: "90% band hit, GARCH", r: true, title: "Share of outcomes inside the 5%–95% interval (target 90%)", get: (r) => cov(r.cov90G, 0.9) },
          { label: "90% band hit, scenarios", r: true, get: (r) => cov(r.cov90M, 0.9) },
          { label: "50% band hit, GARCH", r: true, title: "Share inside the 25%–75% interval (target 50%)", get: (r) => cov(r.cov50G, 0.5) },
          { label: "Pinball loss G / S / naive", r: true, title: "Average quantile loss in $ (lower is better)", get: (r) => `${num(r.lossG, 2)} / ${num(r.lossM, 2)} / ${num(r.lossN, 2)}` },
          { label: "Skill vs naive, GARCH", r: true, cls: (r) => (r.skillG > 0 ? "up" : "down"), get: (r) => spct(r.skillG, 0) },
          { label: "Skill vs naive, scenarios", r: true, cls: (r) => (r.skillM > 0 ? "up" : "down"), get: (r) => spct(r.skillM, 0) },
        ], sum),
        box);
      const pick = scored.filter((x) => x.inst === st.inst && x.h === (scored.some((y) => y.inst === st.inst && y.h === 21) ? 21 : 5));
      if (pick.length) {
        const ch = await makeChart(box);
        scope.add(() => ch.dispose());
        const t = (x) => Date.parse(x.target + "T00:00:00Z");
        ch.set(tsOption({
          series: [
            { name: "Outcome (perp close)", type: "scatter", symbol: "circle", symbolSize: 7, data: pick.map((x) => [t(x), x.y]), color: "--s2" },
            { name: "GARCH median", data: pick.map((x) => [t(x), x.g[2]]), color: "--s1", dashed: true, width: 1.5 },
          ],
          bands: [{ name: "GARCH 5–95%", lower: pick.map((x) => [t(x), x.g[0]]), upper: pick.map((x) => [t(x), x.g[4]]), color: "--s1", opacity: 0.15 }],
          yFmt: (v) => "$" + num(v, 0), tipFmt: (v) => "$" + num(v, 2),
        }));
      }
      pTrack.setData([{ label: "Made" }, { label: "Market" }, { label: "Horizon days", num: true }, { label: "Target" }, { label: "Outcome", num: true }, { label: "G 5%", num: true }, { label: "G 50%", num: true }, { label: "G 95%", num: true }, { label: "S 5%", num: true }, { label: "S 50%", num: true }, { label: "S 95%", num: true }, { label: "Loss G", num: true }, { label: "Loss S", num: true }, { label: "Loss naive", num: true }],
        scored.map((x) => [x.date, x.inst, x.h, x.target, x.y, x.g[0], x.g[2], x.g[4], x.m[0], x.m[2], x.m[4], x.lossG, x.lossM, x.lossN]));
    }

    // ------------------------------------------------ option pricer
    const opt = { K: NaN, days: 30, vol: NaN, r: 0.04, type: "call" };
    const m = /^opt\s+([\d.]+)\s+(\d+)(?:\s+([\d.]+))?(?:\s+(call|put|c|p))?/i.exec(arg || "");
    if (m) { opt.K = +m[1]; opt.days = +m[2]; if (m[3]) opt.vol = +m[3] / 100; if (m[4]) opt.type = /^p/i.test(m[4]) ? "put" : "call"; }
    let optChart = null;
    async function drawOpt() {
      if (!ctx) return;
      const F = ctx.S0;
      if (!isNum(opt.K)) opt.K = Math.round(F / 5) * 5;
      if (!isNum(opt.vol)) opt.vol = Math.round(S.garchHorizonVol(ctx.g, Math.max(1, Math.round(opt.days * 252 / 365))) * 100) / 100;
      const T = opt.days / 365;
      const res = S.black76(F, opt.K, T, opt.r, opt.vol, opt.type);
      const touch = S.touchProb(F, opt.K, T, opt.vol);
      const inp = (label, key, stepv, scale = 1) => h("label", { class: "fld" }, label,
        h("input", { class: "in", type: "number", step: stepv, value: +(opt[key] * scale).toFixed(4), style: { width: "92px" }, onchange: (e) => { opt[key] = +e.target.value / scale; drawOpt(); } }));
      const box = h("div", { style: { height: "150px", marginTop: "8px" } });
      mount(pOpt.body,
        h("div", { class: "row" },
          h("label", { class: "fld" }, "Future", h("input", { class: "in", value: px(F), disabled: true, style: { width: "86px" } })),
          inp("Strike", "K", "0.5"), inp("Days", "days", "1"), inp("Vol %", "vol", "1", 100), inp("Rate %", "r", "0.25", 100),
          h("label", { class: "fld" }, "Type", seg([{ label: "Call", value: "call" }, { label: "Put", value: "put" }], opt.type, (v) => { opt.type = v; drawOpt(); }))),
        h("div", { class: "stats", style: { marginTop: "8px" } },
          stat("Premium", "$" + num(res.price, 3), `${pct(res.price / F, 2)} of the future`),
          stat("Delta", num(res.delta, 3), ""), stat("Gamma", num(res.gamma, 4), ""), stat("Vega", num(res.vega, 3), "$ per vol point"),
          stat("Theta", num(res.theta, 3), "$ per day"), stat("P(in the money)", pct(res.probITM, 1), "at expiry, risk-neutral"),
          stat("Digital", "$" + num(res.digital, 3), "pays $1 if in the money"), stat("Touch prob.", pct(touch, 1), "trades through the strike before expiry")),
        box);
      if (optChart) optChart.dispose();
      optChart = await makeChart(box);
      scope.add(() => optChart && optChart.dispose());
      const xs = [];
      for (let x = F * 0.6; x <= F * 1.4; x += F * 0.01) xs.push(x);
      const payoff = xs.map((x) => [x, (opt.type === "call" ? Math.max(x - opt.K, 0) : Math.max(opt.K - x, 0)) - res.price]);
      const today = xs.map((x) => [x, S.black76(x, opt.K, T, opt.r, opt.vol, opt.type).price - res.price]);
      const T2 = theme();
      optChart.set({
        animation: false, textStyle: { fontFamily: T2.font }, grid: { left: 8, right: 10, top: 22, bottom: 4, containLabel: true },
        legend: { type: "scroll", top: 0, left: 0, right: 0, itemWidth: 14, itemHeight: 3, icon: "rect", textStyle: { color: T2.ink2, fontSize: 11 } },
        tooltip: { trigger: "axis", ...tooltipStyle(T2), formatter: (ps) => `<div style="opacity:.7">Future $${num(ps[0].value[0], 2)}</div>` + ps.map((p) => ttRow(p.color, p.seriesName, usd(p.value[1], 2))).join("") },
        xAxis: { type: "value", min: xs[0], max: xs[xs.length - 1], axisLabel: { color: T2.ink3, fontSize: 10, formatter: (v) => "$" + Math.round(v) }, axisLine: { lineStyle: { color: T2.line } }, splitLine: { show: false } },
        yAxis: { type: "value", axisLabel: { color: T2.ink3, fontSize: 10, formatter: (v) => usd(v, 0) }, splitLine: { lineStyle: { color: T2.grid } } },
        series: [
          { name: "P&L at expiry", type: "line", symbol: "none", data: payoff, lineStyle: { color: color("--s2"), width: 2 }, itemStyle: { color: color("--s2") } },
          { name: "P&L today", type: "line", symbol: "none", data: today, lineStyle: { color: color("--s1"), width: 2 }, itemStyle: { color: color("--s1") },
            markLine: { silent: true, symbol: "none", lineStyle: { color: T2.ink3, type: "solid" }, label: { color: T2.ink2, fontSize: 10, formatter: (p) => p.data.text || "" }, data: [{ xAxis: F, text: "future" }, { yAxis: 0, text: "" }] } },
        ],
      });
      pOpt.touch();
    }

    // ------------------------------------------------ supply shock
    const sh = { mbd: 2, days: 60, elast: 0.08, stocks: 1.0 };
    const ms_ = /^shock\s+([\d.]+)\s+(\d+)/i.exec(arg || "");
    if (ms_) { sh.mbd = +ms_[1]; sh.days = +ms_[2]; }
    let shockChart = null;
    async function drawShock() {
      const F = ctx?.S0 || get("tape")?.rows?.BRENT?.px || 100;
      const net = Math.max(0, sh.mbd - sh.stocks);
      const pctMove = (x, e) => (x / 104) / e;
      const inp = (label, key, stepv) => h("label", { class: "fld" }, label, h("input", { class: "in", type: "number", step: stepv, value: sh[key], style: { width: "92px" }, onchange: (e) => { sh[key] = +e.target.value; drawShock(); } }));
      const box = h("div", { style: { height: "160px", marginTop: "8px" } });
      mount(pShock.body,
        h("div", { class: "row" }, inp("Supply lost (mb/d)", "mbd", "0.1"), inp("Duration (days)", "days", "5"), inp("Stock draws (mb/d)", "stocks", "0.1"), inp("Elasticity", "elast", "0.01")),
        h("div", { class: "stats", style: { marginTop: "8px" } },
          stat("Barrels lost", num((sh.mbd * sh.days), 0) + " mb", `${num(sh.mbd, 1)} mb/d × ${sh.days} days`),
          stat("Net of stock draws", num(net, 1) + " mb/d", `${pct(net / 104, 1)} of world demand`),
          stat("Price response", `+${num(pctMove(net, sh.elast) * 100, 0)}%`, `≈ $${num(F * (1 + pctMove(net, sh.elast)), 0)} from $${num(F, 0)}`),
          stat("US SPR cover", isNum(get("straits:digest")?.spr?.mb) ? num(get("straits:digest").spr.mb / Math.max(0.1, sh.stocks), 0) + " days" : "—", "at the chosen draw rate")),
        box,
        h("p", { class: "tiny muted" }, "Price response = (net shortfall / world demand) / |short-run demand elasticity|. Literature puts the short-run elasticity at roughly −0.03 to −0.10; the smaller it is, the bigger the move."));
      if (shockChart) shockChart.dispose();
      shockChart = await makeChart(box);
      scope.add(() => shockChart && shockChart.dispose());
      const xs = Array.from({ length: 41 }, (_, i) => i * 0.25);
      shockChart.set(catLineOption({
        cats: xs.map((x) => num(x, 1)),
        series: [0.05, 0.08, 0.12].map((e, i) => ({ name: `elasticity −${e}`, data: xs.map((x) => +(F * (1 + pctMove(Math.max(0, x - sh.stocks), e))).toFixed(1)), color: ["--s5", "--s2", "--s1"][i], showSymbol: false })),
        yFmt: (v) => "$" + num(v, 0),
      }));
      pShock.touch();
    }

    await refresh();
    scope.sub("tape", () => {}, { replay: false });
  },
};

const M_FAN = `<p>Statistical lens: a GARCH(1,1) model is fitted by quasi-maximum likelihood on about ten years of daily log returns (EIA spot, extended with perp returns after EIA's last print). Variance targeting pins the long-run variance to the sample variance. 8,000 paths are simulated with standardised residuals drawn from the model's own history (filtered historical simulation), which keeps the fat tails and skew that a normal model would miss.</p>
<p>Scenario lens: the dashed orange median and thin 5%/95% lines come from the scenario mixture, with each scenario's median approached geometrically over the horizon.</p>
<p>Spot is the live perp price, so the forecast is for the perp, which tracks the front futures contract.</p>`;
const M_PROB = `<p>"Above" is the share of simulated paths ending above the level; "Touch" is the share that trade through it at any point. For WTI, the "Market" column shows Polymarket prices for "hit $X" markets whose window ends within 20 days of the horizon. Differences between model and market reflect different measures (risk-neutral versus a crowd's subjective odds), fees and liquidity, not free money.</p>`;
const M_SCEN = `<p>Each scenario is a lognormal distribution with a median price and a volatility; the mixture weights are scenario probabilities. By default the deal probability is read off Polymarket's Hormuz reopening term structure (interpolated to the horizon with constant hazard), escalation off "US invades Iran before 2027" scaled to the horizon, and the blockade takes the rest. Move any slider to replace a market input with your own view.</p>`;
const M_VOL = `<p>GARCH(1,1): σ²ₜ = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁, fitted by Gaussian quasi-maximum likelihood with variance targeting (ω = σ̄²(1 − α − β)). Persistence α + β sets how fast shocks fade; half-life = ln 0.5 / ln(α + β).</p>
<p>Barrier-implied volatility inverts the reflection-principle probability that a driftless futures price touches a level within a window, P = N((−a − σ²T/2)/σ√T) + (F/B)·N((−a + σ²T/2)/σ√T) with a = ln(B/F), to match each Polymarket "hit" price. Windows that start in the future are integrated over the distribution of the price at the window start.</p>`;
const M_BACK = `<p>Out-of-sample test: parameters are estimated on the early sample and frozen; the model then forecasts one-day Value-at-Risk every day over the evaluation window. Kupiec's proportion-of-failures test checks whether the exception rate matches the nominal level (p &gt; 0.05: not rejected). The 21-day probability integral transform (PIT) histogram should be flat for a calibrated distribution; a U shape means tails are too thin, a hump means they are too fat. Overlapping windows make the PIT sample autocorrelated, so read it as a diagnostic, not a formal test.</p>`;
const M_SIG = `<p>A weekly logistic regression predicts whether Brent's next weekly return is positive from six features known at the time: the EIA crude stock surprise against the seasonal norm, Cushing stocks versus their 5-year average, 4- and 12-week momentum, the 4-week change in managed-money net length (% of open interest) and the Brent–WTI spread. Ridge penalty λ = 2 on standardised features.</p>
<p>Walk-forward: the first 104 weeks train the model; it is refitted every 4 weeks on all data available at that date and scored only on the following weeks. No look-ahead: features use data published before the forecast week. Hit rate is compared with always guessing the more frequent outcome; returns ignore costs and use spot, not tradable futures.</p>`;
const M_TRACK = `<p>Every weekday after the settlement, the Daily snapshot workflow (pipeline/snapshot.mjs) runs this lab's two lenses and appends their 5%, 25%, 50%, 75% and 95% quantiles at 1 week, 1 month and 3 months to data/history/forecasts.csv. When a target date passes, the forecast is scored against the perp's daily close (UTC) on that date.</p><p>Coverage: share of outcomes inside the 90% and 50% intervals; a calibrated model hits close to 90% and 50%. Pinball loss: the average quantile loss over the five quantiles, in dollars; lower is better. Skill = 1 − loss / naive loss, where the naive forecast is a driftless lognormal at the 20-day realised volatility of the forecast day. Overlapping horizons make consecutive scores dependent: dozens of matured forecasts are needed before differences mean much.</p>`;
const M_OPT = `<p>Black-76 prices European options on futures: C = e^(−rT)[F·N(d₁) − K·N(d₂)], d₁ = [ln(F/K) + σ²T/2]/(σ√T), d₂ = d₁ − σ√T. Vega is per one volatility point, theta per calendar day. Default volatility is the GARCH average expected volatility to expiry. Real WTI and Brent options are American-style on futures and settle against a specific contract month; this is a teaching-grade European approximation.</p>`;
const M_SHOCK = `<p>A one-line market-clearing approximation: the share of world supply lost (after emergency stock draws), divided by the absolute short-run price elasticity of demand, gives the percentage price change needed to ration demand. It ignores the supply response, inventories held by traders and the term structure, so read it as a sensitivity, not a forecast.</p>`;
