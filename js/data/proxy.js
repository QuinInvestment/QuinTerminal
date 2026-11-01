// Sources that need the optional edge proxy (worker/qt-edge.js on Cloudflare,
// free tier): Yahoo Finance (full futures strips, OVX, equities), adsb.lol
// military aircraft, RSS feeds and NASA FIRMS fire detections.

import { getJSON, getText, parseCSV } from "../core/fetcher.js";
import { settings, proxyOn } from "../core/settings.js";
import { upcoming } from "../core/contracts.js";

const need = () => { if (!proxyOn()) throw new Error("Needs the edge proxy (Settings > Edge proxy)"); };

// ---------------------------------------------------------------- Yahoo Finance
export async function yahooChart(symbol, { range = "1mo", interval = "1d" } = {}) {
  need();
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const j = await getJSON(u, { ttl: 5 * 60e3, source: "yahoo", via: "proxy", timeout: 20e3 });
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || "No data");
  const ts = r.timestamp || [];
  const close = r.indicators?.quote?.[0]?.close || [];
  return {
    symbol, price: r.meta?.regularMarketPrice, prev: r.meta?.chartPreviousClose ?? r.meta?.previousClose, time: (r.meta?.regularMarketTime || 0) * 1000,
    currency: r.meta?.currency, name: r.meta?.shortName || r.meta?.longName || symbol,
    series: ts.map((t, i) => ({ t: t * 1000, c: close[i] })).filter((p) => p.c != null),
  };
}

export async function yahooMany(symbols, opts) {
  const out = {};
  const res = await Promise.allSettled(symbols.map((s) => yahooChart(s, opts)));
  res.forEach((r, i) => { if (r.status === "fulfilled") out[symbols[i]] = r.value; });
  return out;
}

/** Futures strip for WTI (CL) or Brent (BZ) — up to n contracts. */
export async function strip(root = "CL", n = 12) {
  const cs = upcoming(root === "CL" ? "CL" : "B", n);
  const syms = cs.map((c) => (root === "CL" ? c.yahoo : c.yahoo.replace(/^CL/, "BZ")));
  const data = await yahooMany(syms, { range: "1mo", interval: "1d" });
  return cs.map((c, i) => {
    const d = data[syms[i]];
    const series = d?.series || [];
    const at = (daysAgo) => {
      const cut = Date.now() - daysAgo * 86400000;
      const p = [...series].reverse().find((x) => x.t <= cut);
      return p ? p.c : NaN;
    };
    return { ...c, symbol: syms[i], price: d?.price ?? NaN, w1: at(7), m1: at(28) };
  }).filter((c) => Number.isFinite(c.price));
}

export const EQUITIES = [
  { s: "XOM", n: "ExxonMobil", g: "Majors" }, { s: "CVX", n: "Chevron", g: "Majors" }, { s: "SHEL", n: "Shell", g: "Majors" }, { s: "TTE", n: "TotalEnergies", g: "Majors" }, { s: "BP", n: "BP", g: "Majors" },
  { s: "2222.SR", n: "Saudi Aramco", g: "NOCs" }, { s: "EQNR", n: "Equinor", g: "NOCs" }, { s: "PBR", n: "Petrobras", g: "NOCs" },
  { s: "COP", n: "ConocoPhillips", g: "E&P" }, { s: "OXY", n: "Occidental", g: "E&P" }, { s: "XOP", n: "E&P ETF", g: "E&P" },
  { s: "VLO", n: "Valero", g: "Refiners" }, { s: "MPC", n: "Marathon Petroleum", g: "Refiners" }, { s: "PSX", n: "Phillips 66", g: "Refiners" },
  { s: "FRO", n: "Frontline", g: "Tankers" }, { s: "DHT", n: "DHT Holdings", g: "Tankers" }, { s: "TNK", n: "Teekay Tankers", g: "Tankers" }, { s: "INSW", n: "Intl Seaways", g: "Tankers" }, { s: "STNG", n: "Scorpio Tankers", g: "Tankers" },
  { s: "^OVX", n: "CBOE crude oil volatility", g: "Volatility" }, { s: "DX-Y.NYB", n: "US dollar index", g: "Macro" }, { s: "^TNX", n: "US 10Y yield ×10", g: "Macro" },
  { s: "RB=F", n: "RBOB gasoline", g: "Products" }, { s: "HO=F", n: "ULSD", g: "Products" },
];

// ---------------------------------------------------------------- military aircraft
export const AIR_REGIONS = [
  { id: "gulf", name: "Persian Gulf & Gulf of Oman", box: [47, 22, 61, 31] },
  { id: "redsea", name: "Red Sea & Gulf of Aden", box: [32, 11, 46, 30] },
  { id: "emed", name: "Eastern Mediterranean", box: [25, 30, 37, 38] },
  { id: "blacksea", name: "Black Sea", box: [27, 40, 42, 47.5] },
  { id: "baltic", name: "Baltic", box: [9, 53, 31, 66] },
];
const TYPES = [
  { kind: "Tanker", re: /^(K35R|K35E|KC46|KC10|A332|A3ST|MRTT|K30|KC30|A400|KC39)/ },
  { kind: "ISR", re: /^(R135|E3TF|E3CF|E6|E7|E8|P8|P3|E2|GLHK|Q4|RQ4|MQ9|Q9|U2|GLF5|G550|GLEX|CL60|DH8|B350|PC12|E737)/ },
  { kind: "Airlift", re: /^(C17|C5M|C5|C130|C30J|A400M|C295|IL76|AN12|AN26|KC2|C2)/ },
  { kind: "Combat", re: /^(F15|F16|F18|FA18|F35|F22|EUFI|RFAL|TOR|A10|B52|B1|B2|SU\d|MIG)/ },
];
export const acKind = (t) => (TYPES.find((x) => x.re.test(String(t || "").toUpperCase()))?.kind) || "Other";

export async function military() {
  need();
  const j = await getJSON("https://api.adsb.lol/v2/mil", { ttl: 45e3, source: "adsb", via: "proxy", timeout: 20e3 });
  const ac = (j?.ac || []).filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon));
  return ac.map((a) => {
    const region = AIR_REGIONS.find((r) => a.lon >= r.box[0] && a.lon <= r.box[2] && a.lat >= r.box[1] && a.lat <= r.box[3]);
    return { hex: a.hex, call: (a.flight || "").trim(), reg: a.r || "", type: a.t || "", kind: acKind(a.t), lat: a.lat, lon: a.lon, alt: a.alt_baro, gs: a.gs, track: a.track, region: region?.id || null, regionName: region?.name || "" };
  });
}

// ---------------------------------------------------------------- RSS
export const FEEDS = [
  { name: "OilPrice.com", url: "https://oilprice.com/rss/main" },
  { name: "EIA Today in Energy", url: "https://www.eia.gov/rss/todayinenergy.xml" },
  { name: "gCaptain", url: "https://gcaptain.com/feed/" },
  { name: "Maritime Executive", url: "https://maritime-executive.com/articles.rss" },
  { name: "Rigzone", url: "https://www.rigzone.com/news/rss/rigzone_latest.aspx" },
  { name: "Splash247", url: "https://splash247.com/feed/" },
  { name: "Hellenic Shipping News", url: "https://www.hellenicshippingnews.com/feed/" },
];

function parseFeed(xml, name) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const items = [...doc.querySelectorAll("item, entry")].slice(0, 40);
  return items.map((it) => {
    const title = (it.querySelector("title")?.textContent || "").trim();
    const linkEl = it.querySelector("link");
    const link = (linkEl?.getAttribute("href") || linkEl?.textContent || "").trim();
    const date = it.querySelector("pubDate, published, updated, dc\\:date")?.textContent || "";
    const t = Date.parse(date);
    return { title, url: link, src: name, t: Number.isFinite(t) ? t : Date.now() };
  }).filter((x) => x.title);
}

export async function rssAll() {
  need();
  const status = {};
  const items = [];
  await Promise.all(FEEDS.map(async (f) => {
    try {
      const xml = await getText(f.url, { ttl: 10 * 60e3, source: "rss", via: "proxy", timeout: 20e3 });
      items.push(...parseFeed(xml, f.name));
      status[f.name] = "ok";
    } catch {
      status[f.name] = "err";
    }
  }));
  return { items, status };
}

// ---------------------------------------------------------------- NASA FIRMS
export const FIRMS_BOXES = [
  { id: "gulf", name: "Gulf & Iraq", box: [44, 22, 60, 36] },
  { id: "redsea", name: "Red Sea & Yemen", box: [32, 12, 46, 30] },
  { id: "russia", name: "European Russia", box: [27, 43, 60, 62] },
  { id: "libya", name: "Libya", box: [9, 25, 26, 34] },
  { id: "usgc", name: "US Gulf Coast", box: [-100, 26, -88, 33] },
];

// With no key in the browser, the placeholder WORKER_KEY asks the edge proxy to
// insert its own FIRMS_KEY secret (see worker/qt-edge.js).
export async function firms() {
  need();
  const key = settings.firmsKey || "WORKER_KEY";
  const out = [];
  for (const b of FIRMS_BOXES) {
    const u = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_SNPP_NRT/${b.box.join(",")}/1`;
    const text = await getText(u, { ttl: 30 * 60e3, source: "firms", via: "proxy", timeout: 30e3 });
    if (!/^latitude/i.test(text.trim())) throw new Error(text.trim().slice(0, 120) || "Empty response from FIRMS");
    for (const r of parseCSV(text)) {
      const lat = +r.latitude, lon = +r.longitude;
      if (Number.isFinite(lat)) out.push({ lat, lon, frp: +r.frp, conf: r.confidence, date: r.acq_date, time: r.acq_time, region: b.id });
    }
  }
  return out;
}
