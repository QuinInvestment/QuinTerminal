// SHIP — maritime: live tankers off Russia's Baltic export terminals, port
// weather at the world's key loading points, storms near infrastructure and
// tanker equities as a freight proxy.

import { h, mount, sparkline, cssVar } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { num, int, pct, isNum, ago, shortDay } from "../core/fmt.js";
import { proxyOn } from "../core/settings.js";
import * as dt from "../data/digitraffic.js";
import * as wx from "../data/openmeteo.js";
import * as hz from "../data/hazards.js";
import * as px from "../data/proxy.js";
import * as archive from "../data/archive.js";
import { tsOption } from "../core/charts.js";
import { load, table, empty, stat, chartIn } from "./kit.js";
import { createMap, popupHtml, fc, addArrowIcon } from "./mapkit.js";
import { tvWidget } from "./tv.js";

const HIST_KEY = "qt:v3:baltic-history";

export default {
  title: "Maritime",
  sub: "Tankers off Russia's Baltic export terminals in real time, sea state at the main loading terminals, storms near infrastructure, and tanker equities as a freight-rate proxy.",

  async mount(view, { scope }) {
    const pMap = panel({ title: "Gulf of Finland: tankers in real time", span: 8, rows: 8, src: ["ais", "basemap"], flush: true, lead: true, method: M_AIS });
    const pTerm = panel({ title: "Russian Baltic export terminals", span: 4, rows: 8, src: ["ais"], method: M_TERM });
    const pList = panel({ title: "Tanker list", span: 12, rows: 7, src: ["ais"], flush: true });
    const pPulse = panel({ title: "Export pulse, one snapshot per weekday", span: 12, rows: 6, src: ["archive", "ais"], chart: true, method: M_PULSE });
    const pWx = panel({ title: "Sea state at loading terminals, next 48 hours", span: 6, rows: 8, src: ["meteo"], flush: true, method: M_WX });
    const pHz = panel({ title: "Storms and hazards near oil infrastructure", span: 6, rows: 8, src: ["gdacs", "eonet"], flush: true, method: M_HZ });
    const pEq = panel({ title: "Tanker equities (freight-rate proxy)", span: 12, rows: 7, src: [proxyOn() ? "yahoo" : "tv"], flush: true, method: M_EQ });
    view.appendChild(grid(pMap, pTerm, pList, pPulse, pWx, pHz, pEq));

    // ------------------------------------------------ map
    let H = null;
    try {
      const box = h("div", { class: "map-wrap" });
      pMap.body.appendChild(box);
      H = await createMap(box, { center: [26.6, 59.9], zoom: 6.3, globe: false });
      scope.add(() => H.dispose());
      const c = (v) => cssVar(v);
      H.map.addSource("terms", { type: "geojson", data: fc(dt.TERMINALS.map((t) => ({ type: "Feature", geometry: { type: "Point", coordinates: [t.lon, t.lat] }, properties: { name: t.name, note: t.note } }))) });
      H.map.addSource("tk", { type: "geojson", data: fc([]) });
      H.map.addLayer({ id: "terms", type: "circle", source: "terms", paint: { "circle-radius": 7, "circle-color": c("--accent"), "circle-opacity": 0.15, "circle-stroke-color": c("--accent"), "circle-stroke-width": 1.5 } });
      H.map.addLayer({ id: "terms-l", type: "symbol", source: "terms", layout: { "text-field": ["get", "name"], "text-font": H.font, "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top" }, paint: { "text-color": c("--text"), "text-halo-color": c("--map-sea"), "text-halo-width": 1 } });
      addArrowIcon(H.map);
      H.map.addLayer({ id: "tk-head", type: "symbol", source: "tk", layout: { "icon-image": "arrow", "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.55, 9, 0.95], "icon-rotate": ["get", "cog"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true }, paint: { "icon-color": ["case", ["get", "alert"], c("--hazard"), ["==", ["get", "laden"], "laden"], c("--s2"), ["==", ["get", "laden"], "ballast"], c("--s1"), c("--muted")], "icon-halo-color": c("--panel"), "icon-halo-width": 1 } });
      const pop = new H.maplibregl.Popup({ maxWidth: "300px" });
      H.map.on("click", "tk-head", (e) => { const p = e.features[0].properties; pop.setLngLat(e.lngLat).setHTML(popupHtml(p.name, [["Flag", p.flag], ["Size", p.size], ["Draught", p.draught], ["Load state", p.laden], ["Speed", p.sog], ["Course", p.cog + "°"], ["Status", p.nav], ["Destination", p.dest], ["ETA (UTC)", p.eta], ["IMO", p.imo]], "Load state is inferred from draught vs length.")).addTo(H.map); });
      H.map.on("mouseenter", "tk-head", () => (H.map.getCanvas().style.cursor = "pointer"));
      H.map.on("mouseleave", "tk-head", () => (H.map.getCanvas().style.cursor = ""));
    } catch (e) {
      pMap.state("error", "Map unavailable", e.message);
    }

    scope.every(75e3, () => load(pTerm, async () => {
      const list = await dt.tankers();
      const s = dt.summarise(list);
      if (H) H.map.getSource("tk")?.setData(fc(list.map((v) => ({ type: "Feature", geometry: { type: "Point", coordinates: [v.lon, v.lat] }, properties: { name: v.name, flag: v.flag, size: v.size, draught: isNum(v.draught) ? num(v.draught, 1) + " m" : "", laden: v.laden || "unknown", alert: /not under command|aground|restricted/i.test(v.navText || ""), sog: num(v.sog, 1) + " kn", cog: Math.round(v.cog || 0), nav: v.navText, dest: v.dest, eta: v.eta || "", imo: v.imo || "" } }))));
      pMap.touch();
      // per-browser history of the export pulse
      let hist = [];
      try { hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch {}
      const last = hist[hist.length - 1];
      if (!last || Date.now() - last.t > 10 * 60e3) { hist.push({ t: Date.now(), total: s.total, dep: s.departing.length, laden: s.laden }); hist = hist.slice(-288); try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch {} }
      const ru = s.per.filter((t) => /RU/.test(t.name));
      mount(pTerm.body,
        h("div", { class: "stats" },
          stat("Tankers tracked", int(s.total), `${int(s.laden)} laden, ${int(s.ballast)} in ballast`),
          stat("Laden, heading west", int(s.departing.length), "east of 26.5°E, > 4 kn", { cls: "ac" }),
          stat("Aframax or larger", int(s.large), "≥ 235 m"),
          stat("Flags of convenience", pct(s.focShare, 0), "share of tankers")),
        hist.length > 2 ? h("div", { class: "row", style: { margin: "8px 0", gap: "8px" } }, h("span", { class: "tiny muted" }, "Laden westbound, this browser's history"), sparkline(hist.map((x) => x.dep), { width: 160, height: 22, color: cssVar("--accent"), fill: true })) : null,
        table([
          { label: "Terminal", get: (t) => t.name },
          { label: "Within 20 km", r: true, get: (t) => t.total },
          { label: "Anchored", r: true, get: (t) => t.anchored },
          { label: "Moored", r: true, get: (t) => t.moored },
          { label: "Laden", r: true, get: (t) => t.laden },
        ], s.per),
        h("p", { class: "tiny muted", style: { marginTop: "8px" } }, `Top flags: ${s.flags.slice(0, 6).map(([f, n]) => `${f} ${n}`).join(", ")}. Coverage ends where Finnish shore stations lose range; Russian ports sit near its edge.`));
      // list
      const sorted = [...list].sort((a, b) => a.nearestKm - b.nearestKm);
      mount(pList.body, table([
        { label: "Name", get: (v) => v.name },
        { label: "Flag", get: (v) => h("span", { class: v.foc ? "tag" : "" }, v.flag) },
        { label: "Size", get: (v) => v.size },
        { label: "Length", r: true, get: (v) => (v.len ? v.len + " m" : "—") },
        { label: "Draught", r: true, get: (v) => (isNum(v.draught) ? num(v.draught, 1) + " m" : "—") },
        { label: "Load", get: (v) => h("span", { class: "tag " + (v.laden === "laden" ? "ac" : "") }, v.laden) },
        { label: "Speed", r: true, get: (v) => num(v.sog, 1) + " kn" },
        { label: "Status", get: (v) => v.navText },
        { label: "Destination", get: (v) => v.dest || "—" },
        { label: "ETA", get: (v) => v.eta || "—" },
        { label: "Nearest terminal", get: (v) => `${v.nearest} (${num(v.nearestKm, 0)} km)` },
        { label: "IMO", get: (v) => v.imo || "—" },
      ], sorted));
      pList.setData([{ label: "Name" }, { label: "IMO" }, { label: "MMSI" }, { label: "Flag" }, { label: "Length m", num: true }, { label: "Draught m", num: true }, { label: "Load" }, { label: "Speed kn", num: true }, { label: "Status" }, { label: "Destination" }, { label: "Lat", num: true }, { label: "Lon", num: true }], sorted.map((v) => [v.name, v.imo, v.mmsi, v.flag, v.len, v.draught, v.laden, v.sog, v.navText, v.dest, v.lat, v.lon]));
      pList.touch();
    }));

    // ------------------------------------------------ daily archive
    scope.every(30 * 60e3, () => load(pPulse, async () => {
      const rows = await archive.history("baltic");
      if (rows.length < 2) {
        mount(pPulse.body, h("div", { class: "note", style: { padding: "4px" } },
          rows.length ? `One snapshot archived so far (${rows[0].date}). The chart starts with the second weekday.` : "No archive yet. The Daily snapshot workflow records these counts each weekday after the settlement, building a history that the live AIS feed does not keep."));
        return;
      }
      const t = (r) => Date.parse(r.date + "T00:00:00Z");
      const ser = (k) => rows.filter((r) => r[k] !== "").map((r) => [t(r), +r[k]]);
      const ch = await chartIn(pPulse);
      ch.set(tsOption({
        series: [
          { name: "Tankers tracked", data: ser("tankers"), color: "--s1" },
          { name: "Laden, heading west", data: ser("laden_westbound"), color: "--s2" },
          { name: "Near Primorsk", data: ser("near_primorsk"), color: "--s3", width: 1.5 },
          { name: "Near Ust-Luga", data: ser("near_ustluga"), color: "--s4", width: 1.5 },
        ],
        yFmt: (v) => int(v), tipFmt: (v) => int(v),
      }));
      pPulse.setFoot(`${rows.length} weekday snapshots since ${rows[0].date}, taken at about 21:40 UTC. Counts are a single moment each day, so expect noise.`);
      pPulse.setData(Object.keys(rows[0]).map((k) => ({ label: k, num: !/date|time/.test(k) })), rows.map((r) => Object.values(r)));
    }));

    // ------------------------------------------------ weather
    scope.every(30 * 60e3, () => load(pWx, async () => {
      const rows = await wx.portWeather();
      mount(pWx.body, table([
        { label: "Terminal", get: (r) => h("span", { title: r.note }, r.name) },
        { label: "Waves now", r: true, get: (r) => (isNum(r.hsNow) ? num(r.hsNow, 1) + " m" : "—") },
        { label: "Next 48h", get: (r) => sparkline(r.series.map(Number), { width: 90, height: 16, color: cssVar(r.risk === "ok" ? "--s1" : "--warn") }) },
        { label: "Max", r: true, get: (r) => (isNum(r.hsMax) ? num(r.hsMax, 1) + " m" : "—") },
        { label: "Gusts", r: true, get: (r) => (isNum(r.gMax) ? num(r.gMax, 0) + " kn" : "—") },
        { label: "Status", get: (r) => h("span", { class: "tag " + (r.risk === "stop" ? "crit" : r.risk === "risk" ? "warn" : "ok") }, r.risk === "stop" ? "above limit" : r.risk === "risk" ? `${r.hoursOver} h above` : "workable") },
      ], rows));
      pWx.setData([{ label: "Terminal" }, { label: "Waves now m", num: true }, { label: "Max 48h m", num: true }, { label: "Gust max kn", num: true }, { label: "Status" }], rows.map((r) => [r.name, r.hsNow, r.hsMax, r.gMax, r.risk]));
    }));

    // ------------------------------------------------ hazards
    scope.every(20 * 60e3, () => load(pHz, async () => {
      const all = [];
      const res = await Promise.allSettled([hz.gdacs(), hz.eonet()]);
      for (const r of res) if (r.status === "fulfilled") all.push(...r.value);
      if (!all.length && res.every((r) => r.status === "rejected")) throw res[0].reason;
      const near = hz.nearInfra(all).slice(0, 60);
      mount(pHz.body, near.length ? table([
        { label: "Event", get: (x) => (x.url ? h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer" }, x.name) : x.name) },
        { label: "Source", get: (x) => x.src },
        { label: "Alert", get: (x) => (x.level ? h("span", { class: "tag " + (x.level === "Red" ? "crit" : x.level === "Orange" ? "warn" : "") }, x.level) : "—") },
        { label: "Nearest asset", get: (x) => x.nearest },
        { label: "Distance", r: true, get: (x) => h("span", { class: x.exposed ? "hz" : "" }, num(x.km, 0) + " km") },
      ], near) : empty("No active storms, fires or volcanic events reported near tracked infrastructure."));
    }));

    // ------------------------------------------------ tanker equities
    if (proxyOn()) {
      scope.every(10 * 60e3, () => load(pEq, async () => {
        const list = px.EQUITIES.filter((e) => ["Tankers", "Refiners", "Majors"].includes(e.g));
        const data = await px.yahooMany(list.map((e) => e.s), { range: "3mo", interval: "1d" });
        const rows = list.map((e) => ({ ...e, d: data[e.s] })).filter((r) => r.d);
        mount(pEq.body, table([
          { label: "Company", get: (r) => r.n }, { label: "Group", get: (r) => h("span", { class: "muted" }, r.g) },
          { label: "Price", r: true, get: (r) => num(r.d.price, 2) },
          { label: "1 day", r: true, cls: (r) => (r.d.price >= r.d.prev ? "up" : "down"), get: (r) => pct(r.d.price / r.d.prev - 1, 1) },
          { label: "3 months", get: (r) => sparkline(r.d.series.map((p) => p.c), { width: 120, height: 18, color: cssVar("--s1") }) },
        ], rows));
      }));
    } else {
      tvWidget(pEq.body, "market-quotes", {
        width: "100%", height: "100%", isTransparent: true, colorTheme: document.documentElement.dataset.theme === "day" ? "light" : "dark", locale: "en", showSymbolLogo: true,
        symbolsGroups: [
          { name: "Crude tankers", symbols: [{ name: "NYSE:FRO", displayName: "Frontline" }, { name: "NYSE:DHT", displayName: "DHT" }, { name: "NYSE:TNK", displayName: "Teekay Tankers" }, { name: "NYSE:INSW", displayName: "International Seaways" }, { name: "NYSE:NAT", displayName: "Nordic American" }] },
          { name: "Product tankers", symbols: [{ name: "NYSE:STNG", displayName: "Scorpio Tankers" }, { name: "NASDAQ:TRMD", displayName: "TORM" }, { name: "NYSE:ASC", displayName: "Ardmore" }] },
          { name: "Refiners", symbols: [{ name: "NYSE:VLO", displayName: "Valero" }, { name: "NYSE:MPC", displayName: "Marathon Petroleum" }, { name: "NYSE:PSX", displayName: "Phillips 66" }] },
        ],
      });
      pEq.touch();
    }
  },
};

const M_PULSE = `<p>Each weekday the Daily snapshot workflow (pipeline/snapshot.mjs) counts the tankers that Digitraffic's AIS feed shows in Finnish coverage: total, laden by draught, laden and heading west from east of 26.5°E (a proxy for loaded departures from Primorsk, Ust-Luga and Vysotsk) and vessels within 20 km of each terminal. One snapshot a day is a sample, not a flow measure: weather, AIS gaps and loading schedules all add noise. Look for sustained shifts, not single days.</p>`;
const M_AIS = `<p>Positions and static data from Digitraffic (Fintraffic), the Finnish open AIS service, which receives the Finnish coastal station network and covers most of the Gulf of Finland. Tankers are AIS ship types 80–89. Russia's Primorsk, Ust-Luga and Vysotsk terminals sit near the eastern edge of coverage, so ships moored inside those ports may be missing.</p>
<p>Load state is a heuristic: draught above 4.5% of length reads as laden, below 3.6% as ballast. Crews set draught by hand and often forget to update it.</p>`;
const M_TERM = `<p>Counts of tankers within 20 km of each terminal, split by AIS navigation status. "Laden, heading west" counts tankers east of 26.5°E sailing faster than 4 knots on a westerly course with a laden draught, not bound for Finnish or Estonian ports: a crude proxy for Russian Baltic export loadings. Flags of convenience follow the ITF list plus registries common in the sanctions-era fleet; a flag says nothing about any single ship's compliance.</p>`;
const M_WX = `<p>Hourly significant wave height (Open-Meteo marine model) and wind gusts (Open-Meteo forecast) at a sea point next to each terminal. Limits are typical operating cut-offs, not the terminals' published rules: single-point moorings usually suspend loading somewhere around 2–3 m of sea.</p>`;
const M_HZ = `<p>Open events from GDACS (cyclones, earthquakes, floods, volcanoes, with alert levels) and NASA EONET (storms, wildfires, volcanoes), each matched to the nearest asset in the reference layer. Highlighted when within 400 km of a storm, 150 km of other events or 40 km of a fire.</p>`;
const M_EQ = `<p>Tanker owners' shares move with time-charter rates; with the free tier they are the most accessible freight proxy. With the edge proxy enabled, prices come from Yahoo Finance; otherwise from a TradingView widget.</p>`;
