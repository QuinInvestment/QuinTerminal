// CRV — prices, microstructure, term structure and cross-market context.

import { h, mount, cssVar } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { sub, get } from "../core/bus.js";
import { settings, save, proxyOn } from "../core/settings.js";
import { tsOption, heatOption, catLineOption, theme, tooltipStyle, ttRow, color, makeChart } from "../core/charts.js";
import { px, num, int, pct, spct, signed, isNum, shortDay, hhmmss, compact, dayYear, usd } from "../core/fmt.js";
import { upcoming, perpReference } from "../core/contracts.js";
import { cmeOpen, iceOpen } from "../core/clock.js";
import * as S from "../core/stats.js";
import * as hl from "../data/hyperliquid.js";
import * as eia from "../data/eia.js";
import * as fx from "../data/fx.js";
import * as model from "../data/model.js";
import { strip } from "../data/proxy.js";
import * as archive from "../data/archive.js";
import { CRISES } from "../data/static/crises.js";
import { load, chartIn, stat, seg, table, empty, ms } from "./kit.js";

const MARKETS = ["WTI", "BRENT", "HO", "NG", "GOLD", "SPX", "EUR"];
const DERIVED = { BW: { name: "Brent − WTI", a: "BRENT", b: "WTI", k: 1 }, CRACK: { name: "Diesel crack (ULSD×42 − WTI)", a: "HO", b: "WTI", k: 42 } };
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];
const SPAN = { "1m": 6 * 3600e3, "5m": 36 * 3600e3, "15m": 4 * 86400000, "1h": 14 * 86400000, "4h": 60 * 86400000, "1d": 420 * 86400000 };

export default {
  title: "Prices and curve",
  sub: "Live 24/7 chart, order book and tape for the crude perps; contract calendar, futures strip, the physical premium, crisis analogs and cross-asset context.",

  async mount(view, { scope, tools, arg }) {
    const [a0, a1] = String(arg || "").toUpperCase().split(/\s+/);
    const st = {
      mk: MARKETS.includes(a0) || DERIVED[a0] ? a0 : hl.byKey[a0] ? a0 : settings.chart.market === "CL" ? "WTI" : settings.chart.market || "WTI",
      iv: INTERVALS.includes((a1 || "").toLowerCase()) ? a1.toLowerCase() : settings.chart.interval || "15m",
    };
    if (!hl.byKey[st.mk] && !DERIVED[st.mk]) st.mk = "WTI";
    const mkSeg = seg([...MARKETS, "BW", "CRACK"].map((k) => ({ label: hl.byKey[k]?.short || (k === "BW" ? "Brent−WTI" : k === "CRACK" ? "Crack" : k), value: k })), st.mk, (v) => { st.mk = v; settings.chart.market = v; save(); drawChart(true); resubBook(); });
    const ivSeg = seg(INTERVALS.map((i) => ({ label: i, value: i })), st.iv, (v) => { st.iv = v; settings.chart.interval = v; save(); drawChart(true); });
    mount(tools, mkSeg, ivSeg);

    const pChart = panel({ title: "Chart", span: 8, rows: 9, src: ["hl"], chart: true, lead: true, method: M_CHART });
    const pBook = panel({ title: "Order book", span: 4, rows: 5, src: ["hl"], method: M_BOOK });
    const pTape = panel({ title: "Time and sales", span: 4, rows: 4, src: ["hl"], flush: true });
    const pCal = panel({ title: "Contract calendar", span: 4, rows: 6, flush: true, method: M_CAL });
    const pStrip = panel({ title: "Futures strip", span: 4, rows: 6, src: proxyOn() ? ["yahoo"] : ["archive"], chart: true, method: M_STRIP });
    const pPhys = panel({ title: "Physical premium: Dated Brent − perp", span: 4, rows: 6, src: ["eia", "hl"], chart: true, method: M_PHYS });
    const pTerm = panel({ title: "Calendar spreads over time", span: 6, rows: 7, src: ["archive"], chart: true, method: M_TERM });
    const pAnalog = panel({ title: "Crisis analogs: Brent, day 0 = 100", span: 6, rows: 7, src: ["eia", "hl"], chart: true, method: M_ANALOG });
    const pFx = panel({ title: "Brent in importers' currencies (2 Jan 2026 = 100)", span: 6, rows: 7, src: ["fx", "eia"], chart: true, method: M_FX });
    const pCorr = panel({ title: "Daily return correlations, last 60 sessions", span: 6, rows: 8, src: ["hl"], chart: true, method: M_CORR });
    const pLong = panel({ title: "Brent and WTI since 1987", span: 12, rows: 8, src: ["eia"], chart: true });
    view.appendChild(grid(pChart, pBook, pTape, pCal, pStrip, pPhys, pTerm, pAnalog, pFx, pCorr, pLong));

    // ------------------------------------------------ chart
    let candles = [], chart = null, liveSub = null;
    async function drawChart(reset = false) {
      const isDer = !!DERIVED[st.mk];
      pChart.setTitle(isDer ? DERIVED[st.mk].name : `${hl.byKey[st.mk].name} perp, ${st.iv}`);
      await load(pChart, async () => {
        const end = Date.now(), start = end - SPAN[st.iv];
        if (isDer) {
          const D = DERIVED[st.mk];
          const [a, b] = await Promise.all([hl.candles(hl.byKey[D.a].coin, st.iv, start, end), hl.candles(hl.byKey[D.b].coin, st.iv, start, end)]);
          const mb = new Map(b.map((c) => [c.t, c.c]));
          candles = a.filter((c) => mb.has(c.t)).map((c) => ({ t: c.t, c: c.c * D.k - mb.get(c.t), o: NaN }));
        } else {
          candles = await hl.candles(hl.byKey[st.mk].coin, st.iv, start, end);
        }
        if (!chart || reset) { chart = await chartIn(pChart); }
        paint();
        subscribeLive();
        pChart.setData([{ label: "Open time" }, { label: "Open", num: true }, { label: "High", num: true }, { label: "Low", num: true }, { label: "Close", num: true }, { label: "Volume", num: true }], candles.map((c) => [new Date(c.t).toISOString(), c.o, c.h, c.l, c.c, c.v]));
      });
    }
    function paint() {
      if (!chart) return;
      const T = theme();
      if (DERIVED[st.mk]) {
        chart.set(tsOption({ series: [{ name: DERIVED[st.mk].name, data: candles.map((c) => [c.t, c.c]), color: "--s2", area: 0.08 }], yFmt: (v) => "$" + num(v, 1), tipFmt: (v) => "$" + num(v, 3), zoom: true }));
        return;
      }
      const up = cssVar("--up"), dn = cssVar("--down");
      const cats = candles.map((c) => c.t);
      chart.set({
        animation: false, textStyle: { fontFamily: T.font },
        grid: [{ left: 8, right: 56, top: 8, height: "68%", containLabel: false }, { left: 8, right: 56, top: "78%", height: "13%" }],
        tooltip: { trigger: "axis", axisPointer: { type: "cross", lineStyle: { color: T.ink3 }, label: { backgroundColor: T.raised, color: T.ink1 } }, ...tooltipStyle(T),
          formatter: (ps) => { const c = candles[ps[0].dataIndex]; if (!c) return ""; return `<div style="opacity:.7">${new Date(c.t).toISOString().slice(0, 16).replace("T", " ")} UTC</div>` + [["Open", c.o], ["High", c.h], ["Low", c.l], ["Close", c.c]].map(([k, v]) => ttRow(c.c >= c.o ? up : dn, k, px(v))).join("") + ttRow(T.ink3, "Volume", compact(c.v)); } },
        axisPointer: { link: [{ xAxisIndex: "all" }] },
        xAxis: [
          { type: "category", data: cats, boundaryGap: true, axisLine: { lineStyle: { color: T.line } }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
          { type: "category", gridIndex: 1, data: cats, boundaryGap: true, axisLine: { lineStyle: { color: T.line } }, axisTick: { show: false }, axisLabel: { color: T.ink3, fontSize: 10, hideOverlap: true, formatter: (v) => { const d = new Date(+v); return st.iv === "1d" || st.iv === "4h" ? d.toISOString().slice(5, 10) : d.toISOString().slice(11, 16); } }, splitLine: { show: false } },
        ],
        yAxis: [
          { scale: true, position: "right", axisLabel: { color: T.ink3, fontSize: 10, formatter: (v) => px(v) }, splitLine: { lineStyle: { color: T.grid } } },
          { gridIndex: 1, scale: true, position: "right", axisLabel: { color: T.ink3, fontSize: 10, formatter: (v) => compact(v, 0) }, splitLine: { show: false } },
        ],
        dataZoom: [{ type: "inside", xAxisIndex: [0, 1], start: candles.length > 300 ? 100 - (100 * 300) / candles.length : 0, end: 100 }],
        series: [
          { type: "candlestick", name: hl.byKey[st.mk].name, data: candles.map((c) => [c.o, c.c, c.l, c.h]), itemStyle: { color: up, color0: dn, borderColor: up, borderColor0: dn }, barMaxWidth: 10,
            markLine: candles.length ? { silent: true, symbol: "none", label: { color: T.ink1, backgroundColor: T.raised, padding: [1, 4], fontSize: 10, formatter: (p) => px(p.value) }, lineStyle: { color: T.accent, type: "solid", width: 1 }, data: [{ yAxis: candles[candles.length - 1].c }] } : undefined },
          { type: "bar", name: "Volume", xAxisIndex: 1, yAxisIndex: 1, data: candles.map((c) => ({ value: c.v, itemStyle: { color: c.c >= c.o ? up : dn, opacity: 0.5 } })), barMaxWidth: 10 },
        ],
      }, true);
    }
    function subscribeLive() {
      if (liveSub) { liveSub(); liveSub = null; }
      if (DERIVED[st.mk]) return;
      const coin = hl.byKey[st.mk].coin;
      const s = { type: "candle", coin, interval: st.iv };
      hl.stream.subscribe(s);
      const off = sub(`hl:candle:${coin}:${st.iv}`, (c) => {
        if (!candles.length) return;
        const last = candles[candles.length - 1];
        if (c.t === last.t) candles[candles.length - 1] = c;
        else if (c.t > last.t) candles.push(c);
        else return;
        throttledPaint();
      }, { replay: false });
      liveSub = () => { off(); hl.stream.unsubscribe(s); };
    }
    let pt = 0;
    const throttledPaint = () => { if (Date.now() - pt > 1500) { pt = Date.now(); paint(); pChart.touch(); } };
    scope.add(() => liveSub && liveSub());
    await drawChart(true);

    // ------------------------------------------------ order book + tape
    let bookSubDef = null, offBook = null, offTrades = null;
    function resubBook() {
      const key = DERIVED[st.mk] ? "WTI" : st.mk;
      const coin = hl.byKey[key].coin;
      if (bookSubDef) hl.stream.unsubscribe(bookSubDef);
      if (offBook) offBook();
      if (offTrades) offTrades();
      bookSubDef = { type: "l2Book", coin };
      hl.stream.subscribe(bookSubDef);
      hl.book(coin).then(paintBook).catch(() => pBook.state("error", "Order book unavailable"));
      offBook = sub("hl:book:" + coin, (b) => throttleBook(b), { replay: false });
      if (!["xyz:CL", "xyz:BRENTOIL"].includes(coin)) hl.stream.subscribe({ type: "trades", coin });
      offTrades = sub("hl:trades:" + coin, (t) => paintTape(t, coin));
      paintTape(hl.recentTrades(coin), coin);
      pBook.setTitle(`Order book, ${hl.byKey[key].short}`);
      pTape.setTitle(`Time and sales, ${hl.byKey[key].short}`);
    }
    scope.add(() => { if (bookSubDef) hl.stream.unsubscribe(bookSubDef); if (offBook) offBook(); if (offTrades) offTrades(); });
    let bt = 0, bookChart = null;
    const throttleBook = (b) => { if (Date.now() - bt > 1000) { bt = Date.now(); paintBook(b); } };
    async function paintBook(b) {
      if (!b) return;
      const bids = b.bids.slice(0, 20), asks = b.asks.slice(0, 20);
      const mid = (bids[0].px + asks[0].px) / 2;
      const spreadBp = ((asks[0].px - bids[0].px) / mid) * 1e4;
      const bidDepth = bids.slice(0, 10).reduce((s, l) => s + l.sz * l.px, 0), askDepth = asks.slice(0, 10).reduce((s, l) => s + l.sz * l.px, 0);
      const imb = (bidDepth - askDepth) / (bidDepth + askDepth);
      if (!pBook._box) {
        pBook._stats = h("div", { class: "stats" });
        pBook._box = h("div", { style: { height: "calc(100% - 52px)", minHeight: "110px" } });
        mount(pBook.body, pBook._stats, pBook._box);
        bookChart = await makeChart(pBook._box);
        scope.add(() => bookChart.dispose());
      }
      mount(pBook._stats, stat("Spread", num(spreadBp, 1) + " bp", px(asks[0].px - bids[0].px)), stat("Depth, 10 levels", "$" + compact(bidDepth + askDepth), "bids + asks"), stat("Imbalance", spct(imb, 0), imb > 0 ? "bid-heavy" : "offer-heavy", { cls: imb > 0 ? "up" : "down" }));
      let cb = 0, ca = 0;
      const bidPts = bids.map((l) => [l.px, (cb += l.sz)]).reverse();
      const askPts = asks.map((l) => [l.px, (ca += l.sz)]);
      const T = theme();
      bookChart.set({
        animation: false, textStyle: { fontFamily: T.font }, grid: { left: 6, right: 8, top: 6, bottom: 4, containLabel: true },
        tooltip: { trigger: "axis", ...tooltipStyle(T), formatter: (ps) => `<div style="opacity:.7">${px(ps[0].value[0])}</div>` + ps.map((p) => ttRow(p.color, p.seriesName, num(p.value[1], 1))).join("") },
        xAxis: { type: "value", scale: true, axisLabel: { color: T.ink3, fontSize: 10, formatter: (v) => px(v) }, axisLine: { lineStyle: { color: T.line } }, splitLine: { show: false } },
        yAxis: { type: "value", axisLabel: { color: T.ink3, fontSize: 10, formatter: (v) => compact(v, 0) }, splitLine: { lineStyle: { color: T.grid } } },
        series: [
          { name: "Bids (cumulative)", type: "line", step: "end", symbol: "none", data: bidPts, lineStyle: { color: cssVar("--up"), width: 1.5 }, areaStyle: { color: cssVar("--up"), opacity: 0.12 }, itemStyle: { color: cssVar("--up") } },
          { name: "Asks (cumulative)", type: "line", step: "start", symbol: "none", data: askPts, lineStyle: { color: cssVar("--down"), width: 1.5 }, areaStyle: { color: cssVar("--down"), opacity: 0.12 }, itemStyle: { color: cssVar("--down") } },
        ],
      });
      pBook.touch(); pBook.state("ok");
      pBook.setData([{ label: "Side" }, { label: "Price", num: true }, { label: "Size", num: true }, { label: "Orders", num: true }], [...bids.map((l) => ["bid", l.px, l.sz, l.n]), ...asks.map((l) => ["ask", l.px, l.sz, l.n])]);
    }
    let tt = 0;
    function paintTape(list, coin) {
      if (Date.now() - tt < 700) return;
      tt = Date.now();
      const recent = list.slice(0, 60);
      const five = list.filter((t) => t.t > Date.now() - 5 * 60e3);
      const buy = five.filter((t) => t.side === "buy").reduce((s, t) => s + t.sz * t.px, 0), sell = five.filter((t) => t.side === "sell").reduce((s, t) => s + t.sz * t.px, 0);
      mount(pTape.body,
        h("div", { class: "row", style: { padding: "6px 10px", borderBottom: "1px solid var(--line)" } }, h("span", { class: "small" }, `5 min: buys $${compact(buy)} / sells $${compact(sell)}`), h("span", { class: "spacer" }), h("span", { class: "small " + (buy >= sell ? "up" : "down") }, (buy + sell) ? spct((buy - sell) / (buy + sell), 0) + " net" : "")),
        recent.length ? h("table", { class: "tbl" }, h("tbody", {}, recent.map((t) => {
          const big = t.sz * t.px >= 250000;
          return h("tr", {}, h("td", { class: "muted num" }, hhmmss(t.t, "UTC")), h("td", { class: "r num " + (t.side === "buy" ? "up" : "down") }, px(t.px)), h("td", { class: "r num" + (big ? " ac" : "") }, num(t.sz, 2)), h("td", { class: "r num muted" }, "$" + compact(t.sz * t.px)));
        }))) : h("div", { class: "note", style: { padding: "10px" } }, "Waiting for trades on the stream."));
      pTape.touch();
    }
    resubBook();

    // ------------------------------------------------ contract calendar
    const paintCal = () => {
      const now = new Date();
      const rows = [...upcoming("CL", 6, now).map((c) => ({ ...c, mkt: "WTI (NYMEX)" })), ...upcoming("B", 6, now).map((c) => ({ ...c, mkt: "Brent (ICE)" }))];
      const ref = { CL: perpReference("CL", now), B: perpReference("B", now) };
      mount(pCal.body,
        h("div", { class: "note", style: { padding: "8px 10px", borderBottom: "1px solid var(--line)" } },
          `WTI perp reference: ${ref.CL?.label || "—"}${ref.CL?.weightNext > 0 && ref.CL?.weightNext < 1 ? ` (${pct(ref.CL.weightNext, 0)} next month)` : ""}. Brent perp reference: ${ref.B?.label || "—"}. `,
          `CME ${cmeOpen(now) ? "open" : "closed"}, ICE ${iceOpen(now) ? "open" : "closed"}.`),
        table([
          { label: "Contract", get: (r) => h("span", { class: "mono" }, r.code) },
          { label: "Market", get: (r) => r.mkt },
          { label: "Delivery", get: (r) => r.label },
          { label: "Last trade", get: (r) => shortDay(r.lastTrade) },
          { label: "Days", r: true, get: (r) => r.daysLeft },
        ], rows));
      pCal.setData([{ label: "Contract" }, { label: "Market" }, { label: "Delivery" }, { label: "Last trade" }, { label: "Days left", num: true }], rows.map((r) => [r.code, r.mkt, r.label, r.lastTrade.toISOString().slice(0, 10), r.daysLeft]));
      pCal.touch();
    };
    paintCal();

    // ------------------------------------------------ futures strip
    // Live through the edge proxy; otherwise the daily archive (GitHub Actions).
    scope.every(10 * 60e3, () => load(pStrip, async () => {
      let w = [], b = [], how;
      if (proxyOn()) {
        [w, b] = await Promise.all([strip("CL", 12), strip("BZ", 12).catch(() => [])]);
        how = "live via edge proxy (Yahoo, about 10 min delayed)";
      } else {
        const snap = await archive.curveLatest();
        if (!snap) {
          mount(pStrip.body, h("div", { class: "note", style: { padding: "4px" } },
            h("p", {}, "No futures strip yet. Two free ways to get one: enable the Daily snapshot workflow on your GitHub copy (it archives 12 WTI and Brent contracts after each settlement), or deploy the edge proxy (worker/qt-edge.js) for intraday prices."),
            h("p", {}, "Meanwhile the perp tracks the front contract and the physical premium (right) shows Dated Brent against it.")));
          pStrip.setFoot("");
          return;
        }
        const hist = await archive.history("curve").catch(() => []);
        const monthAgo = new Date(Date.parse(snap.date + "T00:00:00Z") - 28 * 86400000).toISOString().slice(0, 10);
        const pastDate = [...new Set(hist.map((r) => r.date))].filter((d) => d <= monthAgo).sort().pop();
        const past = new Map(hist.filter((r) => r.date === pastDate && r.root === "CL").map((r) => [r.code, +r.price]));
        w = snap.CL.map((c) => ({ ...c, m1: past.get(c.code) ?? null }));
        b = snap.BZ;
        how = `daily archive, settlement snapshot of ${dayYear(ms(snap.date))}${pastDate ? ` vs ${dayYear(ms(pastDate))}` : ""}`;
      }
      if (!w.length) throw new Error("No WTI contract returned a price");
      const ch = await chartIn(pStrip);
      const cats = w.map((c) => c.label);
      const hasPast = w.some((c) => isNum(c.m1));
      ch.set(catLineOption({
        cats,
        series: [
          { name: "WTI", data: w.map((c) => c.price), color: "--s1" },
          ...(hasPast ? [{ name: "WTI a month earlier", data: w.map((c) => c.m1 ?? null), color: "--s1", dashed: true, showSymbol: false, width: 1.5 }] : []),
          ...(b.length ? [{ name: "Brent", data: cats.map((l) => b.find((x) => x.label === l)?.price ?? null), color: "--s2" }] : []),
        ],
        yFmt: (v) => "$" + num(v, 0),
      }));
      const m1m2 = w.length > 1 ? w[0].price - w[1].price : NaN, m1m6 = w.length > 5 ? w[0].price - w[5].price : NaN;
      pStrip.setFoot([h("span", {}, `WTI M1−M2 ${signed(m1m2)}`), h("span", {}, `M1−M6 ${signed(m1m6)}`), h("span", {}, m1m6 > 0 ? "backwardation: prompt barrels scarce" : "contango: prompt barrels ample"), h("span", {}, how)]);
      pStrip.setData([{ label: "Contract" }, { label: "Delivery" }, { label: "WTI", num: true }, { label: "WTI a month earlier", num: true }, { label: "Brent", num: true }], w.map((c) => [c.code, c.label, c.price, c.m1 ?? "", b.find((x) => x.label === c.label)?.price ?? ""]));
    }));

    // ------------------------------------------------ term-structure history (archive)
    scope.every(30 * 60e3, () => load(pTerm, async () => {
      const rows = await archive.history("curve");
      const sp = archive.spreads(rows);
      const days = new Set(rows.map((r) => r.date)).size;
      if (days < 2) {
        mount(pTerm.body, h("div", { class: "note", style: { padding: "4px" } },
          h("p", {}, days ? `The archive holds one settlement so far (${rows[0].date}). Spreads over time appear from the second weekday of snapshots.` : "Nothing archived yet. Once the Daily snapshot workflow runs, this panel tracks WTI and Brent calendar spreads day by day: the clearest gauge of how tight prompt supply is."),
          h("p", {}, "M1−M2 is the cost of rolling a long position one month; M1−M12 the shape of the whole year. Large positive values are steep backwardation.")));
        return;
      }
      const ch = await chartIn(pTerm);
      const line = (arr, key) => arr.filter((x) => isNum(x[key])).map((x) => [ms(x.date), x[key]]);
      ch.set(tsOption({
        series: [
          { name: "WTI M1−M2", data: line(sp.CL, "m1m2"), color: "--s1" },
          { name: "WTI M1−M12", data: line(sp.CL, "m1m12"), color: "--s1", dashed: true, width: 1.5 },
          { name: "Brent M1−M2", data: line(sp.BZ, "m1m2"), color: "--s2" },
          { name: "Brent M1−M12", data: line(sp.BZ, "m1m12"), color: "--s2", dashed: true, width: 1.5 },
        ],
        marks: [{ y: 0 }], yFmt: (v) => usd(v, Math.abs(v) < 10 && v !== Math.round(v) ? 1 : 0), tipFmt: (v) => usd(v, 2),
      }));
      const lc = sp.CL.at(-1), lb = sp.BZ.at(-1);
      pTerm.setFoot([h("span", {}, `${days} settlements archived since ${dayYear(ms(rows[0].date))}`), lc ? h("span", {}, `WTI M1−M2 ${usd(lc.m1m2, 2)}`) : null, lb ? h("span", {}, `Brent M1−M2 ${usd(lb.m1m2, 2)}`) : null]);
      pTerm.setData([{ label: "Date" }, { label: "Root" }, { label: "M1", num: true }, { label: "M1−M2", num: true }, { label: "M1−M6", num: true }, { label: "M1−M12", num: true }],
        [...sp.CL.map((x) => [x.date, "CL", x.m1, x.m1m2, x.m1m6, x.m1m12]), ...sp.BZ.map((x) => [x.date, "BZ", x.m1, x.m1m2, x.m1m6, x.m1m12])]);
    }));

    // ------------------------------------------------ physical premium
    scope.every(30 * 60e3, () => load(pPhys, async () => {
      const [sp, perp] = await Promise.all([eia.spot(), hl.candles("xyz:BRENTOIL", "1d", Date.UTC(2026, 0, 1), Date.now(), 600e3)]);
      const dated = new Map((sp.series.RBRTE || []).filter((p) => p.t >= "2026-01-01").map((p) => [p.t, p.v]));
      const pts = perp.map((c) => { const d = new Date(c.t).toISOString().slice(0, 10); return dated.has(d) ? [c.t, dated.get(d) - c.c] : null; }).filter(Boolean);
      const ch = await chartIn(pPhys);
      ch.set(tsOption({ series: [{ name: "Dated Brent − Brent perp", data: pts, color: "--s2", area: 0.1 }], marks: [{ y: 0 }, { x: ms("2026-02-28"), label: "Hormuz" }], yFmt: (v) => usd(v, 0), tipFmt: (v) => usd(v, 2), legend: false }));
      const last = pts[pts.length - 1];
      pPhys.setFoot(last ? [h("span", {}, `Latest ${shortDay(last[0])}: ${signed(last[1])} $/bbl`), h("span", {}, "Positive = physical cargoes priced above the futures-linked perp")] : "");
      pPhys.setData([{ label: "Date" }, { label: "Premium $/bbl", num: true }], pts.map(([t, v]) => [new Date(t).toISOString().slice(0, 10), v]));
    }));

    // ------------------------------------------------ crisis analogs
    scope.every(60 * 60e3, () => load(pAnalog, async () => {
      const { points } = await model.dailyHistory("BRENT");
      const idx = new Map(points.map((p, i) => [p.t, i]));
      const series = [];
      CRISES.forEach((c, k) => {
        let i = idx.get(c.date);
        if (i == null) { const j = points.findIndex((p) => p.t >= c.date); if (j < 0) return; i = j; }
        const base = points[i].v;
        const data = [];
        for (let d = -20; d <= 250 && i + d < points.length; d++) { if (i + d < 0) continue; data.push([d, (points[i + d].v / base) * 100]); }
        // one highlighted line, the past shocks as grey context labelled by year (no fifth colour)
        series.push({ name: `${c.name} (${c.date.slice(0, 4)})`, year: c.date.slice(0, 4), data, current: !!c.current, color: c.current ? "--hazard" : "--ref", width: c.current ? 2.5 : 1 });
      });
      const ch = await chartIn(pAnalog);
      const T = theme();
      ch.set({
        animation: false, textStyle: { fontFamily: T.font },
        grid: { left: 8, right: 12, top: 46, bottom: 6, containLabel: true },
        backgroundColor: "transparent",
        tooltip: { trigger: "axis", ...tooltipStyle(T), formatter: (ps) => `<div style="color:${T.muted};font-family:${T.mono};font-size:11px">Trading day ${ps[0].value[0]}</div>` + ps.map((p) => ttRow(p.color, p.seriesName, num(p.value[1], 1))).join("") },
        xAxis: { type: "value", min: -20, max: 250, axisLabel: { color: T.muted, fontSize: 11 }, axisLine: { lineStyle: { color: T.lineStrong } }, splitLine: { show: false }, name: "trading days from the event", nameLocation: "middle", nameGap: 22, nameTextStyle: { color: T.muted, fontSize: 11 } },
        yAxis: { type: "value", scale: true, axisLabel: { color: T.muted, fontSize: 11 }, splitLine: { lineStyle: { color: T.line } } },
        series: series.map((s) => ({ name: s.name, type: "line", symbol: "none", data: s.data, z: s.current ? 5 : 2, lineStyle: { color: color(s.color), width: s.width, opacity: s.current ? 1 : 0.85 }, itemStyle: { color: color(s.color) },
          endLabel: { show: true, formatter: () => (s.current ? "2026" : s.year), color: s.current ? T.text : T.muted, fontSize: 10, fontFamily: T.mono }, labelLayout: { moveOverlap: "shiftY" } })),
      });
      pAnalog.setFoot("Magenta: the 2026 Hormuz closure. Grey: earlier supply shocks, labelled by year (1990 Kuwait, 2011 Libya, 2019 Abqaiq, 2022 Ukraine, 2025 Israel–Iran). Hover for values.");
      pAnalog.setData([{ label: "Crisis" }, { label: "Day", num: true }, { label: "Index", num: true }], series.flatMap((s) => s.data.map(([d, v]) => [s.name, d, v])));
    }));

    // ------------------------------------------------ oil in local currencies
    scope.every(6 * 3600e3, () => load(pFx, async () => {
      const [{ points }, rates] = await Promise.all([model.dailyHistory("BRENT"), fx.history("2025-12-15")]);
      const dates = Object.keys(rates).sort().filter((d) => d >= "2026-01-02");
      const bMap = new Map(points.map((p) => [p.t, p.v]));
      const rows = dates.map((d) => ({ d, b: bMap.get(d), r: rates[d] })).filter((x) => isNum(x.b));
      if (!rows.length) throw new Error("No overlapping dates");
      const base = rows[0];
      const lines = [{ c: "USD", f: () => 1 }, ...fx.CCY.filter((c) => c.c !== "GBP").map((c) => ({ c: c.c, f: (r) => r[c.c] }))];
      const ch = await chartIn(pFx);
      // the dollar price highlighted, the other currencies as grey context labelled at the line ends
      const o = tsOption({ series: lines.map((l) => ({ name: l.c === "USD" ? "US dollar" : l.c, data: rows.map((x) => [ms(x.d), (x.b * l.f(x.r)) / (base.b * l.f(base.r)) * 100]), color: l.c === "USD" ? "--s1" : "--ref", width: l.c === "USD" ? 2 : 1 })), legend: false, yFmt: (v) => num(v, 0), grid: { right: 44 } });
      const T2 = theme();
      o.series.forEach((sr) => { sr.endLabel = { show: true, formatter: (p) => (p.seriesName === "US dollar" ? "USD" : p.seriesName), color: sr.name === "US dollar" ? T2.text : T2.muted, fontSize: 10, fontFamily: T2.mono }; sr.labelLayout = { moveOverlap: "shiftY" }; });
      ch.set(o);
      pFx.setFoot("Brent indexed to 100 on 2 January 2026, in each currency. Blue: the dollar price; grey: the euro, yen, yuan, rupee and won.");
      pFx.setData([{ label: "Date" }, ...lines.map((l) => ({ label: l.c, num: true }))], rows.map((x) => [x.d, ...lines.map((l) => (x.b * l.f(x.r)) / (base.b * l.f(base.r)) * 100)]));
    }));

    // ------------------------------------------------ correlations
    scope.every(60 * 60e3, () => load(pCorr, async () => {
      const keys = ["WTI", "BRENT", "HO", "NG", "GOLD", "COPPER", "SPX", "NDX", "EUR", "JPY", "TLT"];
      const closes = await hl.dailyCloses(keys.map((k) => hl.byKey[k].coin), Date.now() - 140 * 86400000);
      const rets = {};
      for (const k of keys) {
        const arr = closes[hl.byKey[k].coin] || [];
        const m = new Map();
        for (let i = 1; i < arr.length; i++) if (arr[i - 1].c > 0 && arr[i].c > 0) m.set(arr[i].t, Math.log(arr[i].c / arr[i - 1].c));
        rets[k] = m;
      }
      const common = [...rets.WTI.keys()].filter((t) => keys.every((k) => rets[k].has(t))).sort((a, b) => a - b).slice(-60);
      const cols = keys.map((k) => common.map((t) => rets[k].get(t)));
      const cells = [];
      keys.forEach((a, i) => keys.forEach((b, j) => cells.push([j, i, +S.corr(cols[i], cols[j]).toFixed(2)])));
      const ch = await chartIn(pCorr);
      const lab = keys.map((k) => hl.byKey[k].short);
      ch.set(heatOption({ xCats: lab, yCats: lab, cells, min: -1, max: 1, fmt: (v) => num(v, 2) }));
      pCorr.setFoot(`${common.length} common daily returns. Perps trade 24/7, so weekend days are included.`);
      pCorr.setData([{ label: "Row" }, { label: "Column" }, { label: "Correlation", num: true }], cells.map(([j, i, v]) => [lab[i], lab[j], v]));
    }));

    // ------------------------------------------------ long history
    scope.every(12 * 3600e3, () => load(pLong, async () => {
      const sp = await eia.spot();
      const b = sp.series.RBRTE || [], w = sp.series.RWTC || [];
      const ch = await chartIn(pLong);
      ch.set(tsOption({
        series: [{ name: "Brent (Europe spot)", data: b.map((p) => [ms(p.t), p.v]), color: "--s2", width: 1.2 }, { name: "WTI (Cushing spot)", data: w.filter((p) => p.v > 0).map((p) => [ms(p.t), p.v]), color: "--s1", width: 1.2 }],
        marks: CRISES.map((c) => ({ x: ms(c.date), label: c.date.slice(0, 4) })),
        yFmt: (v) => "$" + num(v, 0), tipFmt: (v) => "$" + num(v, 2), zoom: true, logY: false,
      }));
      pLong.setData([{ label: "Date" }, { label: "Brent", num: true }], b.map((p) => [p.t, p.v]));
      pLong.setFoot(`EIA daily spot through ${b.length ? dayYear(ms(b[b.length - 1].t)) : "—"}; EIA publishes with about a one-week lag.`);
    }));
  },
};

const M_CHART = `<p>Candles from Hyperliquid's candle snapshot API, updated live from the WebSocket candle stream. These are the trade.xyz perps, which track CME/ICE futures through an oracle and keep trading when the exchanges are shut. Spread charts (Brent − WTI, diesel crack) are built from aligned closes.</p>`;
const M_BOOK = `<p>Top 20 levels of the perp's central limit order book. Imbalance compares the dollar value of the first 10 bid and ask levels. A thin, one-sided book around news is a useful warning; it says little about the far larger CME and ICE markets.</p>`;
const M_CAL = `<p>Last trading days follow the exchange rules: NYMEX CL stops three business days before the 25th calendar day of the month before delivery; ICE Brent stops on the last UK business day of the second month before delivery. Holidays are computed (US federal for CME, England for ICE). The perp reference walks from the expiring month to the next in 20% steps, finishing about five business days before expiry (estimate based on trade.xyz's published schedule).</p>`;
const M_STRIP = `<p>Last prices of the next 12 NYMEX WTI (CL) and Brent (BZ) contracts from Yahoo Finance: live (about 10 minutes delayed) through your edge proxy, or otherwise the daily archive that the Daily snapshot workflow writes after each settlement (pipeline/snapshot.mjs). Backwardation (near months above far months) signals scarce prompt barrels and inventories being drawn; contango signals the opposite.</p>`;
const M_TERM = `<p>Calendar spreads computed from the daily archive (data/history/curve.csv): on each snapshot date the contracts still trading are sorted by last trading day, M1 is the first. M1−M2 is what a long position pays (or earns) to roll one month; M1−M12 is the slope of the year. Free sources keep no history of the whole curve, which is why the terminal builds its own from the first day the workflow runs.</p>`;
const M_PHYS = `<p>EIA's Europe Brent spot is a Dated Brent assessment: the price of physical North Sea cargoes loading in the coming weeks. The perp tracks ICE Brent futures (currently the second month after the roll). When physical cargoes trade above futures, refiners are paying up for prompt barrels: a hallmark of supply crises.</p>`;
const M_ANALOG = `<p>Brent (EIA Europe spot, extended with perp returns after the last EIA print) rebased to 100 on the first trading day of each crisis. The 2026 line is in magenta. History rhymes loosely: 1990 and 2026 are physical losses of several million barrels a day, 2019 was restored within weeks, 2022 was a sanctions shock.</p>`;
const M_FX = `<p>Brent converted at ECB reference rates (via Frankfurter) and indexed to the first 2026 trading day. A weaker local currency amplifies the shock for importers like India, Japan and Korea.</p>`;
const M_CORR = `<p>Pearson correlation of daily log returns over the last 60 common sessions, all from Hyperliquid perps so the timestamps line up. Correlations are unstable; read the sign and rough size, not the second decimal.</p>`;
