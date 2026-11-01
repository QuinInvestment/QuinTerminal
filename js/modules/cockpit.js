// OIL — the cockpit: live crude, Hormuz status, the balance of risks, US
// fundamentals, event odds, a one-month outlook, spreads, alerts, event clock.

import { h, mount, cssVar } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { sub, get, pub } from "../core/bus.js";
import { tsOption, color, makeChart } from "../core/charts.js";
import { px, num, signed, spct, pct, dirClass, mb, mbd, ago, countdown, isNum, shortDay, usd } from "../core/fmt.js";
import { eventList } from "../core/clock.js";
import * as alerts from "../core/alerts.js";
import * as S from "../core/stats.js";
import * as hl from "../data/hyperliquid.js";
import * as eia from "../data/eia.js";
import * as cftc from "../data/cftc.js";
import * as poly from "../data/polymarket.js";
import * as straits from "../data/straits.js";
import * as model from "../data/model.js";
import { load, chartIn, stat, quote, pbar, factor, ms } from "./kit.js";

export default {
  title: "Oil cockpit",
  sub: "Live crude, the Hormuz blockade, US balances, positioning and event odds on one screen. Every figure links to its source.",

  async mount(view, { scope, go }) {
    const pLive = panel({ title: "Live crude (24/7 perps)", span: 5, rows: 7, src: ["hl"], lead: true, method: METHOD_LIVE });
    const pHormuz = panel({ title: "Strait of Hormuz", span: 4, rows: 7, src: ["straits", "poly"], alarm: true, method: METHOD_HORMUZ });
    const pRisk = panel({ title: "Balance of risks", span: 3, rows: 7, src: ["straits", "eia", "cftc", "poly", "hl"], method: METHOD_RISK });
    const pEia = panel({ title: "US weekly balance (EIA)", span: 4, rows: 6, src: ["eia"], flush: true, method: METHOD_EIA });
    const pOdds = panel({ title: "Event odds", span: 4, rows: 6, src: ["poly"], method: METHOD_ODDS });
    const pOut = panel({ title: "Brent, one month ahead", span: 4, rows: 6, src: ["eia", "hl", "poly"], method: METHOD_OUTLOOK });
    const pSpread = panel({ title: "Brent–WTI and diesel crack, 7 days", span: 5, rows: 5, src: ["hl"], chart: true, method: METHOD_SPREAD });
    const pAlerts = panel({ title: "Signals and alerts", span: 4, rows: 5, src: [], flush: true });
    const pClock = panel({ title: "Event clock", span: 3, rows: 5, flush: true });
    view.appendChild(grid(pLive, pHormuz, pRisk, pEia, pOdds, pOut, pSpread, pAlerts, pClock));

    // ------------------------------------------------ live quotes + intraday chart
    const qBox = h("div", { class: "quotes" });
    const chartBox = h("div", { style: { height: "calc(100% - 128px)", minHeight: "120px", marginTop: "8px" } });
    pLive.body.append(qBox, chartBox);
    const liveChart = await makeChart(chartBox);
    scope.add(() => liveChart.dispose());
    scope.sub("tape", (t) => {
      mount(qBox, quote(t.rows.WTI), quote(t.rows.BRENT));
      pLive.touch(t.t);
    });
    let intraday = { CL: [], B: [] };
    const drawIntraday = () => {
      const t = get("tape");
      const pts = (arr, live) => {
        const d = arr.map((c) => [c.t, c.c]);
        if (isNum(live) && d.length) d.push([Date.now(), live]);
        return d;
      };
      liveChart.set(tsOption({
        series: [
          { name: "Brent", data: pts(intraday.B, t?.rows.BRENT.px), color: "--s2" },
          { name: "WTI", data: pts(intraday.CL, t?.rows.WTI.px), color: "--s1" },
        ],
        yFmt: (v) => num(v, 0),
        tipFmt: (v) => px(v),
      }));
    };
    scope.every(60e3, () => load(pLive, async () => {
      const since = Date.now() - 48 * 3600e3;
      const [cl, b] = await Promise.all([hl.candles("xyz:CL", "15m", since), hl.candles("xyz:BRENTOIL", "15m", since)]);
      intraday = { CL: cl, B: b };
      drawIntraday();
    }, { quiet: true }));
    let lastDraw = 0;
    scope.sub("tape", () => { if (Date.now() - lastDraw > 5000) { lastDraw = Date.now(); drawIntraday(); } });

    // ------------------------------------------------ Hormuz
    let transitSeries = [];
    let hzChart = null;
    scope.add(() => hzChart && hzChart.dispose());
    const paintHormuz = (d) => {
      if (!d) return;
      const t = d.transits;
      const board = get("poly:board");
      const curve = board ? poly.reopenCurve(board) : [];
      const dec = curve.find((c) => new Date(c.t).getUTCMonth() === 11) || curve[curve.length - 1];
      const spark = h("div", { style: { height: "96px", margin: "8px 0 4px" } });
      mount(pHormuz.body,
        h("div", { class: "row", style: { alignItems: "flex-end", gap: "14px" } },
          h("div", {}, h("div", { class: "hero hz" }, isNum(t.throughputPct) ? t.throughputPct + "%" : "—"), h("div", { class: "tiny muted" }, "of pre-war daily transits")),
          h("div", { class: "stats", style: { flex: 1 } },
            stat("Last day", isNum(t.count) ? `${t.count} ships` : "—", `${t.asOf ? shortDay(ms(t.asOf)) : ""} · baseline ${t.baseline ?? "—"}`),
            stat("Stranded", isNum(d.stranded) ? num(d.stranded, 0) : "—", "vessels holding in the Gulf"),
            stat("War-risk premium", isNum(d.insurance.multiple) ? d.insurance.multiple + "×" : "—", d.insurance.stale ? "pre-war multiple, figures stale" : "pre-war multiple"))),
        spark,
        dec ? pbar(`Traffic back to normal by ${new Date(dec.t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`, dec.p, { d1: dec.d1, color: "var(--s3)", href: dec.url }) : null,
        h("div", { class: "tiny muted", style: { marginTop: "6px" } }, d.verdictText || ""));
      if (transitSeries.length) {
        if (hzChart) { hzChart.dispose(); hzChart = null; }
        makeChart(spark).then((ch) => {
          hzChart = ch;
          ch.set(tsOption({
            series: [{ name: "Daily transits", data: transitSeries.map((r) => [ms(r.t), r.total]), color: "--hazard", area: 0.12, width: 1.5 }],
            marks: [{ x: ms("2026-02-28"), label: "Closure" }],
            legend: false, yFmt: (v) => num(v, 0), grid: { top: 6, bottom: 2, left: 2, right: 6 },
          }));
        });
      }
      pHormuz.touch();
      pHormuz.state("ok");
    };
    scope.sub("straits:digest", paintHormuz);
    scope.every(30 * 60e3, () => load(pHormuz, async () => { transitSeries = await straits.transits(); paintHormuz(get("straits:digest")); }, { quiet: true }));
    if (!get("straits:digest")) pHormuz.state("loading", "Loading Hormuz status");

    // ------------------------------------------------ data used by several panels
    const ctx = { weekly: null, cot: null, board: null, hist: null };
    let outBusy = false, outLastTry = 0; // outlook paint guard (see paintOutlook)

    scope.every(30 * 60e3, () => load(pEia, async () => {
      ctx.weekly = await eia.weekly();
      paintEia();
      paintRisk();
    }));
    scope.every(60 * 60e3, async () => {
      try { ctx.cot = await cftc.cot(); paintRisk(); } catch {}
    });
    scope.every(5 * 60e3, () => load(pOdds, async () => {
      ctx.board = await poly.board();
      pub("poly:board", ctx.board);
      paintOdds();
      paintRisk();
      paintHormuz(get("straits:digest"));
      paintOutlook();
    }));
    // The outlook needs three inputs that land in any order (live tape, daily
    // history, odds board). Show a loading state until the first paint, and
    // retry on whichever input arrives last.
    pOut.state("loading", "Fitting volatility and scenarios");
    scope.every(20 * 60e3, async () => {
      try {
        ctx.hist = await model.dailyHistory("BRENT");
        if (!ctx.hist?.points?.length) throw new Error("No daily price history (EIA and Hyperliquid both unavailable)");
        paintRisk();
        paintOutlook();
      } catch (e) {
        if (!pOut.updatedAt) pOut.state("error", "Outlook unavailable", e.message || String(e));
      }
    });
    scope.sub("tape", () => { if (!pOut.updatedAt && ctx.hist && Date.now() - outLastTry > 60e3) paintOutlook(); });
    scope.sub("straits:digest", () => paintRisk(), { replay: false });

    // ------------------------------------------------ EIA table
    const EIA_ROWS = ["WCESTUS1", "W_EPC0_SAX_YCUOK_MBBL", "WCSSTUS1", "WGTSTUS1", "WDISTUS1", "WPULEUS3", "WCRFPUS2", "WCREXUS2"];
    function paintEia() {
      const w = ctx.weekly;
      if (!w) return;
      const rows = EIA_ROWS.map((id) => eia.summarise(id, w.series[id])).filter(Boolean);
      const fmtV = (r, v) => (r.unit === "%" ? num(v, 1) + "%" : r.unit === "kb/d" ? mbd(v) : mb(v));
      const fmtD = (r, v) => (r.unit === "%" ? signed(v, 1) + " pt" : r.unit === "kb/d" ? signed(v / 1000, 2) : signed(v / 1000, 1));
      mount(pEia.body, h("table", { class: "tbl" },
        h("thead", {}, h("tr", {}, h("th", {}, `Week to ${rows[0] ? shortDay(ms(rows[0].t)) : ""}`), h("th", { class: "r" }, "Level"), h("th", { class: "r" }, "Week"), h("th", { class: "r", title: "Deviation from the 5-year average for the same week" }, "vs 5y"))),
        h("tbody", {}, rows.map((r) => h("tr", { class: "clickable", onclick: () => go("STK") },
          h("td", {}, r.name),
          h("td", { class: "r" }, fmtV(r, r.v)),
          h("td", { class: "r " + dirClass(r.kind === "stock" ? r.wow : 0) }, fmtD(r, r.wow)),
          h("td", { class: "r " + (r.kind === "stock" ? dirClass(r.dev) : "") }, isNum(r.devPct) ? spct(r.devPct, 1) : "—"))))));
      pEia.setData([{ label: "Series" }, { label: "Week" }, { label: "Level", num: true }, { label: "Weekly change", num: true }, { label: "5y avg", num: true }, { label: "Dev %", num: true }],
        rows.map((r) => [r.name, r.t, r.v, r.wow, r.avg5, r.devPct]));
      // signal: large crude draw/build vs the seasonal norm
      const c = rows.find((r) => r.id === "WCESTUS1");
      if (c && Math.abs(c.surprise) > 4000) alerts.raise({ id: "eia-crude-" + c.t, sev: "info", title: `US crude stocks ${c.wow < 0 ? "drew" : "built"} ${num(Math.abs(c.wow) / 1000, 1)} mb`, text: `${signed(c.surprise / 1000, 1)} mb versus the usual change for this week.`, source: "EIA", quiet: true });
    }

    // ------------------------------------------------ odds
    function paintOdds() {
      const board = ctx.board;
      if (!board) return;
      const all = board.flatMap((e) => e.markets.map((m) => ({ ...m, ev: e })));
      const picked = [];
      for (const pat of poly.HEADLINE_PATTERNS) {
        const cands = all.filter((m) => pat.re.test(m.q)).sort((a, b) => (b.vol || 0) - (a.vol || 0));
        if (cands[0]) picked.push({ label: pat.label, m: cands[0] });
      }
      for (const m of all.sort((a, b) => (b.vol || 0) - (a.vol || 0))) {
        if (picked.length >= 7) break;
        if (picked.some((x) => x.m.id === m.id)) continue;
        if (/hit \((high|low)\)|closes above|up or down/i.test(m.q)) continue;
        picked.push({ label: m.q, m });
      }
      mount(pOdds.body, picked.slice(0, 7).map(({ label, m }) => pbar(label, m.p, { d1: m.d1, href: m.url, color: "var(--s1)" })),
        h("div", { class: "tiny muted", style: { marginTop: "6px" } }, "Market-implied probabilities, not forecasts of ours. Click a line for the market."));
      pOdds.setData([{ label: "Market" }, { label: "Probability", num: true }, { label: "24h change", num: true }, { label: "Volume $", num: true }], picked.map(({ m }) => [m.q, m.p, m.d1, m.vol]));
      for (const { m } of picked) if (isNum(m.d1) && Math.abs(m.d1) >= 0.07) alerts.raise({ id: "poly-" + m.id + "-" + new Date().toISOString().slice(0, 10), sev: "warn", title: `Odds moved ${m.d1 > 0 ? "+" : "−"}${num(Math.abs(m.d1) * 100, 0)} pts`, text: m.q, source: "Polymarket", quiet: true });
    }

    // ------------------------------------------------ balance of risks
    function paintRisk() {
      const d = get("straits:digest");
      const items = [];
      if (d && isNum(d.transits.throughputPct)) {
        const def = 1 - d.transits.throughputPct / 100;
        items.push({ n: "Hormuz flow loss", z: 3 * def, t: `${pct(def, 0)} lost`, title: "Share of pre-war transits missing (IMF PortWatch). Full closure = +3." });
      }
      const bab = d?.chokepoints?.find((c) => /bab|mandeb|red/i.test(c.key + c.label));
      if (bab && isNum(bab.n) && isNum(bab.base) && bab.base > 0) items.push({ n: "Bab el-Mandeb flow", z: 3 * Math.max(0, 1 - bab.n / bab.base), t: `${num(bab.n, 0)} vs ${num(bab.base, 0)}`, title: "Daily transits versus the pre-crisis median." });
      if (ctx.weekly) {
        const c = eia.summarise("WCESTUS1", ctx.weekly.series.WCESTUS1);
        if (c && isNum(c.z)) items.push({ n: "US crude stocks", z: -c.z, t: spct(c.devPct, 1), title: "Deviation from the 5-year same-week average, in standard deviations, sign flipped (low stocks push prices up)." });
        const di = eia.summarise("WDISTUS1", ctx.weekly.series.WDISTUS1);
        if (di && isNum(di.z)) items.push({ n: "Distillate stocks", z: -di.z, t: spct(di.devPct, 1), title: "Diesel tightness versus the 5-year norm." });
        const spr = ctx.weekly.series.WCSSTUS1;
        if (spr?.length > 100) {
          const hist = spr.filter((p) => p.t < "2026-01-01").map((p) => p.v);
          const last = spr[spr.length - 1].v;
          items.push({ n: "SPR buffer", z: -(last - S.mean(hist)) / (S.std(hist) || 1), t: mb(last, 0), title: "Strategic reserve versus its 2018–2025 range. A thin buffer adds upside risk." });
        }
      }
      if (ctx.cot) {
        const p = cftc.positioning(ctx.cot["067651"]);
        if (p) items.push({ n: "Speculators (WTI)", z: -p.zPct, t: `${pct(p.pctile, 0)} pctile`, title: "Managed-money net length as % of open interest vs 3 years, sign flipped: crowded longs are a downside risk." });
      }
      const pts = ctx.hist?.points;
      if (pts?.length > 60) { // perp-only history (no EIA) is ~8 months: enough for a 21-day move vs its volatility
        const closes = pts.map((p) => p.v);
        const r = S.logReturns(closes);
        const r21 = Math.log(closes[closes.length - 1] / closes[closes.length - 22]);
        const sd = S.std(r.slice(-250)) * Math.sqrt(21);
        items.push({ n: "1-month momentum", z: r21 / (sd || 1), t: spct(Math.exp(r21) - 1, 1), title: "21-day log return over its typical 21-day volatility." });
      }
      if (d && isNum(d.index.escalation)) items.push({ n: "Escalation index", z: (d.index.escalation - 50) / 20, t: `${num(d.index.escalation, 0)}/100`, title: "straits.live escalation forecast (0–100), centred at 50." });
      const tape = get("tape");
      if (tape) {
        const bw = tape.derived.BW.px;
        if (isNum(bw)) items.push({ n: "Brent–WTI spread", z: (bw - 4) / 2.5, t: "$" + num(bw, 2), title: "Waterborne crude premium over inland WTI; normal is about $3–5. Wide = seaborne supply stress." });
      }
      const zs = items.map((i) => S.clamp(i.z, -3, 3));
      const net = zs.length ? S.mean(zs) : NaN;
      mount(pRisk.body,
        h("div", { class: "row", style: { justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px" } },
          h("span", { class: "small muted" }, "Net reading"),
          h("span", { style: { fontSize: "var(--t-24)", fontWeight: 600 }, class: isNum(net) ? (net > 0.25 ? "up" : net < -0.25 ? "down" : "flat") : "" }, isNum(net) ? `${net > 0 ? "+" : "−"}${num(Math.abs(net), 2)}σ` : "—")),
        h("div", { class: "tiny muted", style: { marginBottom: "6px" } }, isNum(net) ? (net > 0.25 ? "Factors lean to upward price pressure" : net < -0.25 ? "Factors lean to downward price pressure" : "Factors roughly balanced") : "Loading factors"),
        items.map((i) => factor(i.n, i.z, i.t, i.title)),
        h("div", { class: "tiny muted", style: { marginTop: "6px" } }, "Bars right = upward pressure. Equal-weight scorecard, not a trading signal."));
      pRisk.setData([{ label: "Factor" }, { label: "z (+ = bullish)", num: true }, { label: "Reading" }], items.map((i) => [i.n, i.z, i.t]));
      pRisk.touch();
      pRisk.state("ok");
      if (tape && isNum(tape.derived.BW.px) && tape.derived.BW.px > 10) alerts.raise({ id: "bw-wide", sev: "warn", title: `Brent–WTI at $${num(tape.derived.BW.px, 2)}`, text: "Seaborne crude trades at a crisis premium over inland WTI.", source: "Hyperliquid", quiet: true });
    }

    // ------------------------------------------------ outlook (three lenses)
    async function paintOutlook() {
      const tape = get("tape");
      const S0 = tape?.rows?.BRENT?.px;
      if (!isNum(S0) || !ctx.hist || outBusy) return;
      outBusy = true;
      outLastTry = Date.now();
      await load(pOut, async () => {
        const H = 21, T = H / 252;
        const { g } = await model.garch("BRENT");
        const sim = S.fhsSimulate(g, S0, H, { paths: 6000 });
        const stat = sim.bands[H - 1];
        const prewarPt = ctx.hist.points.filter((p) => p.t <= "2026-02-27").pop();
        const scen = model.defaultScenarios({ S0, prewar: prewarPt?.v, hDays: 30, events: ctx.board, gVol: S.garchHorizonVol(g, H) });
        const mix = model.mixture(scen, T);
        let mkt = null;
        if (ctx.board) {
          const lad = model.ladderVols(poly.barrierLadders(ctx.board), tape.rows.WTI.px);
          if (lad.length) {
            const iv = S.median(lad.map((x) => x.iv));
            const q = (p) => S.lnQuantile(S0, iv, T, p);
            mkt = { q5: q(0.05), q25: q(0.25), q50: S0, q75: q(0.75), q95: q(0.95), iv, n: lad.length };
          }
        }
        const rows = [
          { name: "Statistical", sub: "GARCH, resampled shocks", q: { q5: stat[0], q25: stat[1], q50: stat[2], q75: stat[3], q95: stat[4] } },
          { name: "Scenarios", sub: `deal ${pct(scen[0].p, 0)}, escalation ${pct(scen[2].p, 0)}`, q: mix },
          mkt ? { name: "Markets", sub: `barrier-implied vol ${pct(mkt.iv, 0)}`, q: mkt } : null,
        ].filter(Boolean);
        mount(pOut.body, rangePlot(rows, S0), h("div", { class: "row", style: { justifyContent: "space-between", marginTop: "4px" } },
          h("span", { class: "tiny muted" }, "Bars: 25–75%, whiskers: 5–95%, tick: median."),
          h("button", { class: "btn ghost", type: "button", onclick: () => go("FCST") }, "Open forecast lab")));
        pOut.setData([{ label: "Lens" }, { label: "P5", num: true }, { label: "P25", num: true }, { label: "Median", num: true }, { label: "P75", num: true }, { label: "P95", num: true }], rows.map((r) => [r.name, r.q.q5, r.q.q25, r.q.q50, r.q.q75, r.q.q95]));
      }, { quiet: !!pOut.updatedAt });
      outBusy = false;
    }

    // ------------------------------------------------ spreads
    scope.every(5 * 60e3, () => load(pSpread, async () => {
      const since = Date.now() - 7 * 86400000;
      const [cl, b, ho] = await Promise.all([hl.candles("xyz:CL", "1h", since), hl.candles("xyz:BRENTOIL", "1h", since), hl.candles("xyz:HO", "1h", since)]);
      const mCl = new Map(cl.map((c) => [c.t, c.c]));
      const bw = b.filter((c) => mCl.has(c.t)).map((c) => [c.t, c.c - mCl.get(c.t)]);
      const cr = ho.filter((c) => mCl.has(c.t)).map((c) => [c.t, c.c * 42 - mCl.get(c.t)]);
      const ch = await chartIn(pSpread);
      ch.set(tsOption({ series: [{ name: "Brent − WTI", data: bw, color: "--s2" }, { name: "Diesel crack (ULSD×42 − WTI)", data: cr, color: "--s7" }], yFmt: (v) => usd(v, 0), tipFmt: (v) => usd(v, 2) }));
      pSpread.setData([{ label: "Time" }, { label: "Brent−WTI", num: true }], bw.map(([t, v]) => [new Date(t).toISOString(), v]));
    }));

    // ------------------------------------------------ alerts + clock
    const paintAlerts = () => {
      const log = alerts.list();
      mount(pAlerts.body, log.length ? log.slice(0, 30).map((a) => h("div", { class: "alert-item" }, h("span", { class: "sev " + a.sev }), h("div", {}, h("div", {}, a.title), h("div", { class: "muted tiny" }, a.text)), h("span", { class: "when" }, ago(a.ts))))
        : h("div", { class: "note", style: { padding: "10px" } }, "Signals appear here: inventory surprises, big moves in event odds, spread blow-outs, transit jumps and your own price rules (bell icon)."));
    };
    scope.sub("alerts", paintAlerts);
    paintAlerts();
    const paintClock = () => mount(pClock.body, h("table", { class: "tbl" }, h("tbody", {}, eventList(9).map((e) => h("tr", {},
      h("td", {}, h("span", { class: "tag " + (e.kind === "expiry" ? "ac" : e.kind === "politics" ? "hz" : "") }, e.tag)),
      h("td", { class: "wrap" }, e.name),
      h("td", { class: "r nowrap" }, countdown(e.inMs)))))));
    paintClock();
    scope.every(30e3, paintClock, { now: false });
  },
};

// SVG range plot: one row per lens on a shared price axis, current price marked.
function rangePlot(rows, S0) {
  const W = 360, rowH = 40, top = 6, H = top + rows.length * rowH + 22;
  const lo = Math.min(...rows.map((r) => r.q.q5), S0) * 0.97, hi = Math.max(...rows.map((r) => r.q.q95), S0) * 1.03;
  const x = (v) => 108 + ((v - lo) / (hi - lo)) * (W - 118);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.style.maxHeight = "170px";
  const el = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; svg.appendChild(e); return e; };
  const ink2 = cssVar("--ink-2"), ink3 = cssVar("--ink-3"), grid = cssVar("--grid"), accent = cssVar("--accent");
  const cols = [cssVar("--s1"), cssVar("--s2"), cssVar("--s3")];
  const step = niceStep((hi - lo) / 5);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    el("line", { x1: x(v), x2: x(v), y1: top, y2: H - 18, stroke: grid, "stroke-width": 1 });
    el("text", { x: x(v), y: H - 5, "text-anchor": "middle", fill: ink3, "font-size": 10 }, "$" + Math.round(v));
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2;
    el("text", { x: 0, y: y - 2, fill: ink2, "font-size": 11, "font-weight": 600 }, r.name);
    el("text", { x: 0, y: y + 11, fill: ink3, "font-size": 9 }, (r.sub || "").slice(0, 28));
    el("line", { x1: x(r.q.q5), x2: x(r.q.q95), y1: y, y2: y, stroke: cols[i], "stroke-width": 2, "stroke-linecap": "round" });
    el("rect", { x: x(r.q.q25), y: y - 6, width: Math.max(2, x(r.q.q75) - x(r.q.q25)), height: 12, rx: 2, fill: cols[i], opacity: 0.85 });
    el("line", { x1: x(r.q.q50), x2: x(r.q.q50), y1: y - 9, y2: y + 9, stroke: cssVar("--bg-1"), "stroke-width": 2 });
    const title = el("title", {}, `${r.name}: 5% $${r.q.q5.toFixed(1)} · 25% $${r.q.q25.toFixed(1)} · median $${r.q.q50.toFixed(1)} · 75% $${r.q.q75.toFixed(1)} · 95% $${r.q.q95.toFixed(1)}`);
    void title;
  });
  el("line", { x1: x(S0), x2: x(S0), y1: top - 2, y2: H - 18, stroke: accent, "stroke-width": 1.5 });
  el("text", { x: x(S0) + 3, y: top + 8, fill: accent, "font-size": 10 }, "now $" + S0.toFixed(1));
  return svg;
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

const METHOD_LIVE = `<p>Prices are Hyperliquid HIP-3 perpetuals deployed by trade.xyz: <code>xyz:CL</code> (WTI) and <code>xyz:BRENTOIL</code> (Brent). They trade 24/7 and track an oracle built from CME/ICE futures, rolling from the expiring contract to the next one in steps roughly 10 to 5 business days before expiry.</p>
<p>When CME is closed the oracle freezes and the perp trades in a bounded discovery band, which makes the weekend price an early read on the Monday open. Basis is mark over oracle; funding is annualised from the hourly rate.</p>
<p>These are not the official exchange settlements. Use them for direction and timing; check CME/ICE settlements for valuation.</p>`;
const METHOD_HORMUZ = `<p>Transit counts are IMF PortWatch daily crossings of the Strait of Hormuz, derived from AIS by Oxford and the UN Global Platform and published weekly with a lag of about two days; we read them through straits.live, whose computed metrics are CC0.</p>
<p>Throughput is the latest daily count over the pre-crisis median (28 Feb 2025 to 27 Feb 2026). AIS misses ships that sail dark, so other counts (INTERTANKO, CENTCOM) can be higher. The war-risk premium multiple and the stranded-vessel count come from straits.live.</p>`;
const METHOD_RISK = `<p>Each factor is turned into a z-score with the sign set so that a positive value means upward pressure on crude prices, clipped to ±3, and averaged with equal weights.</p>
<ul><li>Hormuz and Bab el-Mandeb: 3 × share of pre-crisis transits missing.</li><li>US crude and distillate stocks: same-week deviation from the 5-year average divided by its standard deviation, sign flipped.</li><li>SPR: level versus its 2018–2025 range, sign flipped.</li><li>Speculators: managed-money net length as % of open interest versus 3 years, sign flipped (crowding is a downside risk).</li><li>Momentum: 21-day log return over 21-day volatility.</li><li>Escalation: straits.live escalation index centred at 50.</li><li>Brent–WTI: (spread − $4) / $2.5.</li></ul>
<p>The weights are deliberately naive. This panel organises the evidence; it is not a fitted model. The forecast lab holds the backtested ones.</p>`;
const METHOD_EIA = `<p>U.S. EIA Weekly Petroleum Status Report through API v2. "vs 5y" compares the latest level with the average of the same ISO week over the five previous years, the convention EIA uses for its range charts. Stock series are coloured red when they fall (bullish) and green when they rise.</p>`;
const METHOD_ODDS = `<p>Probabilities are the last Yes prices on Polymarket. They embed fees, liquidity and the views of a specific crowd, and some markets resolve on narrow definitions (read the market rules). Treat them as a market input, not ground truth.</p>`;
const METHOD_OUTLOOK = `<p><b>Statistical</b>: GARCH(1,1) fitted by maximum likelihood on ~10 years of daily Brent returns (EIA spot, extended with perp returns after the last EIA print), simulated 6,000 times over 21 trading days with standardised residuals resampled from history (filtered historical simulation).</p>
<p><b>Scenarios</b>: a mixture of three lognormal regimes. Weights come from Polymarket (Hormuz reopening term structure, interpolated; "US invades Iran", hazard-scaled to the horizon); targets and volatilities are editable assumptions in the forecast lab.</p>
<p><b>Prediction markets</b>: the median volatility that equates the reflection-principle touch probability to Polymarket's WTI "hit $X" prices, applied to Brent.</p>`;
const METHOD_SPREAD = `<p>Hourly closes of the perps. Brent − WTI measures the premium of waterborne crude over landlocked Cushing barrels (normally $3–5). The diesel crack is NY Harbor ULSD × 42 gallons minus WTI, a proxy for refining margins on middle distillates, which the Gulf disruption hits hardest. The ULSD perp is thin; treat its level with care.</p>`;
