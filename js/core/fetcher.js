// One door for every HTTP request: caching (memory + IndexedDB), request
// de-duplication, per-host pacing (GDELT allows one call every 5 s), timeouts,
// stale-on-error fallback, optional routing through the user's edge proxy,
// and health reporting.

import { settings, proxyOn } from "./settings.js";
import * as health from "./health.js";
import * as idb from "./idb.js";

const mem = new Map();          // key -> { t, data }
const inflight = new Map();     // key -> Promise
const metaByKey = new Map();    // key -> { t, stale, ms, via }

const HOST_RULES = {
  "api.gdeltproject.org": { max: 1, gap: 5600 },
  "api.eia.gov": { max: 2, gap: 300 },
  "clob.polymarket.com": { max: 3, gap: 120 },
  "gamma-api.polymarket.com": { max: 4, gap: 80 },
  "wikimedia.org": { max: 4, gap: 60 },
  default: { max: 6, gap: 0 },
};
const lanes = new Map();

function lane(host) {
  if (!lanes.has(host)) {
    const rule = HOST_RULES[host] || HOST_RULES.default;
    lanes.set(host, { ...rule, active: 0, last: 0, q: [] });
  }
  return lanes.get(host);
}

function schedule(host, task) {
  const L = lane(host);
  return new Promise((resolve, reject) => {
    L.q.push({ task, resolve, reject });
    pump(L);
  });
}

function pump(L) {
  if (!L.q.length || L.active >= L.max) return;
  const wait = Math.max(0, L.last + L.gap - Date.now());
  if (wait > 0) { setTimeout(() => pump(L), wait + 5); return; }
  const job = L.q.shift();
  L.active++;
  L.last = Date.now();
  job.task().then(job.resolve, job.reject).finally(() => { L.active--; pump(L); });
  if (L.q.length) pump(L);
}

export function proxied(url) {
  const base = settings.proxyUrl.replace(/\/+$/, "");
  return `${base}/?url=${encodeURIComponent(url)}`;
}

async function rawFetch(url, { as, timeout, init }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("Timed out", "TimeoutError")), timeout);
  const t0 = performance.now();
  try {
    const r = await fetch(url, { cache: "no-store", ...init, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = as === "text" ? await r.text() : as === "blob" ? await r.blob() : await r.json();
    return { data, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    if (e?.name === "AbortError" || e?.name === "TimeoutError") throw new Error(`Timed out after ${Math.round(timeout / 1000)} s`);
    if (e instanceof TypeError) throw new Error("Blocked or unreachable (network/CORS)");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fetchData(url, {
 *   ttl: ms the cached copy stays fresh,
 *   key: cache key (defaults to url),
 *   as: "json" | "text",
 *   timeout: ms,
 *   source: health source id,
 *   persist: true to keep a copy in IndexedDB (survives reloads),
 *   via: "direct" | "proxy" | "auto" (auto = direct, then proxy if configured),
 *   init: fetch init (method, headers, body),
 * })
 */
export async function fetchData(url, opts = {}) {
  const { ttl = 60e3, key = url + (opts.init?.body || ""), as = "json", timeout = 20e3, source, persist = false, via = "direct", init } = opts;

  const m = mem.get(key);
  if (m && Date.now() - m.t < ttl) return m.data;

  if (persist) {
    const p = await idb.get("c:" + key);
    if (p && Date.now() - p.t < ttl) {
      mem.set(key, p);
      metaByKey.set(key, { t: p.t, stale: false, via: "cache" });
      if (source) health.report(source, { ok: true, ms: 0, note: "from cache" });
      return p.data;
    }
  }

  if (inflight.has(key)) return inflight.get(key);

  const run = (async () => {
    let target = url;
    let mode = via;
    if (via === "proxy") {
      if (!proxyOn()) throw new Error("Needs the edge proxy (Settings > Edge proxy)");
      target = proxied(url);
    }
    const host = new URL(target).host;
    try {
      const { data, ms } = await schedule(host, () => rawFetch(target, { as, timeout, init }));
      const rec = { t: Date.now(), data };
      mem.set(key, rec);
      if (persist) idb.set("c:" + key, rec);
      metaByKey.set(key, { t: rec.t, stale: false, ms, via: mode });
      if (source) health.report(source, { ok: true, ms });
      return data;
    } catch (err) {
      if (via === "auto" && proxyOn()) {
        try {
          const pu = proxied(url);
          const { data, ms } = await schedule(new URL(pu).host, () => rawFetch(pu, { as, timeout, init }));
          const rec = { t: Date.now(), data };
          mem.set(key, rec);
          if (persist) idb.set("c:" + key, rec);
          metaByKey.set(key, { t: rec.t, stale: false, ms, via: "proxy" });
          if (source) health.report(source, { ok: true, ms, note: "via edge proxy" });
          return data;
        } catch (e2) {
          err = e2;
        }
      }
      // stale-on-error
      const old = mem.get(key) || (persist ? await idb.get("c:" + key) : null);
      if (old) {
        metaByKey.set(key, { t: old.t, stale: true, via: "cache" });
        if (source) health.report(source, { ok: true, stale: true, note: "showing cached copy: " + err.message });
        return old.data;
      }
      if (source) health.report(source, { ok: false, err: err.message });
      throw err;
    }
  })();

  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

export const getJSON = (url, opts = {}) => fetchData(url, { ...opts, as: "json" });
export const getText = (url, opts = {}) => fetchData(url, { ...opts, as: "text" });
export const postJSON = (url, body, opts = {}) =>
  fetchData(url, { ...opts, as: "json", init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } });

export const meta = (key) => metaByKey.get(key) || null;

export function dropMemoryCache() {
  mem.clear();
}

/** Minimal CSV parser (quoted fields, commas, newlines inside quotes). */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
