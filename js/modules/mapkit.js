// MapLibre helpers shared by the MAP, HRMZ and SHIP functions: an ECDIS-style
// recoloured basemap, the infrastructure layers, animated flow lines and
// popups. Globe projection when available.

import { loadLib } from "../core/loader.js";
import { cssVar, h, esc } from "../core/dom.js";
import { getJSON } from "../core/fetcher.js";
import * as health from "../core/health.js";
import { POINTS, PIPELINES, CHOKEPOINTS, ROUTES, TSS, CATS } from "../data/static/infrastructure.js";

const STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

function recolour(style) {
  const sea = cssVar("--map-sea"), land = cssVar("--map-land"), coast = cssVar("--map-coast"), border = cssVar("--map-border"), label = cssVar("--map-label");
  const keep = [];
  for (const l of style.layers || []) {
    const id = (l.id || "").toLowerCase();
    const sl = (l["source-layer"] || "").toLowerCase();
    if (l.type === "background") { l.paint = { "background-color": land }; keep.push(l); continue; }
    if (/building|poi|housenum|aeroway|transit|rail|ferry/.test(id + sl)) continue;
    if (/water|ocean|sea|lake|river|bay/.test(id + sl)) {
      if (l.type === "fill") l.paint = { "fill-color": sea, "fill-antialias": true };
      else if (l.type === "line") l.paint = { "line-color": sea, "line-width": 0.6 };
      else if (l.type === "symbol") { if (!/ocean|sea/.test(id)) continue; l.paint = { "text-color": label, "text-halo-color": sea, "text-halo-width": 1, "text-opacity": 0.7 }; }
      keep.push(l);
      continue;
    }
    if (/boundar|admin|border/.test(id + sl)) {
      if (l.type !== "line") continue;
      l.paint = { ...(l.paint || {}), "line-color": border, "line-opacity": 0.9 };
      keep.push(l);
      continue;
    }
    if (/road|street|highway|bridge|tunnel|path|transport/.test(id + sl)) {
      if (l.type !== "line") continue;
      l.minzoom = Math.max(l.minzoom || 0, 7);
      l.paint = { ...(l.paint || {}), "line-color": coast, "line-opacity": 0.35 };
      keep.push(l);
      continue;
    }
    if (/land|park|wood|forest|grass|earth|glacier|ice|sand|wetland/.test(id + sl)) {
      if (l.type === "fill") { l.paint = { "fill-color": land, "fill-opacity": 0.6 }; keep.push(l); }
      continue;
    }
    if (l.type === "symbol") {
      if (!/country|place|city|state|capital|continent/.test(id + sl)) continue;
      l.paint = { "text-color": label, "text-halo-color": land, "text-halo-width": 1.2, "text-opacity": /country|continent/.test(id) ? 0.85 : 0.7 };
      keep.push(l);
      continue;
    }
    if (l.type === "fill") { l.paint = { ...(l.paint || {}), "fill-color": land }; keep.push(l); continue; }
  }
  style.layers = keep;
  return style;
}

async function buildStyle() {
  try {
    const raw = await getJSON(STYLE_URL, { ttl: 24 * 3600e3, source: "basemap", timeout: 15e3 });
    const style = recolour(structuredClone(raw));
    style.projection = { type: "globe" };
    return style;
  } catch (e) {
    return { version: 8, sources: {}, glyphs: "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf", layers: [{ id: "background", type: "background", paint: { "background-color": cssVar("--map-sea") } }] };
  }
}

function fontOf(style) {
  for (const l of style.layers || []) {
    const f = l.layout && l.layout["text-font"];
    if (Array.isArray(f) && typeof f[0] === "string") return f;
  }
  return ["Noto Sans Regular"];
}

export async function createMap(el, { center = [48, 24], zoom = 2.2, globe = true, minZoom = 0.6 } = {}) {
  const maplibregl = await loadLib("maplibre");
  const style = await buildStyle();
  const map = new maplibregl.Map({
    container: el, style, center, zoom, minZoom, maxPitch: 0, dragRotate: false,
    attributionControl: { compact: true, customAttribution: "Basemap © CARTO, © OpenStreetMap contributors" },
  });
  map.touchZoomRotate?.disableRotation?.();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  await new Promise((resolve) => { if (map.loaded()) resolve(); else map.once("load", resolve); setTimeout(resolve, 8000); });
  if (globe) { try { map.setProjection({ type: "globe" }); } catch {} } else { try { map.setProjection({ type: "mercator" }); } catch {} }
  const ro = new ResizeObserver(() => map.resize());
  ro.observe(el);
  const handle = { map, maplibregl, font: fontOf(style), anim: null, dispose() { ro.disconnect(); cancelAnimationFrame(handle.anim); try { map.remove(); } catch {} } };
  return handle;
}

// ---------------------------------------------------------------- GeoJSON builders
export const fc = (features) => ({ type: "FeatureCollection", features });
const pt = (lon, lat, props) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: props });
const ln = (coords, props) => ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: props });

export function infraGeo() {
  return fc(POINTS.map((p) => pt(p.lon, p.lat, { id: p.id, name: p.name, cat: p.cat, cc: p.cc, cap: p.cap || 0, trapped: !!p.trapped, note: p.note || "" })));
}
export function pipelineGeo() {
  return fc(PIPELINES.map((p) => ln(p.path, { id: p.id, name: p.name, cap: p.cap, status: p.status, bypass: !!p.bypass, note: p.note || "" })));
}
export function routeGeo() {
  return fc(ROUTES.map((r) => ln(r.path, { id: r.id, name: r.name, mbd: r.mbd, crisis: r.crisis, via: r.via.join(", ") })));
}
export function chokeGeo(live = {}) {
  return fc(CHOKEPOINTS.map((c) => pt(c.lon, c.lat, { id: c.id, name: c.name, pre: c.pre, now: c.now, status: live[c.id]?.status || c.status, label: `${c.name}\n${c.pre} → ${c.now} mb/d`, note: c.note || "" })));
}
export function tssGeo() { return fc(TSS.map((t) => ln(t.path, { id: t.id }))); }

// ---------------------------------------------------------------- reference layers
export function addReferenceLayers(H, { routes = true, crisis = true } = {}) {
  const { map, font } = H;
  const c = (v) => cssVar(v);
  map.addSource("routes", { type: "geojson", data: routeGeo() });
  map.addSource("pipelines", { type: "geojson", data: pipelineGeo() });
  map.addSource("tss", { type: "geojson", data: tssGeo() });
  map.addSource("infra", { type: "geojson", data: infraGeo() });
  map.addSource("choke", { type: "geojson", data: chokeGeo() });

  const routeColor = crisis
    ? ["match", ["get", "crisis"], "blocked", c("--hazard"), "bypass", c("--s3"), "risk", c("--warn"), c("--s1")]
    : c("--s1");
  map.addLayer({ id: "routes-base", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round", visibility: routes ? "visible" : "none" },
    paint: { "line-color": routeColor, "line-opacity": crisis ? ["match", ["get", "crisis"], "blocked", 0.28, "normal", 0.35, 0.55] : 0.4, "line-width": ["interpolate", ["linear"], ["get", "mbd"], 0.3, 1, 2, 2.5, 6, 6] } });
  map.addLayer({ id: "routes-flow", type: "line", source: "routes", layout: { "line-cap": "butt", "line-join": "round", visibility: routes ? "visible" : "none" },
    filter: crisis ? ["!=", ["get", "crisis"], "blocked"] : ["all"],
    paint: { "line-color": routeColor, "line-opacity": 0.95, "line-width": ["interpolate", ["linear"], ["get", "mbd"], 0.3, 1, 2, 2, 6, 3.5], "line-dasharray": [0, 4, 3] } });
  map.addLayer({ id: "pipelines", type: "line", source: "pipelines", layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["case", ["get", "bypass"], c("--s3"), ["==", ["get", "status"], "idle"], c("--ink-3"), c("--s7")], "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.4, 6, 3], "line-opacity": 0.9 } });
  map.addLayer({ id: "tss", type: "line", source: "tss", minzoom: 4, paint: { "line-color": c("--map-lane"), "line-width": 1.4, "line-dasharray": [3, 2], "line-opacity": 0.9 } });
  const catColor = ["match", ["get", "cat"], ...Object.entries(CATS).flatMap(([k, v]) => [k, c(v.color)]), c("--ink-2")];
  map.addLayer({ id: "infra", type: "circle", source: "infra",
    paint: {
      "circle-color": catColor,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, ["+", 2, ["/", ["sqrt", ["max", ["get", "cap"], 50]], 22]], 6, ["+", 4, ["/", ["sqrt", ["max", ["get", "cap"], 50]], 9]]],
      "circle-stroke-color": ["case", ["get", "trapped"], c("--hazard"), c("--bg-1")],
      "circle-stroke-width": ["case", ["get", "trapped"], 1.6, 1],
      "circle-opacity": 0.92,
    } });
  map.addLayer({ id: "infra-label", type: "symbol", source: "infra", minzoom: 4.5,
    layout: { "text-field": ["get", "name"], "text-font": font, "text-size": 10.5, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": c("--ink-2"), "text-halo-color": c("--map-land"), "text-halo-width": 1.2 } });
  map.addLayer({ id: "choke", type: "circle", source: "choke",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "pre"], 2, 7, 23, 16],
      "circle-color": ["match", ["get", "status"], "closed", c("--hazard"), "contested", c("--warn"), c("--up")],
      "circle-opacity": 0.22, "circle-stroke-width": 2,
      "circle-stroke-color": ["match", ["get", "status"], "closed", c("--hazard"), "contested", c("--warn"), c("--up")],
    } });
  map.addLayer({ id: "choke-label", type: "symbol", source: "choke",
    layout: { "text-field": ["get", "label"], "text-font": font, "text-size": 11, "text-offset": [0, 1.6], "text-anchor": "top", "text-allow-overlap": false },
    paint: { "text-color": c("--ink-1"), "text-halo-color": c("--map-sea"), "text-halo-width": 1.5 } });
}

/** Animate the dashed flow layer (stops for reduced motion). */
export function animateFlows(H, layer = "routes-flow") {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const seq = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
  let step = 0, last = 0;
  const frame = (t) => {
    if (t - last > 70) {
      last = t;
      step = (step + 1) % seq.length;
      if (H.map.getLayer(layer)) H.map.setPaintProperty(layer, "line-dasharray", seq[step]);
    }
    H.anim = requestAnimationFrame(frame);
  };
  H.anim = requestAnimationFrame(frame);
}

export function popupHtml(title, rows, note) {
  return `<div style="min-width:180px;max-width:280px"><div style="font-weight:600;margin-bottom:4px">${esc(title)}</div>${rows
    .filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== "")
    .map((r) => `<div style="display:flex;justify-content:space-between;gap:12px"><span style="opacity:.65">${esc(r[0])}</span><span style="font-variant-numeric:tabular-nums;text-align:right">${esc(r[1])}</span></div>`)
    .join("")}${note ? `<div style="margin-top:6px;opacity:.75">${esc(note)}</div>` : ""}</div>`;
}

export function bindPopups(H) {
  const { map, maplibregl } = H;
  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "300px" });
  const at = (e, html) => popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  map.on("click", "infra", (e) => {
    const p = e.features[0].properties;
    at(e, popupHtml(p.name, [["Type", CATS[p.cat]?.label], ["Country", p.cc], ["Capacity", +p.cap ? `${(+p.cap).toLocaleString()} kb/d` : ""], ["Behind Hormuz", p.trapped === true || p.trapped === "true" ? "yes" : ""]], p.note));
  });
  map.on("click", "choke", (e) => {
    const p = e.features[0].properties;
    at(e, popupHtml(p.name, [["Status", p.status], ["Oil flow 1H 2025", `${p.pre} mb/d`], ["Oil flow 2Q 2026", `${p.now} mb/d`]], p.note));
  });
  map.on("click", "pipelines", (e) => {
    const p = e.features[0].properties;
    at(e, popupHtml(p.name, [["Capacity", `${(+p.cap).toLocaleString()} kb/d`], ["Status", p.status], ["Hormuz bypass", p.bypass === true || p.bypass === "true" ? "yes" : ""]], p.note));
  });
  map.on("click", "routes-base", (e) => {
    const p = e.features[0].properties;
    at(e, popupHtml(p.name, [["Pre-crisis flow", `${p.mbd} mb/d (illustrative)`], ["Via", p.via], ["2026 status", p.crisis]]));
  });
  for (const l of ["infra", "choke", "pipelines", "routes-base"]) {
    map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
  }
  return popup;
}

/** A heading arrow drawn on a canvas and registered as an SDF icon (tintable). */
export function addArrowIcon(map, name = "arrow") {
  if (map.hasImage && map.hasImage(name)) return;
  const n = 32, cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff";
  g.beginPath(); g.moveTo(n / 2, 3); g.lineTo(n - 7, n - 5); g.lineTo(n / 2, n - 11); g.lineTo(7, n - 5); g.closePath(); g.fill();
  map.addImage(name, g.getImageData(0, 0, n, n), { sdf: true, pixelRatio: 2 });
}

export function setVisible(map, ids, on) {
  for (const id of [].concat(ids)) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

/** Map key. Collapsible: on a phone it starts closed so the map stays visible. */
export function legend(items, { collapsed = false } = {}) {
  const el = h("div", { class: "map-legend" + (collapsed ? " collapsed" : "") });
  const btn = h("button", { class: "lg-toggle", type: "button", "aria-expanded": String(!collapsed), onclick: () => {
    const c = el.classList.toggle("collapsed");
    btn.setAttribute("aria-expanded", String(!c));
  } }, "Key");
  el.append(btn, h("div", { class: "lg-items" }, items.map((i) => h("div", { class: "lg" }, h("span", { class: "sw" + (i.dot ? " dot" : ""), style: { background: i.color } }), i.label))));
  return el;
}

export const PLACES = {
  HORMUZ: { center: [56.3, 26.4], zoom: 6.6 }, GULF: { center: [52, 27], zoom: 4.8 }, REDSEA: { center: [39, 20], zoom: 4.3 }, BAB: { center: [43.4, 12.6], zoom: 6.5 },
  SUEZ: { center: [32.4, 30.3], zoom: 6.2 }, MALACCA: { center: [100.5, 3.3], zoom: 5 }, BALTIC: { center: [26, 59.8], zoom: 5.6 }, BLACKSEA: { center: [35, 43.5], zoom: 4.8 },
  CUSHING: { center: [-96.77, 35.98], zoom: 8 }, USGC: { center: [-94, 28.5], zoom: 5.4 }, CAPE: { center: [18.5, -34.4], zoom: 5 }, WORLD: { center: [48, 24], zoom: 1.6 },
  YANBU: { center: [38.1, 24.1], zoom: 7 }, FUJAIRAH: { center: [56.3, 25.2], zoom: 7.5 }, KHARG: { center: [50.3, 29.25], zoom: 8 }, RASTANURA: { center: [50.2, 26.7], zoom: 8.5 },
  PRIMORSK: { center: [28.6, 60.3], zoom: 8 }, NOVOROSSIYSK: { center: [37.75, 44.68], zoom: 8.5 },
};

export function flyToPlace(H, name) {
  const key = String(name || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!key) return false;
  let target = PLACES[key];
  if (!target) {
    const p = POINTS.find((x) => x.name.toUpperCase().replace(/[^A-Z]/g, "").includes(key)) || CHOKEPOINTS.find((x) => x.name.toUpperCase().replace(/[^A-Z]/g, "").includes(key));
    if (p) target = { center: [p.lon, p.lat], zoom: 7 };
  }
  if (!target) return false;
  H.map.flyTo({ ...target, speed: 1.4, essential: true });
  return true;
}

export { health };
