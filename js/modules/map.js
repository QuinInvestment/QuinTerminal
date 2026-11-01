// MAP — the geo-intelligence globe: trade routes (with the 2026 crisis
// re-routing), pipelines, fields, refineries, terminals, chokepoints, live
// tankers, storms, port weather, satellite imagery and — with the edge
// proxy — military aircraft and satellite fire detections.

import { h, mount, cssVar } from "../core/dom.js";
import { get } from "../core/bus.js";
import { proxyOn, settings } from "../core/settings.js";
import { num, int, pct, isNum, ago, shortDay } from "../core/fmt.js";
import { toast } from "../core/ui.js";
import * as dt from "../data/digitraffic.js";
import * as hz from "../data/hazards.js";
import * as wx from "../data/openmeteo.js";
import * as px from "../data/proxy.js";
import { CATS, SOURCES_NOTE } from "../data/static/infrastructure.js";
import { createMap, addReferenceLayers, bindPopups, animateFlows, setVisible, legend, flyToPlace, popupHtml, fc, PLACES } from "./mapkit.js";

export default {
  title: "Geo map",
  sub: "Where the barrels are, where they cannot go, and what is moving right now. Click anything for details; type MAP HORMUZ, MAP CUSHING or MAP PRIMORSK to fly.",

  async mount(view, { scope, tools, arg }) {
    view.style.padding = "0";
    const wrap = h("div", { class: "map-wrap", style: { height: "100%" } });
    view.appendChild(wrap);
    scope.add(() => { view.style.padding = ""; });

    const places = ["WORLD", "GULF", "HORMUZ", "REDSEA", "BLACKSEA", "BALTIC", "USGC", "MALACCA", "CAPE"];
    const fly = (p) => {
      if (!H) return;
      if (p === "WORLD") H.map.flyTo({ center: [52, 22], zoom: globeZoom(wrap), speed: 1.4, essential: true });
      else flyToPlace(H, p);
    };
    mount(tools, h("div", { class: "seg" }, places.map((p) => h("button", { type: "button", onclick: () => fly(p) }, p === "USGC" ? "US Gulf" : p === "REDSEA" ? "Red Sea" : p === "BLACKSEA" ? "Black Sea" : p.charAt(0) + p.slice(1).toLowerCase()))));

    let H;
    try {
      H = await createMap(wrap, { center: [52, 22], zoom: globeZoom(wrap), globe: true });
    } catch (e) {
      mount(wrap, h("div", { class: "p-state err" }, h("div", { class: "msg" }, h("strong", {}, "The map could not start"), e.message || String(e))));
      return;
    }
    scope.add(() => H.dispose());
    const { map, maplibregl } = H;

    // imagery (under everything we draw)
    const firstOurs = () => (map.getLayer("routes-base") ? "routes-base" : undefined);
    const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    map.addSource("esri", { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 18, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" });
    map.addSource("gibs", { type: "raster", tiles: [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${yday}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`], tileSize: 256, maxzoom: 9, attribution: "NASA GIBS / VIIRS NOAA-20" });
    map.addSource("lights", { type: "raster", tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png"], tileSize: 256, maxzoom: 8, attribution: "NASA Black Marble" });
    addReferenceLayers(H, { routes: true, crisis: true });
    map.addLayer({ id: "sat-esri", type: "raster", source: "esri", layout: { visibility: "none" }, paint: { "raster-opacity": 0.85 } }, firstOurs());
    map.addLayer({ id: "sat-gibs", type: "raster", source: "gibs", layout: { visibility: "none" }, paint: { "raster-opacity": 0.9 } }, firstOurs());
    map.addLayer({ id: "sat-lights", type: "raster", source: "lights", layout: { visibility: "none" }, paint: { "raster-opacity": 0.9 } }, firstOurs());

    // dynamic layers
    const c = (v) => cssVar(v);
    for (const s of ["tankers", "hazards", "wx", "air", "fires"]) map.addSource(s, { type: "geojson", data: fc([]) });
    map.addLayer({ id: "wx", type: "circle", source: "wx", layout: { visibility: "none" }, paint: { "circle-radius": 9, "circle-color": ["match", ["get", "risk"], "stop", c("--crit"), "risk", c("--warn"), c("--up")], "circle-opacity": 0.25, "circle-stroke-width": 2, "circle-stroke-color": ["match", ["get", "risk"], "stop", c("--crit"), "risk", c("--warn"), c("--up")] } });
    map.addLayer({ id: "hazards", type: "circle", source: "hazards", paint: { "circle-radius": ["case", ["get", "storm"], 11, 7], "circle-color": c("--warn"), "circle-opacity": 0.3, "circle-stroke-color": c("--warn"), "circle-stroke-width": 2 } });
    map.addLayer({ id: "fires", type: "circle", source: "fires", layout: { visibility: "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["get", "frp"], 0, 2, 100, 6], "circle-color": c("--down"), "circle-opacity": 0.85 } });
    map.addLayer({ id: "tankers", type: "circle", source: "tankers", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 2, 7, 5], "circle-color": ["match", ["get", "laden"], "laden", c("--s2"), "ballast", c("--s1"), c("--ink-2")], "circle-stroke-width": 1, "circle-stroke-color": c("--bg-1") } });
    map.addLayer({ id: "air", type: "circle", source: "air", layout: { visibility: "none" }, paint: { "circle-radius": 4.5, "circle-color": ["match", ["get", "kind"], "Tanker", c("--s4"), "ISR", c("--hazard"), "Combat", c("--crit"), "Airlift", c("--s7"), c("--ink-2")], "circle-stroke-width": 1, "circle-stroke-color": c("--bg-1") } });

    bindPopups(H);
    animateFlows(H);
    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "300px" });
    map.on("click", "tankers", (e) => { const p = e.features[0].properties; popup.setLngLat(e.lngLat).setHTML(popupHtml(p.name, [["Flag", p.flag], ["Size", p.size], ["Draught", p.draught ? p.draught + " m" : ""], ["Load state", p.laden], ["Speed", p.sog + " kn"], ["Status", p.nav], ["Destination", p.dest], ["ETA", p.eta], ["IMO", p.imo], ["MMSI", p.mmsi]], "Digitraffic AIS, Finnish coastal stations. Load state is inferred from draught.")).addTo(map); });
    map.on("click", "hazards", (e) => { const p = e.features[0].properties; popup.setLngLat(e.lngLat).setHTML(popupHtml(p.name, [["Source", p.src], ["Type", p.type], ["Alert", p.level], ["Nearest asset", p.nearest], ["Distance", isNum(+p.km) ? num(+p.km, 0) + " km" : ""]], p.severity)).addTo(map); });
    map.on("click", "wx", (e) => { const p = e.features[0].properties; popup.setLngLat(e.lngLat).setHTML(popupHtml(p.name, [["Waves now", num(+p.hsNow, 1) + " m"], ["Max next 48h", num(+p.hsMax, 1) + " m"], ["Gusts max 48h", num(+p.gMax, 0) + " kn"], ["Loading limit (heuristic)", p.hs + " m / " + p.gust + " kn"], ["Status", p.risk]], p.note)).addTo(map); });
    map.on("click", "air", (e) => { const p = e.features[0].properties; popup.setLngLat(e.lngLat).setHTML(popupHtml(p.call || p.hex, [["Type", p.type], ["Role", p.kind], ["Altitude", p.alt ? p.alt + " ft" : ""], ["Region", p.regionName]], "ADS-B via adsb.lol. Many military aircraft fly without broadcasting.")).addTo(map); });
    map.on("click", "fires", (e) => { const p = e.features[0].properties; popup.setLngLat(e.lngLat).setHTML(popupHtml("Fire detection", [["Radiative power", num(+p.frp, 1) + " MW"], ["Confidence", p.conf], ["Seen", `${p.date} ${p.time}`]], "NASA FIRMS VIIRS. Gas flares at oil fields show up as persistent hot spots.")).addTo(map); });
    for (const l of ["tankers", "hazards", "wx", "air", "fires"]) { map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer")); map.on("mouseleave", l, () => (map.getCanvas().style.cursor = "")); }

    // ------------------------------------------------ layer control
    const LAYERS = [
      { id: "routes", label: "Crude trade routes", ids: ["routes-base", "routes-flow"], on: true, sub: "pre-crisis volumes; 2026 status" },
      { id: "pipes", label: "Pipelines", ids: ["pipelines"], on: true, sub: "green = Hormuz bypass" },
      { id: "infra", label: "Fields, refineries, terminals", ids: ["infra", "infra-label"], on: true, sub: `${Object.keys(CATS).length} categories` },
      { id: "choke", label: "Chokepoints", ids: ["choke", "choke-label"], on: true, sub: "EIA flows 1H25 → 2Q26" },
      { id: "tss", label: "Shipping lanes", ids: ["tss"], on: true, sub: "schematic" },
      { id: "tankers", label: "Live tankers, Gulf of Finland", ids: ["tankers"], on: true, sub: "Digitraffic AIS", src: "ais" },
      { id: "hazards", label: "Storms and hazards", ids: ["hazards"], on: true, sub: "GDACS, NASA EONET", src: "gdacs" },
      { id: "wx", label: "Port weather risk", ids: ["wx"], on: false, sub: "Open-Meteo, 48h", src: "meteo" },
      { id: "sat", label: "Satellite imagery", ids: ["sat-esri"], on: false, sub: "Esri World Imagery" },
      { id: "gibs", label: "Yesterday from space", ids: ["sat-gibs"], on: false, sub: "NASA VIIRS true colour" },
      { id: "lights", label: "Night lights", ids: ["sat-lights"], on: false, sub: "NASA Black Marble 2016" },
      { id: "air", label: "Military aircraft", ids: ["air"], on: false, sub: proxyOn() ? "adsb.lol" : "needs edge proxy", needs: "proxy" },
      { id: "fires", label: "Fire detections", ids: ["fires"], on: false, sub: proxyOn() ? "NASA FIRMS VIIRS, last 24h" : "needs edge proxy + FIRMS key", needs: "proxy" },
    ];
    const state = Object.fromEntries(LAYERS.map((l) => [l.id, l.on]));
    let crisis = true, globe = true;
    const narrow = wrap.clientWidth < 700; // phones: overlays start closed so the map is visible
    let layersOpen = !narrow;
    const counts = {}; // per-layer feature counts, kept across repaints of the panel
    const panelEl = h("div", { class: "layers" });
    wrap.appendChild(panelEl);
    function paintLayers() {
      panelEl.classList.toggle("collapsed", !layersOpen);
      mount(panelEl,
        h("h3", {}, h("button", { class: "lyr-toggle", type: "button", "aria-expanded": String(layersOpen), onclick: () => { layersOpen = !layersOpen; paintLayers(); } }, "Layers"), h("span", { class: "row tight" },
          h("button", { class: "chip", type: "button", "aria-pressed": String(crisis), title: "Colour routes by their 2026 status", onclick: () => { crisis = !crisis; applyCrisis(); paintLayers(); } }, "2026 view"),
          h("button", { class: "chip", type: "button", "aria-pressed": String(globe), onclick: () => { globe = !globe; try { map.setProjection({ type: globe ? "globe" : "mercator" }); } catch {} paintLayers(); } }, "Globe"))),
        LAYERS.map((l) => {
          const disabled = l.needs === "proxy" && !proxyOn();
          const cb = h("input", { type: "checkbox", checked: state[l.id] && !disabled, disabled, onchange: (e) => { state[l.id] = e.target.checked; setVisible(map, l.ids, e.target.checked); if (e.target.checked) loaders[l.id]?.(); } });
          return h("label", { class: "layer" + (disabled ? " off" : "") }, cb, h("span", {}, l.label, h("div", { class: "ls" }, l.sub)), h("span", { class: "ls", id: "lc-" + l.id }, counts[l.id] || ""));
        }),
        h("p", { class: "tiny muted", style: { margin: 0, padding: "8px 10px" } }, SOURCES_NOTE));
    }
    function applyCrisis() {
      const col = crisis ? ["match", ["get", "crisis"], "blocked", c("--hazard"), "bypass", c("--s3"), "risk", c("--warn"), c("--s1")] : c("--s1");
      map.setPaintProperty("routes-base", "line-color", col);
      map.setPaintProperty("routes-flow", "line-color", col);
      map.setFilter("routes-flow", crisis ? ["!=", ["get", "crisis"], "blocked"] : null);
      map.setPaintProperty("routes-base", "line-opacity", crisis ? ["match", ["get", "crisis"], "blocked", 0.28, "normal", 0.35, 0.55] : 0.45);
    }
    paintLayers();
    for (const l of LAYERS) setVisible(map, l.ids, state[l.id] && !(l.needs === "proxy" && !proxyOn()));
    const count = (id, text) => { counts[id] = text; const el = document.getElementById("lc-" + id); if (el) el.textContent = text; };

    wrap.appendChild(legend([
      { color: c("--hazard"), label: "Route blocked by the Hormuz closure" },
      { color: c("--s3"), label: "Bypass route or pipeline (2026)" },
      { color: c("--warn"), label: "Route through the contested Red Sea" },
      { color: c("--s1"), label: "Unaffected route (illustrative volumes)" },
      { color: c("--s7"), label: "Other pipeline" },
      { color: c("--s2"), label: "Tanker, laden (draught-based)", dot: true },
      { color: c("--s1"), label: "Tanker, in ballast", dot: true },
    ], { collapsed: narrow }));

    // ------------------------------------------------ loaders
    const loaders = {
      async tankers() {
        try {
          const list = await dt.tankers();
          map.getSource("tankers")?.setData(fc(list.map((v) => ({ type: "Feature", geometry: { type: "Point", coordinates: [v.lon, v.lat] }, properties: { name: v.name, flag: v.flag, size: v.size, draught: isNum(v.draught) ? num(v.draught, 1) : "", laden: v.laden, sog: num(v.sog, 1), nav: v.navText, dest: v.dest, eta: v.eta || "", imo: v.imo || "", mmsi: v.mmsi } }))));
          count("tankers", String(list.length));
        } catch { count("tankers", "err"); }
      },
      async hazards() {
        const all = [];
        try { all.push(...await hz.gdacs()); } catch {}
        try { all.push(...await hz.eonet()); } catch {}
        const near = hz.nearInfra(all);
        map.getSource("hazards")?.setData(fc(near.map((x) => ({ type: "Feature", geometry: { type: "Point", coordinates: [x.lon, x.lat] }, properties: { name: x.name, src: x.src, type: x.type, level: x.level || "", nearest: x.nearest, km: x.km, severity: x.severity || "", storm: x.type === "TC" || x.type === "severeStorms" } }))));
        count("hazards", String(near.length));
      },
      async wx() {
        try {
          const rows = await wx.portWeather();
          map.getSource("wx")?.setData(fc(rows.map((r) => ({ type: "Feature", geometry: { type: "Point", coordinates: [r.lon, r.lat] }, properties: { name: r.name, hsNow: r.hsNow, hsMax: r.hsMax, gMax: r.gMax, hs: r.hs, gust: r.gust, risk: r.risk, note: r.note } }))));
          count("wx", String(rows.filter((r) => r.risk !== "ok").length) + " at risk");
        } catch { count("wx", "err"); }
      },
      async air() {
        if (!proxyOn()) return;
        try {
          const ac = await px.military();
          map.getSource("air")?.setData(fc(ac.map((a) => ({ type: "Feature", geometry: { type: "Point", coordinates: [a.lon, a.lat] }, properties: a }))));
          count("air", String(ac.length));
        } catch { count("air", "err"); }
      },
      async fires() {
        if (!proxyOn()) return;
        try {
          const f = await px.firms();
          map.getSource("fires")?.setData(fc(f.map((x) => ({ type: "Feature", geometry: { type: "Point", coordinates: [x.lon, x.lat] }, properties: x }))));
          count("fires", String(f.length));
        } catch (e) { count("fires", "err"); toast("Fire detections unavailable", e.message, { sev: "warn" }); }
      },
    };
    scope.every(90e3, () => state.tankers && loaders.tankers());
    scope.every(20 * 60e3, () => state.hazards && loaders.hazards());
    scope.every(30 * 60e3, () => state.wx && loaders.wx());
    scope.every(60e3, () => state.air && loaders.air());
    scope.every(30 * 60e3, () => state.fires && loaders.fires());

    if (arg) setTimeout(() => flyToPlace(H, arg), 400);
  },
};

// Zoom at which the globe fills ~92% of the shorter side of the map box.
// MapLibre's globe radius at zoom z is 512·2^z / 2π pixels (512 px tiles).
function globeZoom(el) {
  const side = Math.min(el.clientWidth || 800, el.clientHeight || 600);
  const z = Math.log2((0.46 * side * 2 * Math.PI) / 512);
  return Math.max(0.6, Math.min(2.6, z));
}
