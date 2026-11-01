// Open-Meteo marine and wind forecasts at export terminals. Single-point
// mooring (SPM) loadings stop in heavy seas — CPC at Novorossiysk, Basra,
// the Libyan ports and Primorsk lose cargoes to weather every winter.

import { getJSON } from "../core/fetcher.js";

/** sea points next to each terminal; limits are typical operating cut-offs (heuristic) */
export const WX_TERMINALS = [
  { id: "cpc", name: "CPC terminal, Novorossiysk", lat: 44.62, lon: 37.72, hs: 2.5, gust: 35, note: "SPM loading; storms halt CPC Blend loadings" },
  { id: "novo", name: "Sheskharis, Novorossiysk", lat: 44.68, lon: 37.84, hs: 2.5, gust: 40, note: "Urals loading, bora winds" },
  { id: "primorsk", name: "Primorsk", lat: 60.25, lon: 28.55, hs: 2.0, gust: 35, note: "Baltic winter ice and storms" },
  { id: "ceyhan", name: "Ceyhan", lat: 36.82, lon: 35.85, hs: 2.5, gust: 40, note: "Iraqi/Kurdish and Azeri crude" },
  { id: "essider", name: "Es Sider", lat: 30.68, lon: 18.32, hs: 2.5, gust: 35, note: "Libyan ports close in winter gales" },
  { id: "basra", name: "Basra Oil Terminal", lat: 29.66, lon: 48.83, hs: 2.0, gust: 35, note: "SPMs; shamal winds" },
  { id: "rastanura", name: "Ras Tanura", lat: 26.72, lon: 50.24, hs: 2.5, gust: 40, note: "Inside Hormuz" },
  { id: "fujairah", name: "Fujairah", lat: 25.16, lon: 56.45, hs: 3.0, gust: 40, note: "ADCOP outlet, bunkering hub" },
  { id: "yanbu", name: "Yanbu", lat: 24.03, lon: 37.95, hs: 3.0, gust: 40, note: "East-West pipeline outlet" },
  { id: "bonny", name: "Bonny offshore", lat: 4.25, lon: 7.1, hs: 3.0, gust: 40, note: "Nigerian crude" },
  { id: "corpus", name: "Corpus Christi approach", lat: 27.75, lon: -97.0, hs: 3.0, gust: 40, note: "Largest US crude export port" },
  { id: "loop", name: "LOOP", lat: 28.88, lon: -90.02, hs: 3.0, gust: 40, note: "US Gulf deepwater port" },
  { id: "sullom", name: "Sullom Voe", lat: 60.5, lon: -1.2, hs: 4.0, gust: 45, note: "North Sea" },
  { id: "kozmino", name: "Kozmino", lat: 42.7, lon: 133.05, hs: 2.5, gust: 40, note: "ESPO blend" },
];

const pad = (a) => a.map((x) => x.toFixed(2)).join(",");

export async function portWeather() {
  const lats = pad(WX_TERMINALS.map((t) => t.lat)), lons = pad(WX_TERMINALS.map((t) => t.lon));
  const [marine, wind] = await Promise.all([
    getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&hourly=wave_height,swell_wave_height&forecast_days=3&timezone=UTC`, { ttl: 30 * 60e3, source: "meteo", timeout: 20e3 }),
    getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=wind_speed_10m,wind_gusts_10m&wind_speed_unit=kn&forecast_days=3&timezone=UTC`, { ttl: 30 * 60e3, source: "meteo", timeout: 20e3 }),
  ]);
  const M = Array.isArray(marine) ? marine : [marine];
  const W = Array.isArray(wind) ? wind : [wind];
  const nowIso = new Date().toISOString().slice(0, 13);
  return WX_TERMINALS.map((t, i) => {
    const m = M[i]?.hourly || {}, w = W[i]?.hourly || {};
    const times = m.time || w.time || [];
    let k = times.findIndex((x) => x.slice(0, 13) >= nowIso);
    if (k < 0) k = 0;
    const win = (arr) => (arr || []).slice(k, k + 48).filter((x) => x != null);
    const hsWin = win(m.wave_height), gWin = win(w.wind_gusts_10m);
    const hsNow = m.wave_height?.[k], gustNow = w.wind_gusts_10m?.[k], windNow = w.wind_speed_10m?.[k];
    const hsMax = hsWin.length ? Math.max(...hsWin) : NaN, gMax = gWin.length ? Math.max(...gWin) : NaN;
    let risk = "ok";
    if (hsMax > t.hs || gMax > t.gust) risk = "risk";
    if (hsNow > t.hs || gustNow > t.gust) risk = "stop";
    const hoursOver = hsWin.filter((x) => x > t.hs).length;
    return { ...t, hsNow, hsMax, gustNow, gMax, windNow, risk, hoursOver, series: (m.wave_height || []).slice(k, k + 48) };
  });
}
