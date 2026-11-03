// Registry of every data source and its live health. The status bar, the
// health pill and the SYS function all read from here.

import { pub } from "./bus.js";

export const SOURCES = {
  hl:        { name: "Hyperliquid perps", what: "WTI, Brent, heating oil, gas, gold, S&P 500, FX — 24/7 trades, book, candles", kind: "stream", needs: "none", docs: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api" },
  eia:       { name: "U.S. EIA API v2", what: "Weekly petroleum status, crude and product spot prices, Short-Term Energy Outlook (world balance, OPEC capacity, outages)", kind: "rest", needs: "free key (DEMO_KEY works with low limits)", docs: "https://www.eia.gov/opendata/" },
  cftc:      { name: "CFTC Commitments of Traders", what: "Disaggregated futures positioning, weekly", kind: "rest", needs: "none", docs: "https://publicreporting.cftc.gov/" },
  portwatch: { name: "IMF PortWatch", what: "Daily ship and tanker transits through the world's maritime chokepoints (AIS)", kind: "rest", needs: "none", docs: "https://portwatch.imf.org/" },
  straits:   { name: "straits.live", what: "Hormuz status, IMF PortWatch transits, incidents, insurance", kind: "rest", needs: "none", docs: "https://straits.live/data" },
  poly:      { name: "Polymarket", what: "Event probabilities and their history", kind: "rest", needs: "none", docs: "https://docs.polymarket.com/" },
  ais:       { name: "Digitraffic AIS", what: "Live vessel positions in Finnish waters, Gulf of Finland", kind: "rest", needs: "none", docs: "https://www.digitraffic.fi/en/marine-traffic/" },
  meteo:     { name: "Open-Meteo", what: "Wave and wind forecasts at export terminals", kind: "rest", needs: "none", docs: "https://open-meteo.com/en/docs/marine-weather-api" },
  gdacs:     { name: "GDACS", what: "Tropical cyclones and disaster alerts", kind: "rest", needs: "none", docs: "https://www.gdacs.org/" },
  eonet:     { name: "NASA EONET", what: "Storms, wildfires and volcanoes", kind: "rest", needs: "none", docs: "https://eonet.gsfc.nasa.gov/" },
  wiki:      { name: "Wikimedia pageviews", what: "Public attention on chokepoints and oil topics", kind: "rest", needs: "none", docs: "https://wikimedia.org/api/rest_v1/" },
  gdelt:     { name: "GDELT DOC 2.0", what: "Global news search and coverage timelines (slow, best effort)", kind: "rest", needs: "none", docs: "https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/" },
  fx:        { name: "Frankfurter (ECB)", what: "FX reference rates for oil in local currency", kind: "rest", needs: "none", docs: "https://frankfurter.dev/" },
  basemap:   { name: "CARTO basemap", what: "Vector map tiles", kind: "tiles", needs: "none", docs: "https://carto.com/basemaps" },
  gibs:      { name: "NASA GIBS", what: "Daily satellite imagery and night lights", kind: "tiles", needs: "none", docs: "https://nasa-gibs.github.io/gibs-api-docs/" },
  tv:        { name: "TradingView widgets", what: "Reference charts for exchange-listed symbols", kind: "embed", needs: "none", docs: "https://www.tradingview.com/widget/" },
  yahoo:     { name: "Yahoo Finance", what: "Full WTI/Brent futures strips, OVX, energy equities", kind: "rest", needs: "edge proxy", docs: "docs/DATA_SOURCES.md" },
  adsb:      { name: "adsb.lol", what: "Military and state aircraft (ADS-B)", kind: "rest", needs: "edge proxy", docs: "https://api.adsb.lol/docs" },
  rss:       { name: "Energy & shipping RSS", what: "OilPrice, EIA, gCaptain, Maritime Executive, Rigzone", kind: "rest", needs: "edge proxy", docs: "docs/DATA_SOURCES.md" },
  firms:     { name: "NASA FIRMS", what: "Satellite fire detections near refineries and terminals", kind: "rest", needs: "edge proxy + free map key", docs: "https://firms.modaps.eosdis.nasa.gov/api/" },
  archive:   { name: "QuinTerminal daily archive", what: "EIA mirror (weekly, spot, STEO, product prices), futures curve, Baltic tanker counts and the terminal's own forecasts, saved each weekday by GitHub Actions", kind: "rest", needs: "the Daily snapshot workflow on your copy", docs: "docs/DATA_SOURCES.md" },
};

const status = new Map();

export function report(id, { ok, ms, err, stale = false, note } = {}) {
  const prev = status.get(id) || { count: 0, fails: 0 };
  const now = Date.now();
  const next = {
    ...prev,
    lastTry: now,
    ms: ms ?? prev.ms,
    count: prev.count + 1,
    // a success without its own note clears the old one ("showing cached copy" must not outlive the outage)
    note: note !== undefined ? note : ok ? null : prev.note,
  };
  if (ok) {
    next.state = stale ? "stale" : "ok";
    next.lastOk = now;
    next.err = null;
    next.fails = 0;
  } else {
    next.fails = (prev.fails || 0) + 1;
    next.err = err ? String(err).slice(0, 180) : "Request failed";
    next.state = prev.lastOk && now - prev.lastOk < 30 * 60e3 ? "stale" : "err";
  }
  status.set(id, next);
  queueEmit();
}

export function setState(id, state, note) {
  const prev = status.get(id) || { count: 0 };
  status.set(id, { ...prev, state, note: note ?? prev.note, lastTry: Date.now(), ...(state === "ok" ? { lastOk: Date.now() } : {}) });
  queueEmit();
}

export function get(id) {
  return status.get(id) || { state: "idle" };
}

export function list() {
  return Object.entries(SOURCES).map(([id, meta]) => ({ id, ...meta, ...(status.get(id) || { state: "idle" }) }));
}

export function summary() {
  const s = { ok: 0, stale: 0, err: 0, off: 0, idle: 0 };
  for (const r of list()) s[r.state in s ? r.state : "idle"]++;
  return s;
}

let pending = false;
function queueEmit() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    pub("health", summary());
  });
}
