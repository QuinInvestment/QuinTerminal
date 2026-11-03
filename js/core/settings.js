// Persisted per-browser preferences. Keys and the proxy URL never leave the
// browser except as part of the requests the user asked for.

const KEY = "qt:v3:settings";

export const DEFAULTS = {
  theme: "night",
  module: "OIL",
  eiaKey: "",
  proxyUrl: "",
  firmsKey: "",
  crisisStart: "2026-02-28", // start of the Hormuz disruption, used by HRMZ
  notifications: false,
  alertRules: [
    { id: "brent-hi", sym: "BRENT", op: ">", value: 120, on: true },
    { id: "brent-lo", sym: "BRENT", op: "<", value: 95, on: true },
    { id: "wti-hi", sym: "WTI", op: ">", value: 110, on: true },
  ],
  scenario: null,
  chart: { market: "CL", interval: "15m" },
  fcst: { instrument: "BRENT", horizon: 21 },
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const s = JSON.parse(raw);
    return { ...structuredClone(DEFAULTS), ...s, chart: { ...DEFAULTS.chart, ...(s.chart || {}) }, fcst: { ...DEFAULTS.fcst, ...(s.fcst || {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const settings = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
}

export function set(key, value) {
  settings[key] = value;
  save();
}

export function reset() {
  try { localStorage.removeItem(KEY); } catch {}
  Object.assign(settings, structuredClone(DEFAULTS));
}

export const proxyOn = () => /^https:\/\//i.test(settings.proxyUrl || "");
