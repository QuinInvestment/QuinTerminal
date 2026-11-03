// Natural hazards near oil infrastructure: GDACS (tropical cyclones and
// disaster alerts) and NASA EONET (storms, wildfires, volcanoes).

import { getJSON } from "../core/fetcher.js";
import { haversineKm } from "../core/stats.js";
import { POINTS } from "./static/infrastructure.js";

export async function gdacs() {
  const from = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10);
  const j = await getJSON(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC;EQ;VO;FL&alertlevel=Green;Orange;Red&fromDate=${from}`, { ttl: 20 * 60e3, source: "gdacs", timeout: 25e3 });
  return (j?.features || []).map((f) => {
    const p = f.properties || {};
    const [lon, lat] = f.geometry?.coordinates || [];
    return {
      src: "GDACS", id: `${p.eventtype}-${p.eventid}`, type: p.eventtype, name: p.eventname || p.name || p.eventtype,
      level: p.alertlevel, lat, lon, from: p.fromdate, to: p.todate, current: p.iscurrent === "true" || p.iscurrent === true,
      severity: p.severitydata?.severitytext || "", country: p.country || "", url: p.url?.report || p.url?.details || "",
    };
  }).filter((x) => Number.isFinite(x.lat));
}

export async function eonet() {
  const j = await getJSON("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=severeStorms,wildfires,volcanoes&days=20&limit=400", { ttl: 20 * 60e3, source: "eonet", timeout: 25e3 });
  return (j?.events || []).map((e) => {
    const g = (e.geometry || []).filter((x) => x.type === "Point").pop();
    if (!g) return null;
    return { src: "EONET", id: e.id, type: e.categories?.[0]?.id || "event", name: e.title, lat: g.coordinates[1], lon: g.coordinates[0], from: g.date, url: e.sources?.[0]?.url || e.link };
  }).filter(Boolean);
}

/** Attach the nearest piece of infrastructure and flag what is close. */
export function nearInfra(hazards) {
  const assets = POINTS.filter((p) => p.cat !== "field" || p.cap >= 500);
  return hazards.map((hz) => {
    let best = null;
    for (const a of assets) {
      const d = haversineKm(hz.lat, hz.lon, a.lat, a.lon);
      if (!best || d < best.d) best = { a, d };
    }
    const radius = hz.type === "TC" || hz.type === "severeStorms" ? 400 : hz.type === "wildfires" ? 40 : 150;
    return { ...hz, nearest: best?.a?.name || "", nearestCat: best?.a?.cat || "", km: best?.d ?? NaN, exposed: best ? best.d <= radius : false, radius };
  }).sort((a, b) => (b.exposed - a.exposed) || (a.km - b.km));
}
