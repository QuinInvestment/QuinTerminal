// RISK — geopolitical event risk: prediction-market probabilities and their
// history, barrier markets against the volatility model, public attention
// (Wikipedia) and news intensity (GDELT), rolled into a regional matrix.

import { h, mount, sparkline, cssVar } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { get, pub } from "../core/bus.js";
import { tsOption, barOption } from "../core/charts.js";
import { num, int, pct, spct, signed, isNum, shortDay, compact, dirClass, dayYear } from "../core/fmt.js";
import * as S from "../core/stats.js";
import * as poly from "../data/polymarket.js";
import * as wiki from "../data/wiki.js";
import * as gdelt from "../data/gdelt.js";
import * as model from "../data/model.js";
import { load, chartIn, table, empty, seg } from "./kit.js";

const CATS = [
  { id: "all", label: "All" },
  { id: "hormuz", label: "Hormuz", re: /hormuz/i },
  { id: "iran", label: "US–Iran", re: /iran|khamenei|tehran/i },
  { id: "redsea", label: "Red Sea", re: /houthi|red sea|bab el|yemen/i },
  { id: "price", label: "Oil price", re: /wti|brent|crude|oil price|all.time high|reserves/i },
  { id: "opec", label: "OPEC & Gulf", re: /opec|saudi|uae|qatar|kuwait|iraq/i },
];

export default {
  title: "Event risk",
  sub: "What prediction markets price, how those odds moved, where public attention and news coverage are spiking, region by region.",

  async mount(view, { scope, tools, arg }) {
    const st = { q: String(arg || "").trim(), cat: "all", sel: null };
    const search = h("input", { class: "in", type: "search", placeholder: "Filter markets", value: st.q, style: { width: "200px" }, oninput: (e) => { st.q = e.target.value; paintBoard(); } });
    mount(tools, search, seg(CATS.map((c) => ({ label: c.label, value: c.id })), st.cat, (v) => { st.cat = v; paintBoard(); }));

    const pBoard = panel({ title: "Event markets", span: 7, rows: 9, src: ["poly"], flush: true, lead: true, method: M_BOARD });
    const pHist = panel({ title: "Probability history", span: 5, rows: 5, src: ["poly"], chart: true });
    const pBarrier = panel({ title: "WTI barrier markets vs the volatility model", span: 5, rows: 4, src: ["poly", "eia"], flush: true, method: M_BARRIER });
    const pAttn = panel({ title: "Public attention (Wikipedia pageviews)", span: 6, rows: 8, src: ["wiki"], flush: true, method: M_ATTN });
    const pNews = panel({ title: "News coverage intensity by theme (GDELT)", span: 6, rows: 8, src: ["gdelt"], chart: true, method: M_GDELT });
    const pMatrix = panel({ title: "Regional risk matrix", span: 12, rows: 5, src: ["poly", "wiki", "gdelt", "straits"], flush: true, method: M_MATRIX });
    view.appendChild(grid(pBoard, pHist, pBarrier, pAttn, pNews, pMatrix));

    let board = get("poly:board") || null;
    const allMarkets = () => (board || []).flatMap((e) => e.markets.map((m) => ({ ...m, evTitle: e.title, evVol: e.vol })));

    function paintBoard() {
      if (!board) return;
      const cat = CATS.find((c) => c.id === st.cat);
      const q = st.q.toLowerCase();
      const rows = allMarkets()
        .filter((m) => !cat.re || cat.re.test(m.q + " " + m.evTitle))
        .filter((m) => !q || (m.q + " " + m.evTitle).toLowerCase().includes(q))
        .sort((a, b) => (b.vol || 0) - (a.vol || 0)).slice(0, 150);
      if (!rows.length) { mount(pBoard.body, empty("No open market matches. Try another word.")); return; }
      mount(pBoard.body, table([
        { label: "Market", get: (m) => h("span", { title: m.evTitle }, m.q) },
        { label: "Yes", r: true, get: (m) => h("b", {}, pct(m.p, m.p < 0.1 ? 1 : 0)) },
        { label: "24h", r: true, cls: (m) => dirClass(m.d1), get: (m) => (isNum(m.d1) ? signed(m.d1 * 100, 1) : "—") },
        { label: "7d", r: true, cls: (m) => dirClass(m.d7), get: (m) => (isNum(m.d7) ? signed(m.d7 * 100, 1) : "—") },
        { label: "Volume", r: true, get: (m) => "$" + compact(m.vol) },
        { label: "Ends", r: true, get: (m) => (m.end ? shortDay(Date.parse(m.end)) : "—") },
      ], rows, { onRow: (m) => { st.sel = m; drawHist(); }, selected: rows.findIndex((r) => st.sel && r.id === st.sel.id) }));
      pBoard.setData([{ label: "Market" }, { label: "Yes", num: true }, { label: "24h change", num: true }, { label: "7d change", num: true }, { label: "Volume", num: true }, { label: "Ends" }, { label: "URL" }], rows.map((m) => [m.q, m.p, m.d1, m.d7, m.vol, m.end, m.url]));
      if (!st.sel) { st.sel = rows[0]; drawHist(); }
    }

    async function drawHist() {
      const m = st.sel;
      if (!m) return;
      pHist.setTitle("History: " + m.q);
      await load(pHist, async () => {
        const venue = m.venue === "kalshi" ? "Kalshi" : "Polymarket";
        const link = m.url ? h("a", { href: m.url, target: "_blank", rel: "noopener noreferrer" }, "Open on " + venue) : null;
        if (!m.token) {
          if (pHist._chart) { pHist._chart.dispose(); pHist._chart = null; }
          mount(pHist.body, empty(`Probability history needs Polymarket's own API, which this network cannot reach. Current price ${pct(m.p, 1)}, relayed by straits.live.`));
          pHist.setFoot(link ? [link] : "");
          return;
        }
        const hist = await poly.history(m.token, { fidelity: 360 });
        const ch = await chartIn(pHist);
        ch.set(tsOption({ series: [{ name: "Yes probability", data: hist.map((x) => [x.t, x.p * 100]), color: "--s1", area: 0.1 }], yFmt: (v) => num(v, 0) + "%", yMin: 0, yMax: 100, yScale: false, legend: false }));
        pHist.setFoot(link ? [link, h("span", {}, `volume $${compact(m.vol)}, liquidity $${compact(m.liq)}`)] : "");
        pHist.setData([{ label: "Time" }, { label: "Probability", num: true }], hist.map((x) => [new Date(x.t).toISOString(), x.p]));
      });
    }

    scope.every(5 * 60e3, () => load(pBoard, async () => {
      board = await poly.board();
      pub("poly:board", board);
      paintBoard();
      paintBarrier();
      paintMatrix();
    }));

    async function paintBarrier() {
      await load(pBarrier, async () => {
        const lad = poly.barrierLadders(board || []);
        if (!lad.length) { mount(pBarrier.body, empty("No live WTI barrier markets.")); return; }
        const S0 = get("tape")?.rows?.WTI?.px;
        const { g } = await model.garch("WTI");
        const now = Date.now(), Y = 365 * 86400000;
        const rows = lad.filter((l) => (l.dir === "HIGH" ? l.K > S0 : l.K < S0)).map((l) => {
          const t1 = Math.max(0, (l.start - now) / Y), t2 = Math.max(1 / 365, (l.end - now) / Y);
          const vol = S.garchHorizonVol(g, Math.max(1, Math.round(t2 * 252)));
          const mp = S.touchProbWindow(S0, l.K, t1, t2, vol);
          return { ...l, model: mp, iv: S.impliedVolFromTouch(l.p, S0, l.K, t1, t2) };
        });
        mount(pBarrier.body, table([
          { label: "Market", get: (l) => `${l.dir === "HIGH" ? "Hits" : "Falls to"} $${l.K}, ${l.window} to ${shortDay(l.end)}` },
          { label: "Market", r: true, get: (l) => pct(l.p, 1) },
          { label: "Model", r: true, title: "Reflection-principle touch probability with GARCH volatility", get: (l) => pct(l.model, 1) },
          { label: "Implied vol", r: true, get: (l) => (isNum(l.iv) ? pct(l.iv, 0) : "—") },
        ], rows));
        pBarrier.setData([{ label: "Direction" }, { label: "Level", num: true }, { label: "Market p", num: true }, { label: "Model p", num: true }, { label: "Implied vol", num: true }], rows.map((l) => [l.dir, l.K, l.p, l.model, l.iv]));
      }, { quiet: true });
    }

    // ------------------------------------------------ attention
    let attention = [];
    scope.every(3 * 3600e3, () => load(pAttn, async () => {
      attention = await wiki.all();
      attention.sort((a, b) => (b.stats?.z ?? -9) - (a.stats?.z ?? -9));
      mount(pAttn.body, table([
        { label: "Article", get: (a) => a.label },
        { label: "Region", get: (a) => h("span", { class: "muted" }, a.region) },
        { label: "150 days", get: (a) => sparkline(a.series.map((p) => p.v), { width: 120, height: 18, color: cssVar(a.stats?.z > 1.5 ? "--hazard" : "--s1"), fill: true }) },
        { label: "Views/day, 7d", r: true, get: (a) => int(a.stats?.last7) },
        { label: "vs 90d", r: true, get: (a) => (isNum(a.stats?.ratio) ? num(a.stats.ratio, 1) + "×" : "—") },
        { label: "z", r: true, cls: (a) => (a.stats?.z > 1.5 ? "hz" : ""), get: (a) => signed(a.stats?.z, 1) },
      ], attention));
      pAttn.setData([{ label: "Article" }, { label: "7d avg views", num: true }, { label: "Ratio vs 90d", num: true }, { label: "z", num: true }], attention.map((a) => [a.label, a.stats?.last7, a.stats?.ratio, a.stats?.z]));
      paintMatrix();
    }));

    // ------------------------------------------------ GDELT
    // Themes arrive one by one (GDELT allows one call every ~5 s), so the chart
    // is redrawn as each lands. Days are UTC; today's partial day is dropped.
    let themes = [];
    const THEME_COLORS = { hormuz: "--s1", redsea: "--s2", russia: "--s3", opec: "--s4", spr: "--s7" };
    const daily = (s) => {
      const m = new Map();
      for (const p of s) { const d = new Date(p.t).toISOString().slice(0, 10); m.set(d, (m.get(d) || 0) + p.v); }
      const today = new Date().toISOString().slice(0, 10);
      return [...m.entries()].filter(([d]) => d !== today).sort().map(([d, v]) => [Date.parse(d), v]);
    };
    scope.every(60 * 60e3, () => load(pNews, async () => {
      const out = [];
      for (const t of gdelt.THEMES) {
        if (scope.disposed) return;
        try { const s = await gdelt.timeline(t.q, { timespan: "3m" }); out.push({ ...t, d: daily(s) }); } catch (e) { out.push({ ...t, d: [], err: e.message }); }
        if (out.length === 1 && !out[0].d.length) break; // GDELT down: don't queue four more slow calls
        themes = out.filter((x) => x.d.length);
        if (themes.length && !scope.disposed) {
          const ch = await chartIn(pNews);
          ch.set(tsOption({ series: themes.map((x) => ({ name: x.label, data: x.d, color: THEME_COLORS[x.id], width: 1.5 })), yFmt: (v) => compact(v, 0), tipFmt: (v) => int(v) + " articles" }));
          pNews.state("ok");
          pNews.setFoot(`Matching articles per UTC day across GDELT's monitored sources. ${themes.length} of ${gdelt.THEMES.length} themes loaded${themes.length < gdelt.THEMES.length ? ", more arriving" : ""}.`);
          pNews.setData([{ label: "Theme" }, { label: "Day" }, { label: "Articles", num: true }], themes.flatMap((x) => x.d.map(([t, v]) => [x.label, new Date(t).toISOString().slice(0, 10), v])));
          paintMatrix();
        }
      }
      if (!themes.length) throw new Error("GDELT did not respond (it often times out; the edge proxy helps)");
      const failed = out.filter((x) => !x.d.length).map((x) => x.label);
      pNews.setFoot(`Matching articles per UTC day across GDELT's monitored sources.${failed.length ? ` GDELT did not answer for: ${failed.join(", ")}.` : ""}`);
    }));

    // ------------------------------------------------ matrix
    function paintMatrix() {
      const d = get("straits:digest");
      const zOf = (re) => { const xs = attention.filter((a) => re.test(a.label + " " + a.region)).map((a) => a.stats?.z).filter(isNum); return xs.length ? Math.max(...xs) : NaN; };
      // 7-day mean of daily article counts against the earlier daily distribution
      const newsZ = (id) => {
        const t = themes.find((x) => x.id === id);
        if (!t || t.d.length < 30) return NaN;
        const v = t.d.map((p) => p[1]);
        const recent = S.mean(v.slice(-7)), base = v.slice(0, -7);
        return (recent - S.mean(base)) / (S.std(base) || 1);
      };
      const mk = (re) => { const xs = allMarkets().filter((m) => re.test(m.q)).sort((a, b) => (b.vol || 0) - (a.vol || 0)); return xs[0] || null; };
      const cp = (key) => d?.chokepoints?.find((c) => (c.key + c.label).toLowerCase().includes(key));
      const rows = [
        { region: "Gulf / Hormuz", attn: zOf(/hormuz|kharg|tanura|fujairah|irgc|gulf/i), news: newsZ("hormuz"), market: mk(/hormuz.*normal by december|invade iran/i), phys: d?.transits?.throughputPct != null ? 1 - d.transits.throughputPct / 100 : NaN, physLabel: "transit loss" },
        { region: "Red Sea / Bab el-Mandeb", attn: zOf(/bab|houthi|suez|yanbu|red sea/i), news: newsZ("redsea"), market: mk(/bab el-mandeb|houthi/i), phys: (() => { const c = cp("mandeb"); return c && c.base ? Math.max(0, 1 - c.n / c.base) : NaN; })(), physLabel: "transit loss" },
        { region: "Russia / Black Sea / Baltic", attn: NaN, news: newsZ("russia"), market: mk(/russia|ukraine/i), phys: NaN, physLabel: "" },
        { region: "OPEC+ policy", attn: zOf(/opec/i), news: newsZ("opec"), market: mk(/opec/i), phys: NaN, physLabel: "" },
        { region: "Stock releases", attn: zOf(/spr/i), news: newsZ("spr"), market: mk(/reserves|petroleum reserve/i), phys: NaN, physLabel: "" },
      ];
      const cell = (z) => {
        if (!isNum(z)) return h("span", { class: "muted" }, "—");
        const cls = z > 2 ? "tag crit" : z > 1 ? "tag warn" : z < -1 ? "tag ok" : "tag";
        return h("span", { class: cls }, signed(z, 1) + "σ");
      };
      mount(pMatrix.body, table([
        { label: "Region / theme", get: (r) => r.region },
        { label: "Attention", r: true, title: "Wikipedia pageviews, 7 days vs 90 days (z)", get: (r) => cell(r.attn) },
        { label: "News intensity", r: true, title: "GDELT coverage, last week vs prior 3 months (z)", get: (r) => cell(r.news) },
        { label: "Physical disruption", r: true, get: (r) => (isNum(r.phys) ? h("span", { class: r.phys > 0.5 ? "tag crit" : r.phys > 0.2 ? "tag warn" : "tag" }, pct(r.phys, 0) + " " + r.physLabel) : h("span", { class: "muted" }, "—")) },
        { label: "Lead market", get: (r) => (r.market ? h("span", {}, h("b", {}, pct(r.market.p, 0)), " ", h("span", { class: "muted small" }, r.market.q.slice(0, 70))) : h("span", { class: "muted" }, "—")) },
      ], rows));
      pMatrix.touch();
    }
    paintMatrix();
  },
};

const M_BOARD = `<p>Open Polymarket markets whose titles mention oil, crude, OPEC, Iran, Hormuz, the Red Sea or the Houthis, merged from several searches and sorted by traded volume. Click a row to chart its history (CLOB price history). Prices are probabilities of Yes after fees and spread; thin markets move on small trades.</p>`;
const M_BARRIER = `<p>For each live "WTI hits $X" market, the model column is the probability that a driftless futures price with GARCH volatility touches the level within the market's window (reflection principle, integrated over the price at the window start). The implied-vol column inverts the same formula to match the market price. A market price well above the model means the crowd prices fatter tails than recent volatility implies.</p>`;
const M_ATTN = `<p>Daily English Wikipedia views by human readers (Wikimedia REST API). z compares the mean of log views over the last 7 days with the 90 days before. Attention spikes accompany escalation; they are a sentiment gauge, not a price signal on their own.</p>`;
const M_GDELT = `<p>GDELT DOC 2.0 timelines (mode timelinevolraw): the raw number of matching articles, summed per UTC day, over three months; today's partial day is left out. Queries are listed in js/data/gdelt.js. GDELT allows one request every five seconds, so the five themes arrive over about half a minute; results are cached for an hour.</p><p>The matrix's news-intensity z compares the last 7 days' mean with the mean and standard deviation of the earlier daily counts. Coverage volume measures attention, not direction.</p>`;
const M_MATRIX = `<p>One row per risk theme. Attention and news intensity are z-scores against each series' own recent history; physical disruption is the share of pre-crisis transits missing where a transit count exists; the lead market is the highest-volume related Polymarket contract. Colours: amber above 1σ, red above 2σ.</p>`;
