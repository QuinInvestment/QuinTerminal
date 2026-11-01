// HRMZ — the Hormuz war room: transits, status, reopening odds, the supply
// gap, bypass routes, chokepoints, incidents and shipping lines.

import { h, mount } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { sub, get, pub } from "../core/bus.js";
import { tsOption, barOption, catLineOption } from "../core/charts.js";
import { num, int, pct, spct, signed, isNum, shortDay, dayYear, ago, compact } from "../core/fmt.js";
import { settings } from "../core/settings.js";
import * as S from "../core/stats.js";
import * as alerts from "../core/alerts.js";
import * as straits from "../data/straits.js";
import * as poly from "../data/polymarket.js";
import { CHOKEPOINTS, PIPELINES } from "../data/static/infrastructure.js";
import { load, chartIn, stat, ms, table, empty } from "./kit.js";
import { createMap, addReferenceLayers, bindPopups, animateFlows, PLACES } from "./mapkit.js";

export default {
  title: "Hormuz war room",
  sub: "The closure in numbers: ships crossing, ships stuck, what bypasses can carry, what markets price for a reopening, and the incident log.",

  async mount(view, { scope }) {
    const pTransits = panel({ title: "Daily transits through the Strait of Hormuz", span: 8, rows: 8, src: ["straits"], chart: true, lead: true, method: M_TRANSITS });
    const pStatus = panel({ title: "Status", span: 4, rows: 8, src: ["straits"], alarm: true, method: M_STATUS });
    const pOdds = panel({ title: "Market odds of normal traffic, by deadline", span: 4, rows: 6, src: ["poly"], chart: true, method: M_ODDS });
    const pOddsHist = panel({ title: "Odds history", span: 4, rows: 6, src: ["poly"], chart: true });
    const pGap = panel({ title: "Supply gap calculator", span: 4, rows: 6, src: ["straits"], method: M_GAP });
    const pMap = panel({ title: "Strait map", span: 5, rows: 8, src: ["basemap"], flush: true });
    const pBypass = panel({ title: "Bypass routes", span: 7, rows: 4, src: ["straits"], flush: true, method: M_BYPASS });
    const pChoke = panel({ title: "Chokepoint board", span: 7, rows: 4, src: ["straits"], flush: true, method: M_CHOKE });
    const pEvents = panel({ title: "Incident log", span: 6, rows: 7, src: ["straits"], flush: true });
    const pCarriers = panel({ title: "Shipping lines and trade exposure", span: 6, rows: 7, src: ["straits"], flush: true });
    view.appendChild(grid(pTransits, pStatus, pOdds, pOddsHist, pGap, pMap, pBypass, pChoke, pEvents, pCarriers));

    // ------------------------------------------------ transits
    let transits = [];
    scope.every(30 * 60e3, () => load(pTransits, async () => {
      transits = await straits.transits();
      const pre = transits.filter((r) => r.t < "2026-02-28").slice(-365);
      const medPre = S.median(pre.map((r) => r.total));
      const q25 = S.quantile(pre.map((r) => r.total), 0.25), q75 = S.quantile(pre.map((r) => r.total), 0.75);
      const ma = (arr, k) => arr.map((r, i) => [ms(r.t), i >= k - 1 ? S.mean(arr.slice(i - k + 1, i + 1).map((x) => x.total)) : null]).filter((p) => p[1] != null);
      const ch = await chartIn(pTransits);
      const first = ms(transits[0].t), last = ms(transits[transits.length - 1].t);
      ch.set(tsOption({
        series: [
          { name: "All vessels", data: transits.map((r) => [ms(r.t), r.total]), color: "--s1", width: 1, opacity: 0.55 },
          { name: "All vessels, 7-day average", data: ma(transits, 7), color: "--s1", width: 2 },
          { name: "Tankers", data: transits.map((r) => [ms(r.t), r.tanker]), color: "--s2", width: 1.5 },
        ],
        bands: [{ name: "Pre-crisis interquartile range", lower: [[first, q25], [last, q25]], upper: [[first, q75], [last, q75]], color: "--s1", opacity: 0.08 }],
        marks: [{ x: ms("2026-02-28"), label: "28 Feb: strikes, strait closed" }, { y: medPre, label: `pre-crisis median ${int(medPre)}` }],
        yFmt: (v) => num(v, 0), zoom: true,
      }));
      pTransits.setData([{ label: "Date" }, { label: "All vessels", num: true }, { label: "Tankers", num: true }, { label: "Other cargo", num: true }], transits.map((r) => [r.t, r.total, r.tanker, r.cargo]));
      const lastRow = transits[transits.length - 1];
      const prev7 = S.mean(transits.slice(-8, -1).map((r) => r.total));
      if (lastRow.total >= Math.max(10, 2 * prev7)) alerts.raise({ id: "hormuz-jump-" + lastRow.t, sev: "warn", title: `Hormuz transits jumped to ${lastRow.total}`, text: `Versus a 7-day average of ${num(prev7, 1)} (PortWatch, ${lastRow.t}).`, source: "PortWatch" });
    }));

    // ------------------------------------------------ status
    const paintStatus = (d) => {
      if (!d) return;
      const days = Math.floor((Date.now() - Date.parse(settings.crisisStart + "T00:00:00Z")) / 86400000) + 1;
      const t = d.transits;
      mount(pStatus.body,
        h("div", { class: "row", style: { alignItems: "flex-end", gap: "16px", marginBottom: "8px" } },
          h("div", {}, h("div", { style: { fontFamily: "var(--font-stencil)", fontWeight: 800, fontSize: "64px", lineHeight: 0.9, color: "var(--hazard)" } }, String(days)), h("div", { class: "tiny muted" }, `days since ${dayYear(Date.parse(settings.crisisStart))}`)),
          h("div", { style: { flex: 1 } }, h("div", { style: { fontSize: "var(--t-16)", fontWeight: 600 } }, d.verdictShort ? `Open? ${d.verdictShort}.` : "Status"), h("div", { class: "small dim" }, d.verdictText))),
        h("div", { class: "stats" },
          stat("Throughput", isNum(t.throughputPct) ? t.throughputPct + "%" : "—", "of pre-war daily transits", { cls: "hz" }),
          stat("Last PortWatch day", isNum(t.count) ? `${t.count}` : "—", t.asOf ? `${shortDay(ms(t.asOf))}, ${isNum(t.tanker) ? t.tanker + " tankers" : ""}` : ""),
          stat("7-day average", isNum(t.ma7) ? num(t.ma7, 1) : "—", `vs ${t.baseline ?? "—"} before the war`),
          stat("Ships in the Gulf box", isNum(d.aisInZone) ? int(d.aisInZone) : "—", "AIS, moving now"),
          stat("Stranded", isNum(d.stranded) ? int(d.stranded) : "—", isNum(d.strandedOffshore) ? `${int(d.strandedOffshore)} offshore` : ""),
          stat("Dark tankers", d.darkTankers ? int(d.darkTankers.count) : "—", d.darkTankers ? `expected ${num(d.darkTankers.expected, 0)} of ${int(d.darkTankers.eligible)}` : "", { title: "Tankers whose AIS went silent in the window, against the ambient rate. A floor, not a count of evasions." }),
          stat("War-risk premium", isNum(d.insurance.multiple) ? d.insurance.multiple + "× pre-war" : "—", isNum(d.insurance.high) ? `VLCC $${num(d.insurance.low / 1e6, 2)}M to $${num(d.insurance.high / 1e6, 0)}M a voyage` : ""),
          stat("High-risk vessels", d.vesselRisk ? int(d.vesselRisk.high) : "—", d.vesselRisk ? `of ${int(d.vesselRisk.total)} screened in 24h` : ""),
          stat("Iranian rial", d.rial ? `${compact(d.rial.mid / 10, 0)} toman/$` : "—", d.rial ? `${spct(d.rial.d7 / 100, 1)} over 7 days` : "", { title: "Open-market rate; a weaker rial (higher number) signals domestic stress." }),
          stat("US gasoline", isNum(d.gasoline) ? "$" + num(d.gasoline, 2) + "/gal" : "—", "national average")),
        d.insurance.clubs?.length ? h("p", { class: "tiny muted", style: { marginTop: "8px" } }, `P&I clubs that withdrew war cover: ${d.insurance.clubs.join(", ")}.${d.insurance.stale ? " Insurance figures flagged stale by the source." : ""}`) : null,
        d.jwc ? h("p", { class: "tiny muted" }, `Lloyd's Joint War Committee listed areas: circular ${d.jwc.label} (${d.jwc.date}).`) : null,
        h("p", { class: "tiny muted" }, "Source: ", h("a", { href: "https://straits.live", target: "_blank", rel: "noopener" }, "straits.live"), `, ${straits.ATTRIBUTION}.`));
      pStatus.touch();
      pStatus.state("ok");
    };
    scope.sub("straits:digest", paintStatus);
    if (!get("straits:digest")) pStatus.state("loading", "Loading status");

    // ------------------------------------------------ odds
    scope.every(5 * 60e3, () => load(pOdds, async () => {
      const board = get("poly:board") || await poly.board();
      pub("poly:board", board);
      const curve = poly.reopenCurve(board);
      if (!curve.length) { mount(pOdds.body, empty("No open Polymarket market on a Hormuz reopening right now.")); return; }
      const ch = await chartIn(pOdds);
      const cats = curve.map((c) => new Date(c.t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }));
      ch.set(barOption({ cats, values: curve.map((c) => c.p * 100), fmt: (v) => num(v, v < 1 ? 2 : 1) + "%", colorVar: "--s3" }));
      pOdds.setData([{ label: "Deadline" }, { label: "P(normal by deadline)", num: true }, { label: "24h change", num: true }, { label: "Market" }], curve.map((c) => [new Date(c.t).toISOString().slice(0, 10), c.p, c.d1, c.q]));
      if (board.relay) pOdds.setFoot("Polymarket is unreachable from this network: prices relayed by straits.live, no 24-hour change.");
      // history of the latest-dated contract; without Polymarket's API, the Hormuz Index history instead
      const target = curve[curve.length - 1];
      await load(pOddsHist, async () => {
        const ch2 = await chartIn(pOddsHist);
        if (target.token) {
          const hist = await poly.history(target.token, { fidelity: 720 });
          pOddsHist.setTitle(`Odds history: normal by ${cats[cats.length - 1]}`);
          ch2.set(tsOption({ series: [{ name: "Probability", data: hist.map((x) => [x.t, x.p * 100]), color: "--s3", area: 0.1 }], yFmt: (v) => num(v, 0) + "%", yMin: 0, yMax: 100, yScale: false, legend: false }));
          pOddsHist.setData([{ label: "Time" }, { label: "Probability", num: true }], hist.map((x) => [new Date(x.t).toISOString(), x.p]));
          return;
        }
        const rows = (await straits.indexDaily()).filter((r) => r.date && r.crisis_close !== "");
        pOddsHist.setTitle("Hormuz Index: crisis pressure and escalation forecast");
        ch2.set(tsOption({
          series: [
            { name: "Crisis pressure (0–100)", data: rows.map((r) => [Date.parse(r.date + "T00:00:00Z"), +r.crisis_close]), color: "--hazard" },
            { name: "Escalation forecast (0–100)", data: rows.filter((r) => r.forecast_close !== "").map((r) => [Date.parse(r.date + "T00:00:00Z"), +r.forecast_close]), color: "--s4" },
          ],
          yFmt: (v) => num(v, 0), yMin: 0, yMax: 100, yScale: false,
        }));
        const mUrl = get("straits:digest")?.index?.url;
        pOddsHist.setFoot([h("span", {}, "straits.live composite indices (CC0), daily closes. Shown because Polymarket's history API is unreachable from this network."), mUrl ? h("a", { href: mUrl, target: "_blank", rel: "noopener noreferrer" }, "Methodology") : null]);
        pOddsHist.setData([{ label: "Date" }, { label: "Crisis pressure", num: true }, { label: "Escalation forecast", num: true }], rows.map((r) => [r.date, +r.crisis_close, r.forecast_close === "" ? "" : +r.forecast_close]));
      });
    }));

    // ------------------------------------------------ supply gap
    const gapState = { crossing: 4.9, release: 1.5, demand: 2.0, spare: 0.5, bypass: null };
    const paintGap = () => {
      const d = get("straits:digest");
      const bp = d?.bypass || [];
      const ew = bp.find((b) => /petroline|east-west/i.test(b.id + b.name));
      const ad = bp.find((b) => /adcop|habshan|fujairah/i.test(b.id + b.name));
      const gj = bp.find((b) => /goreh|jask/i.test(b.id + b.name));
      // pre-war use of the bypasses (approximate): East-West ~2.5 mb/d, ADCOP ~0.8 mb/d
      const ewNow = ew && isNum(ew.capacity) && isNum(ew.util) ? (ew.capacity * ew.util) / 100 / 1e6 : 5.8;
      const adNow = ad && isNum(ad.capacity) && isNum(ad.util) ? (ad.capacity * ad.util) / 100 / 1e6 : 1.4;
      const gjNow = gj && isNum(gj.capacity) && isNum(gj.util) ? (gj.capacity * gj.util) / 100 / 1e6 : 0.2;
      const extraBypass = gapState.bypass ?? Math.max(0, ewNow - 2.5) + Math.max(0, adNow - 0.8) + gjNow;
      const pre = 20.9;
      const loss = Math.max(0, pre - gapState.crossing - extraBypass);
      const offsets = gapState.release + gapState.demand + gapState.spare;
      const residual = loss - offsets;
      const world = 104;
      const lo = residual / world / 0.1, hi = residual / world / 0.05;
      const slider = (label, key, min, max, step, hint) => {
        const out = h("span", { class: "num ac" }, num(key === "bypass" ? extraBypass : gapState[key], 1) + " mb/d");
        const inp = h("input", { type: "range", min, max, step, value: key === "bypass" ? extraBypass : gapState[key], "aria-label": label, oninput: (e) => { gapState[key] = +e.target.value; paintGap(); } });
        return h("div", { style: { marginBottom: "4px" } }, h("div", { class: "row", style: { justifyContent: "space-between" } }, h("span", { class: "small", title: hint }, label), out), inp);
      };
      mount(pGap.body,
        slider("Oil still crossing the strait", "crossing", 0, 21, 0.1, "EIA put 2Q 2026 flows at 4.9 mb/d (Vortexa)."),
        slider("Extra flow via bypass pipelines", "bypass", 0, 8, 0.1, "Above pre-war use. Default from straits.live utilisation data."),
        slider("Emergency stock draws (IEA, SPR)", "release", 0, 5, 0.1, ""),
        slider("Demand destruction", "demand", 0, 6, 0.1, ""),
        slider("Spare capacity outside the Gulf", "spare", 0, 3, 0.1, "Most OPEC+ spare capacity sits behind Hormuz."),
        h("div", { class: "kv", style: { marginTop: "6px" } },
          h("dt", {}, "Seaborne supply lost"), h("dd", { class: "hz" }, num(loss, 1) + " mb/d"),
          h("dt", {}, "Offsets"), h("dd", {}, num(offsets, 1) + " mb/d"),
          h("dt", {}, residual >= 0 ? "Uncovered shortfall" : "Surplus after offsets"), h("dd", { class: residual > 0 ? "hz" : "up" }, num(Math.abs(residual), 1) + " mb/d"),
          h("dt", {}, "Stock draw per month"), h("dd", {}, residual > 0 ? num(residual * 30, 0) + " mb" : "—"),
          h("dt", { title: "Short-run price elasticity of demand between −0.05 and −0.10" }, "Implied price pressure"), h("dd", {}, residual > 0 ? `+${num(lo * 100, 0)}% to +${num(hi * 100, 0)}%` : `${num(hi * 100, 0)}% to ${num(lo * 100, 0)}%`)),
        h("p", { class: "tiny muted", style: { marginTop: "6px" } }, "Static balance, not a forecast: prices also ration demand, so the realised move is smaller than a fixed elasticity suggests."));
    };
    scope.sub("straits:digest", paintGap);
    paintGap();

    // ------------------------------------------------ map
    try {
      const box = h("div", { class: "map-wrap" });
      pMap.body.appendChild(box);
      const H = await createMap(box, { ...PLACES.HORMUZ, globe: false, center: [55.2, 26.0], zoom: 5.3 });
      scope.add(() => H.dispose());
      addReferenceLayers(H, { routes: true, crisis: true });
      bindPopups(H);
      animateFlows(H);
      pMap.touch();
    } catch (e) {
      pMap.state("error", "Map unavailable", e.message);
    }

    // ------------------------------------------------ bypass + chokepoints
    const paintBypass = (d) => {
      const live = d?.bypass || [];
      const rows = PIPELINES.filter((p) => p.bypass).map((p) => {
        const m = live.find((b) => (b.id + b.name).toLowerCase().includes(p.id === "eastwest" ? "petroline" : p.id === "adcop" ? "adcop" : p.id === "gorehjask" ? "jask" : "kirkuk")) || live.find((b) => b.name && p.name.toLowerCase().split(" ")[0] && b.name.toLowerCase().includes(p.name.toLowerCase().split(" ")[0]));
        const cap = m && isNum(m.capacity) ? m.capacity / 1000 : p.cap;
        return { name: p.name, cap, util: m?.util, status: m?.status || p.status, term: m?.terminus || "", src: m?.source || "Reference data", asOf: m?.asOf || "", note: m?.notes || p.note };
      });
      mount(pBypass.body, table([
        { label: "Pipeline", get: (r) => r.name },
        { label: "Capacity", r: true, get: (r) => num(r.cap / 1000, 1) + " mb/d" },
        { label: "Utilisation", r: true, get: (r) => (isNum(r.util) ? r.util + "%" : "—") },
        { label: "Flow", r: true, get: (r) => (isNum(r.util) ? num((r.cap * r.util) / 100 / 1000, 1) + " mb/d" : "—") },
        { label: "Status", get: (r) => h("span", { class: "tag " + (r.status === "open" ? "ok" : r.status === "partial" ? "warn" : "") }, r.status) },
        { label: "Outlet", get: (r) => r.term },
        { label: "As of", get: (r) => r.asOf || "—" },
      ], rows));
      pBypass.setData([{ label: "Pipeline" }, { label: "Capacity kb/d", num: true }, { label: "Utilisation %", num: true }, { label: "Status" }, { label: "Source" }], rows.map((r) => [r.name, r.cap, r.util, r.status, r.src]));
      pBypass.touch();
      const liveCp = d?.chokepoints || [];
      const crow = CHOKEPOINTS.map((c) => {
        const l = liveCp.find((x) => (x.key + x.label).toLowerCase().includes(c.id === "bab" ? "mandeb" : c.id));
        return { ...c, live: l };
      });
      mount(pChoke.body, table([
        { label: "Chokepoint", get: (r) => r.name },
        { label: "1H 2025", r: true, get: (r) => num(r.pre, 1) + " mb/d" },
        { label: "2Q 2026", r: true, get: (r) => num(r.now, 1) + " mb/d" },
        { label: "Change", r: true, cls: (r) => (r.now < r.pre ? "down" : "up"), get: (r) => spct(r.now / r.pre - 1, 0) },
        { label: "Ships last day", r: true, get: (r) => (r.live && isNum(r.live.n) ? `${r.live.n} / ${isNum(r.live.base) ? r.live.base : "—"}` : "—") },
        { label: "Status", get: (r) => h("span", { class: "tag " + (r.status === "closed" ? "hz" : r.status === "contested" ? "warn" : "ok") }, r.status) },
      ], crow));
      pChoke.setData([{ label: "Chokepoint" }, { label: "1H 2025 mb/d", num: true }, { label: "2Q 2026 mb/d", num: true }, { label: "Status" }], crow.map((r) => [r.name, r.pre, r.now, r.status]));
      pChoke.touch();
    };
    scope.sub("straits:digest", paintBypass);

    // ------------------------------------------------ incidents
    scope.every(5 * 60e3, () => load(pEvents, async () => {
      const rows = await straits.events();
      const d = get("straits:digest");
      const items = rows.map((r) => ({ title: r.title || r.headline, url: r.url || r.source_url || r.sourceUrl || "", type: r.type || r.event_type || "", src: r.source_name || r.source || "", t: Date.parse(r.occurredAt || r.occurred_at || r.date || r.time || "") }))
        .concat((d?.events || []).map((e) => ({ title: e.title, url: "", type: e.type, src: "straits.live", t: Date.parse(e.at) })))
        .filter((x) => x.title).sort((a, b) => (b.t || 0) - (a.t || 0));
      const seen = new Set();
      const uniq = items.filter((x) => { const k = x.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; });
      mount(pEvents.body, h("div", { class: "feed" }, uniq.slice(0, 60).map((x) => h("div", { class: "feed-item" },
        h("div", { class: "t" }, isNum(x.t) ? ago(x.t) : ""),
        h("div", {}, h("div", { class: "h" }, x.url ? h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer" }, x.title) : x.title),
          h("div", { class: "m" }, x.type ? h("span", { class: "tag " + (/strike|attack|incident|mine|closure/i.test(x.type) ? "hz" : /negotiat|talk|deal/i.test(x.type) ? "ok" : "") }, x.type.replace(/_/g, " ")) : null, x.src))))));
      pEvents.setData([{ label: "Time" }, { label: "Type" }, { label: "Headline" }, { label: "Link" }], uniq.map((x) => [isNum(x.t) ? new Date(x.t).toISOString() : "", x.type, x.title, x.url]));
    }));

    // ------------------------------------------------ carriers and trade exposure
    const paintCarriers = (d) => {
      if (!d) return;
      mount(pCarriers.body,
        d.trade ? h("div", { class: "stats", style: { padding: "10px" } },
          stat("World oil at risk", isNum(d.trade.oilAtRisk) ? d.trade.oilAtRisk + "%" : "—", "share of seaborne trade"),
          stat("World LNG at risk", isNum(d.trade.lngAtRisk) ? d.trade.lngAtRisk + "%" : "—", "Qatar and UAE"),
          stat("Extra voyage time", isNum(d.trade.extraDays) ? d.trade.extraDays + " days" : "—", "Cape routing"),
          stat("Most exposed", (d.trade.countries || []).slice(0, 3).join(", ") || "—", "importers")) : null,
        d.carriers?.length ? table([
          { label: "Line", get: (r) => r.carrier },
          { label: "Status", get: (r) => h("span", { class: "tag " + (r.status === "rerouting" ? "warn" : r.status === "suspended" ? "hz" : "") }, r.status || "—") },
          { label: "Hormuz", get: (r) => r.posture || "—" },
          { label: "Since", get: (r) => (r.since ? shortDay(Date.parse(r.since)) : "—") },
          { label: "Notes", get: (r) => h("span", { class: "tiny muted" }, (r.notes || "").slice(0, 90)) },
        ], d.carriers) : empty("No carrier data."));
      pCarriers.touch();
    };
    scope.sub("straits:digest", paintCarriers);
  },
};

const M_TRANSITS = `<p>IMF PortWatch counts every vessel that crosses the strait, from AIS positions processed by Oxford and the UN Global Platform. The series is published weekly with about a two-day lag, so the last point is often a Sunday, the quietest day of the week.</p><p>Ships that switch off AIS are missed, which is why counts from INTERTANKO or US Central Command (escorted convoys) can be higher. The shaded band is the interquartile range of the year before the war.</p>`;
const M_STATUS = `<p>Day count starts on the date set in Settings (default 28 Feb 2026, the US–Israeli strikes after which Iran closed the strait). Other figures come from straits.live, which aggregates PortWatch, its own AIS feed, curated insurance and carrier sources, and an Iranian open-market FX feed. Figures flagged stale by the source are labelled as such.</p>`;
const M_ODDS = `<p>Each bar is the Yes price of a Polymarket market "Strait of Hormuz traffic returns to normal by <date>". Read together they form a term structure of reopening probabilities; the gaps between bars give the market-implied chance of a reopening in each window. Market definitions of "normal" are narrow: check the rules.</p>`;
const M_GAP = `<p>A static flow balance: pre-war Hormuz oil flow (20.9 mb/d, EIA 1H 2025) minus oil still crossing, minus extra bypass pipeline flow above pre-war use (East-West about 2.5 mb/d, ADCOP about 0.8 mb/d before the war), gives the seaborne loss. Emergency stock draws, demand destruction and spare capacity outside the Gulf offset it.</p><p>The price range divides the uncovered shortfall by world demand (~104 mb/d) and by a short-run price elasticity of −0.05 to −0.10. It is an order-of-magnitude check, not a model of how prices clear.</p>`;
const M_BYPASS = `<p>Capacities are nameplate. Live utilisation, status and outlet come from straits.live's curated pipeline table where available (sources cited there, for example the Saudi energy minister for the East-West line); otherwise reference values are shown.</p>`;
const M_CHOKE = `<p>Oil flows from the EIA: 1H 2025 (World Oil Transit Chokepoints) and 2Q 2026 (August 2026 STEO, Vortexa tanker tracking). "Ships last day" is the latest PortWatch count against the pre-crisis median, when straits.live tracks that chokepoint.</p>`;
