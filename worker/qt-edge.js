/**
 * QuinTerminal edge proxy — a Cloudflare Worker (free tier is plenty).
 *
 * Some public data sources do not send the CORS headers a browser needs
 * (Yahoo Finance, adsb.lol, most RSS feeds, NASA FIRMS). This worker fetches
 * them on the browser's behalf, but ONLY for the hosts on the allow-list below,
 * caches the answer for a host-specific time and adds CORS headers.
 *
 *   GET /health                         → {"ok":true,"version":…,"hosts":N,"firmsKey":bool}
 *   GET /?url=<encodeURIComponent(https URL)>
 *
 * Optional variables / secrets (Worker > Settings > Variables and Secrets):
 *   FIRMS_KEY        NASA FIRMS map key. Requests whose path contains
 *                    /WORKER_KEY/ get it substituted, so the key never has to
 *                    sit in the browser.
 *   ALLOWED_ORIGINS  Comma-separated origins allowed to use the proxy, e.g.
 *                    "https://yourname.github.io,http://localhost:8000".
 *                    Empty means any origin (fine for personal use; the
 *                    allow-list already prevents use as an open relay).
 */

const VERSION = "1.3.0";

// host → seconds a response stays fresh at the edge
const ALLOW = new Map([
  ["query1.finance.yahoo.com", 60],
  ["query2.finance.yahoo.com", 60],
  ["api.adsb.lol", 20],
  ["firms.modaps.eosdis.nasa.gov", 900],
  ["api.gdeltproject.org", 600],
  ["oilprice.com", 600],
  ["www.eia.gov", 900],
  ["gcaptain.com", 600],
  ["maritime-executive.com", 600],
  ["www.maritime-executive.com", 600],
  ["www.rigzone.com", 600],
  ["splash247.com", 600],
  ["www.hellenicshippingnews.com", 600],
  // IMF PortWatch sends CORS headers itself; listed only as a fallback for networks that block ArcGIS
  ["services9.arcgis.com", 3600],
]);

const MAX_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 25_000;
// Yahoo rejects requests without a browser-like user agent.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Per-isolate memory cache. The Cache API is a no-op on *.workers.dev, so this
// is what actually saves upstream calls there; on a custom domain both apply.
const mem = new Map(); // key → { t, ttl, body: ArrayBuffer, type, status }
const MEM_MAX = 150;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const originOk = !allowed.length || allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": allowed.length ? (originOk ? origin : allowed[0]) : "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return json({ error: "Only GET is supported" }, 405, cors);

    const self = new URL(request.url);
    if (self.pathname === "/health") {
      return json({ ok: true, version: VERSION, hosts: ALLOW.size, firmsKey: Boolean(env.FIRMS_KEY), originRestricted: allowed.length > 0 }, 200, cors);
    }
    if (!originOk) return json({ error: "Origin not allowed", origin }, 403, cors);

    const raw = self.searchParams.get("url");
    if (!raw) return json({ error: "Missing url parameter", usage: "/?url=<encoded https URL>", hosts: [...ALLOW.keys()] }, 400, cors);

    let target;
    try { target = new URL(raw); } catch { return json({ error: "Not a valid URL" }, 400, cors); }
    if (target.protocol !== "https:") return json({ error: "Only https URLs are proxied" }, 400, cors);
    if (target.username || target.password || target.port) return json({ error: "Credentials and custom ports are not allowed" }, 400, cors);
    const ttl = ALLOW.get(target.hostname);
    if (ttl === undefined) return json({ error: `Host not on the allow-list: ${target.hostname}` }, 403, cors);

    // key injection (the cache key keeps the placeholder, never the secret)
    const cacheId = target.toString();
    if (target.hostname === "firms.modaps.eosdis.nasa.gov" && target.pathname.includes("/WORKER_KEY/")) {
      if (!env.FIRMS_KEY) return json({ error: "No FIRMS key: add a FIRMS_KEY secret to the worker or enter a key in QuinTerminal's settings" }, 400, cors);
      target.pathname = target.pathname.replace("/WORKER_KEY/", "/" + encodeURIComponent(env.FIRMS_KEY) + "/");
    }

    // 1) isolate memory
    const m = mem.get(cacheId);
    if (m && Date.now() - m.t < m.ttl * 1000) return respond(m.body, m.type, m.status, ttl, "MEM", cors);

    // 2) edge cache (custom domains only)
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const edgeKey = new Request("https://qt-edge.invalid/" + encodeURIComponent(cacheId));
    if (cache) {
      try {
        const hit = await cache.match(edgeKey);
        if (hit) {
          const body = await hit.arrayBuffer();
          remember(cacheId, body, hit.headers.get("Content-Type"), hit.status, ttl);
          return respond(body, hit.headers.get("Content-Type"), hit.status, ttl, "EDGE", cors);
        }
      } catch { /* cache unavailable */ }
    }

    // 3) upstream
    let up;
    try {
      up = await fetch(target.toString(), {
        headers: {
          "User-Agent": UA,
          "Accept": target.hostname.includes("yahoo") || target.hostname.includes("adsb") || target.hostname.includes("gdelt") ? "application/json,text/plain,*/*" : "application/rss+xml,application/atom+xml,application/xml,text/xml,text/csv,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.8",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cf: { cacheTtl: ttl, cacheEverything: true },
      });
    } catch (e) {
      // serve an expired copy rather than nothing
      if (m) return respond(m.body, m.type, m.status, ttl, "STALE", cors);
      return json({ error: "Upstream unreachable", detail: String(e && e.message || e) }, 502, cors);
    }

    // a redirect must not leave the allow-list
    const finalHost = new URL(up.url || target.toString()).hostname;
    if (!ALLOW.has(finalHost)) return json({ error: `Upstream redirected off the allow-list to ${finalHost}` }, 502, cors);

    const len = Number(up.headers.get("Content-Length") || 0);
    if (len > MAX_BYTES) return json({ error: "Upstream response too large", bytes: len }, 502, cors);
    const body = await up.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return json({ error: "Upstream response too large", bytes: body.byteLength }, 502, cors);
    const type = up.headers.get("Content-Type") || "application/octet-stream";

    if (!up.ok) {
      if (m) return respond(m.body, m.type, m.status, ttl, "STALE", cors);
      return respond(body, type, up.status, 0, "MISS", cors);
    }

    remember(cacheId, body, type, up.status, ttl);
    if (cache) {
      const toStore = new Response(body.slice(0), { status: up.status, headers: { "Content-Type": type, "Cache-Control": `public, max-age=${ttl}` } });
      ctx.waitUntil(cache.put(edgeKey, toStore).catch(() => {}));
    }
    return respond(body, type, up.status, ttl, "MISS", cors);
  },
};

function remember(key, body, type, status, ttl) {
  if (body.byteLength > 1.5 * 1024 * 1024) return;
  if (mem.size >= MEM_MAX) mem.delete(mem.keys().next().value);
  mem.set(key, { t: Date.now(), ttl, body: body.slice(0), type, status });
}

function respond(body, type, status, ttl, how, cors) {
  return new Response(body.slice(0), {
    status,
    headers: {
      ...cors,
      "Content-Type": type || "application/octet-stream",
      "Cache-Control": ttl ? `public, max-age=${ttl}` : "no-store",
      "X-QT-Cache": how,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
