// NEWS — one wire from the Hormuz incident feed, GDELT and (with the edge
// proxy) specialist RSS, tagged by topic, region and supply-risk sign.

import { h, mount } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { pub } from "../core/bus.js";
import { barOption } from "../core/charts.js";
import { num, int, ago, signed, isNum } from "../core/fmt.js";
import { proxyOn } from "../core/settings.js";
import * as news from "../data/news.js";
import * as gdelt from "../data/gdelt.js";
import { load, chartIn, empty } from "./kit.js";

const TAGS = ["Supply risk", "Supply relief", "Shipping", "Policy", "Inventories", "Demand"];

export default {
  title: "News wire",
  sub: "Incidents, policy and market news in one stream, tagged so the pattern shows: what is pushing supply risk up or down, and where.",

  async mount(view, { scope, tools, arg }) {
    const st = { q: String(arg || ""), region: "all", tag: "all", items: [] };
    const input = h("input", { class: "in", type: "search", placeholder: "Search headlines", title: "Filters the wire as you type; Enter also searches GDELT for the last 7 days", value: st.q, style: { width: "220px" },
      oninput: (e) => { st.q = e.target.value; paint(); },
      onkeydown: (e) => { if (e.key === "Enter" && st.q.trim()) searchGdelt(st.q.trim()); } });
    const regionSel = h("select", { class: "in", onchange: (e) => { st.region = e.target.value; paint(); } }, h("option", { value: "all" }, "All regions"), news.REGION_LIST.map((r) => h("option", { value: r.id }, r.label)));
    const tagSel = h("select", { class: "in", onchange: (e) => { st.tag = e.target.value; paint(); } }, h("option", { value: "all" }, "All topics"), TAGS.map((t) => h("option", { value: t }, t)));
    mount(tools, input, regionSel, tagSel);

    const pWire = panel({ title: "Wire", span: 8, rows: 15, src: ["straits", "gdelt", "rss"], flush: true, lead: true, method: M_WIRE });
    const pPress = panel({ title: "Headline pressure, last 24 hours", span: 4, rows: 4, method: M_PRESS });
    const pTags = panel({ title: "Topics, last 48 hours", span: 4, rows: 4, chart: true });
    const pRegions = panel({ title: "Regions, last 48 hours", span: 4, rows: 4, chart: true });
    const pFeeds = panel({ title: "Feeds", span: 4, rows: 3, flush: true });
    view.appendChild(grid(pWire, pPress, pTags, pRegions, pFeeds));

    function paint() {
      const q = st.q.toLowerCase();
      const list = st.items.filter((i) => (st.region === "all" || i.region === st.region) && (st.tag === "all" || i.tags.includes(st.tag)) && (!q || i.title.toLowerCase().includes(q)));
      mount(pWire.body, list.length ? h("div", { class: "feed" }, list.slice(0, 250).map((i) => h("div", { class: "feed-item" },
        h("div", { class: "t" }, ago(i.t)),
        h("div", {},
          h("div", { class: "h" }, i.url ? h("a", { href: i.url, target: "_blank", rel: "noopener noreferrer" }, i.title) : i.title),
          h("div", { class: "m" },
            i.score > 0 ? h("span", { class: "tag hz", title: "Supply-risk words" }, "Supply risk up") : i.score < 0 ? h("span", { class: "tag ok", title: "Supply-relief words" }, "Supply risk down") : null,
            i.tags.filter((t) => !/^Supply/.test(t)).map((t) => h("span", { class: "tag" }, t)),
            i.regionLabel !== "Other" ? h("span", {}, i.regionLabel) : null,
            h("span", {}, i.src)))))) : empty("No headlines match. Clear the filters, or press Enter to search GDELT."));
      pWire.setData([{ label: "Time" }, { label: "Source" }, { label: "Headline" }, { label: "Tags" }, { label: "Region" }, { label: "Score", num: true }, { label: "URL" }], list.map((i) => [new Date(i.t).toISOString(), i.src, i.title, i.tags.join("; "), i.regionLabel, i.score, i.url]));
    }

    async function searchGdelt(q) {
      await load(pWire, async () => {
        const rows = await gdelt.articles(q, { timespan: "7d", max: 75 });
        const extra = rows.map((r) => ({ ...r, ...news.classify(r.title), fromSearch: true }));
        const seen = new Set(st.items.map((i) => i.url));
        st.items = [...extra.filter((x) => !seen.has(x.url)), ...st.items].sort((a, b) => b.t - a.t);
        paint();
      });
    }

    // Sources land at different speeds (GDELT is paced to one call every ~5 s),
    // so everything below redraws on each partial result.
    async function render({ items, sources }, final) {
      if (scope.disposed) return;
      const extra = st.items.filter((i) => i.fromSearch);
      const seen = new Set(items.map((i) => i.url).filter(Boolean));
      st.items = [...items, ...extra.filter((x) => !seen.has(x.url))].sort((a, b) => b.t - a.t);
      if (items.length || final) { pWire.state("ok"); pWire.touch(); }
      paint();
      if (final) pub("news:wire", items);
      const pr = news.pressure(items, 24);
      mount(pPress.body,
        h("div", { class: "row", style: { alignItems: "baseline", gap: "10px" } },
          h("span", { class: "hero " + (pr.value > 0.1 ? "hz" : pr.value < -0.1 ? "up" : "") }, pr.n ? signed(pr.value, 2) : "—"),
          h("span", { class: "small dim" }, pr.n ? `${pr.n} tagged headlines` : "no tagged headlines yet")),
        h("p", { class: "tiny muted" }, "Average of +1 (supply-risk words) and −1 (relief words) over headlines from the last 24 hours. A mood gauge, not a signal."));
      pPress.touch();
      const cut = Date.now() - 48 * 3600e3;
      const recent = items.filter((i) => i.t >= cut);
      const tagCounts = TAGS.map((t) => recent.filter((i) => i.tags.includes(t)).length);
      const chT = await chartIn(pTags);
      chT.set(barOption({ cats: TAGS, values: tagCounts, horizontal: true, integer: true, fmt: (v) => int(v), colorVar: "--s1" }));
      pTags.setData([{ label: "Topic" }, { label: "Headlines, 48h", num: true }], TAGS.map((t, i) => [t, tagCounts[i]]));
      pTags.touch();
      const regs = news.REGION_LIST.map((r) => ({ r, n: recent.filter((i) => i.region === r.id).length }));
      const chR = await chartIn(pRegions);
      chR.set(barOption({ cats: regs.map((x) => x.r.label), values: regs.map((x) => x.n), horizontal: true, integer: true, fmt: (v) => int(v), colorVar: "--s3" }));
      pRegions.setData([{ label: "Region" }, { label: "Headlines, 48h", num: true }], regs.map((x) => [x.r.label, x.n]));
      pRegions.touch();
      const label = { ok: ["ok", "live"], off: ["", "off"], pending: ["", "waiting"], err: ["crit", "failing"] };
      mount(pFeeds.body, h("table", { class: "tbl" }, h("tbody", {}, Object.entries(sources).map(([k, v]) => h("tr", {}, h("td", {}, k), h("td", { class: "r" }, h("span", { class: "tag " + (label[v] || label.err)[0] }, (label[v] || label.err)[1])))))),
        proxyOn() ? null : h("p", { class: "note", style: { padding: "6px 10px" } }, "Add the edge proxy in Settings to pull OilPrice, EIA, gCaptain, Maritime Executive, Rigzone, Splash247 and Hellenic Shipping News."));
      pFeeds.touch();
    }

    let first = true;
    scope.every(5 * 60e3, () => load(pWire, async () => {
      const res = await news.wire({ onUpdate: (partial) => render(partial, false) });
      await render(res, true);
      if (first && st.q) searchGdelt(st.q);
      first = false;
    }, { quiet: !first }));
  },
};

const M_WIRE = `<p>Sources: the straits.live incident feed (Hormuz and Red Sea events with type tags), GDELT's global news search (English, last 48 hours; slow and sometimes unavailable) and, if the edge proxy is configured, specialist RSS feeds. Duplicates are merged on their first eight meaningful words.</p>
<p>Tags come from transparent keyword rules (see js/data/news.js): "risk up" for attacks, outages, closures, seizures and output cuts; "risk down" for reopenings, ceasefires, releases and output increases. Keyword rules misread negations and irony; read the headline.</p>`;
const M_PRESS = `<p>Mean of the supply-risk sign over tagged headlines in the last 24 hours, from −1 (all relief) to +1 (all risk). Feeds differ in tone and volume, so compare the gauge with itself over time rather than across days with different source mixes.</p>`;
