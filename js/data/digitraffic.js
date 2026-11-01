// Digitraffic (Fintraffic) open AIS: every vessel seen by Finnish shore
// stations, which covers most of the Gulf of Finland — including the approaches
// to Russia's Primorsk, Ust-Luga and Vysotsk crude and product terminals.

import { getJSON } from "../core/fetcher.js";
import { haversineKm } from "../core/stats.js";

const BASE = "https://meri.digitraffic.fi/api/ais/v1";

export const TERMINALS = [
  { id: "primorsk", name: "Primorsk (RU)", lat: 60.34, lon: 28.72, kind: "crude", note: "Transneft crude/diesel export terminal, Baltic Pipeline System" },
  { id: "ustluga", name: "Ust-Luga (RU)", lat: 59.68, lon: 28.4, kind: "crude", note: "Crude, fuel oil and products; BPS-2 terminus" },
  { id: "vysotsk", name: "Vysotsk (RU)", lat: 60.63, lon: 28.57, kind: "products", note: "Lukoil products terminal" },
  { id: "spb", name: "St Petersburg (RU)", lat: 59.88, lon: 30.21, kind: "products", note: "Petersburg Oil Terminal" },
  { id: "porvoo", name: "Porvoo / Sköldvik (FI)", lat: 60.31, lon: 25.55, kind: "refinery", note: "Neste refinery jetty" },
  { id: "muuga", name: "Muuga / Tallinn (EE)", lat: 59.5, lon: 25.0, kind: "products", note: "Products terminal" },
];

// Maritime Identification Digits -> flag (common registries)
const MID = {
  201: "Albania", 205: "Belgium", 209: "Cyprus", 210: "Cyprus", 211: "Germany", 212: "Cyprus", 215: "Malta", 218: "Germany", 219: "Denmark", 220: "Denmark",
  224: "Spain", 225: "Spain", 226: "France", 227: "France", 228: "France", 229: "Malta", 230: "Finland", 231: "Faroe Is.", 232: "UK", 233: "UK", 234: "UK", 235: "UK",
  236: "Gibraltar", 237: "Greece", 238: "Croatia", 239: "Greece", 240: "Greece", 241: "Greece", 244: "Netherlands", 245: "Netherlands", 246: "Netherlands", 247: "Italy",
  248: "Malta", 249: "Malta", 250: "Ireland", 255: "Portugal (Madeira)", 256: "Malta", 257: "Norway", 258: "Norway", 259: "Norway", 261: "Poland", 265: "Sweden", 266: "Sweden",
  271: "Türkiye", 272: "Ukraine", 273: "Russia", 275: "Latvia", 276: "Estonia", 277: "Lithuania", 304: "Antigua & Barbuda", 305: "Antigua & Barbuda", 308: "Bahamas",
  309: "Bahamas", 311: "Bahamas", 312: "Belize", 314: "Barbados", 316: "Canada", 319: "Cayman Is.", 334: "Honduras", 338: "USA", 341: "St Kitts & Nevis", 351: "Panama",
  352: "Panama", 353: "Panama", 354: "Panama", 355: "Panama", 356: "Panama", 357: "Panama", 366: "USA", 367: "USA", 368: "USA", 369: "USA", 370: "Panama", 371: "Panama",
  372: "Panama", 373: "Panama", 374: "Panama", 375: "St Vincent", 376: "St Vincent", 377: "St Vincent", 403: "Saudi Arabia", 412: "China", 413: "China", 414: "China",
  419: "India", 422: "Iran", 425: "Iraq", 447: "Kuwait", 457: "Mongolia", 461: "Oman", 466: "Qatar", 470: "UAE", 471: "UAE", 477: "Hong Kong", 511: "Palau",
  518: "Cook Is.", 538: "Marshall Is.", 548: "Philippines", 563: "Singapore", 564: "Singapore", 565: "Singapore", 566: "Singapore", 572: "Tuvalu", 576: "Vanuatu",
  577: "Vanuatu", 610: "Benin", 613: "Cameroon", 616: "Comoros", 620: "Comoros", 621: "Djibouti", 626: "Gabon", 627: "Ghana", 630: "Guinea-Bissau", 636: "Liberia",
  637: "Liberia", 657: "Nigeria", 667: "Sierra Leone", 668: "São Tomé & Príncipe", 671: "Togo", 674: "Tanzania", 677: "Tanzania",
};
// Registries the ITF lists as flags of convenience, plus registries widely used
// by the sanctions-evading fleet since 2022 (statistics only — never a verdict on a ship).
const FOC = new Set(["Antigua & Barbuda", "Bahamas", "Barbados", "Belize", "Cayman Is.", "Comoros", "Cook Is.", "Cyprus", "Gibraltar", "Honduras", "Liberia", "Malta", "Marshall Is.",
  "Mongolia", "Panama", "St Kitts & Nevis", "St Vincent", "Vanuatu", "Tuvalu", "Palau", "Gabon", "Cameroon", "Sierra Leone", "Togo", "Benin", "Djibouti", "Guinea-Bissau", "São Tomé & Príncipe", "Tanzania"]);

export const flagOf = (mmsi) => MID[Math.floor(+mmsi / 1e6)] || "Other";
export const isFoc = (flag) => FOC.has(flag);

export function sizeClass(len) {
  if (!(len > 0)) return "Unknown";
  if (len < 150) return "Coastal / small";
  if (len < 200) return "MR / Handy";
  if (len < 235) return "LR1 / Panamax";
  if (len < 255) return "Aframax / LR2";
  if (len < 290) return "Suezmax";
  return "VLCC";
}

/** draught / length heuristic. Typical full draught is ~6% of length for tankers. */
export function ladenState(draughtM, len) {
  if (!(draughtM > 0) || !(len > 0)) return "unknown";
  const r = draughtM / len;
  if (r >= 0.045) return "laden";
  if (r <= 0.036) return "ballast";
  return "part";
}

export function decodeEta(eta) {
  if (!eta) return null;
  const month = (eta >> 16) & 0xf, day = (eta >> 11) & 0x1f, hour = (eta >> 6) & 0x1f, minute = eta & 0x3f;
  if (!month || !day || hour > 23 || minute > 59) return null;
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const NAV = { 0: "Under way", 1: "At anchor", 2: "Not under command", 3: "Restricted", 4: "Draught-constrained", 5: "Moored", 6: "Aground", 7: "Fishing", 8: "Sailing", 15: "—" };
export const navText = (s) => NAV[s] ?? "—";

export async function tankers() {
  const [meta, loc] = await Promise.all([
    getJSON(`${BASE}/vessels`, { ttl: 30 * 60e3, source: "ais", persist: true, timeout: 25e3 }),
    getJSON(`${BASE}/locations`, { ttl: 75e3, source: "ais", timeout: 25e3 }),
  ]);
  const byMmsi = new Map((meta || []).map((v) => [v.mmsi, v]));
  const out = [];
  const now = Date.now();
  for (const f of loc?.features || []) {
    const v = byMmsi.get(f.mmsi);
    if (!v || !(v.shipType >= 80 && v.shipType <= 89)) continue;
    const [lon, lat] = f.geometry?.coordinates || [];
    if (!Number.isFinite(lat)) continue;
    const p = f.properties || {};
    const len = (v.referencePointA || 0) + (v.referencePointB || 0);
    const beam = (v.referencePointC || 0) + (v.referencePointD || 0);
    const draught = v.draught > 0 ? v.draught / 10 : NaN;
    const flag = flagOf(v.mmsi);
    const ageMin = p.timestampExternal ? (now - p.timestampExternal) / 60000 : NaN;
    if (ageMin > 6 * 60) continue; // last position more than 6 hours old: the ship has left coverage
    const near = TERMINALS.map((t) => ({ t, d: haversineKm(lat, lon, t.lat, t.lon) })).sort((a, b) => a.d - b.d)[0];
    out.push({
      mmsi: v.mmsi, imo: v.imo || null, name: (v.name || "").trim() || String(v.mmsi), callSign: v.callSign,
      lat, lon, sog: p.sog, cog: p.cog, heading: p.heading === 511 ? null : p.heading, nav: p.navStat, navText: navText(p.navStat),
      len, beam, draught, size: sizeClass(len), laden: ladenState(draught, len),
      flag, foc: isFoc(flag), dest: (v.destination || "").trim(), eta: decodeEta(v.eta), shipType: v.shipType,
      nearest: near ? near.t.name : "", nearestId: near ? near.t.id : "", nearestKm: near ? near.d : NaN, ageMin,
    });
  }
  return out;
}

/** Aggregates per terminal and for westbound laden departures from Russian ports. */
export function summarise(list) {
  const per = TERMINALS.map((t) => {
    const near = list.filter((v) => haversineKm(v.lat, v.lon, t.lat, t.lon) < 20);
    return {
      ...t, total: near.length,
      anchored: near.filter((v) => v.nav === 1).length,
      moored: near.filter((v) => v.nav === 5).length,
      laden: near.filter((v) => v.laden === "laden").length,
    };
  });
  const ruEast = list.filter((v) => v.lon > 26.5 && v.lat > 59.3 && v.lat < 60.8);
  const departing = ruEast.filter((v) => v.sog > 4 && v.cog >= 200 && v.cog <= 300 && v.laden === "laden" && !/^FI|^EE/.test(v.dest));
  const flags = {};
  for (const v of list) flags[v.flag] = (flags[v.flag] || 0) + 1;
  return {
    per, departing, total: list.length,
    laden: list.filter((v) => v.laden === "laden").length,
    ballast: list.filter((v) => v.laden === "ballast").length,
    focShare: list.length ? list.filter((v) => v.foc).length / list.length : NaN,
    flags: Object.entries(flags).sort((a, b) => b[1] - a[1]),
    large: list.filter((v) => v.len >= 235).length,
  };
}
