// Unit checks for worker/qt-edge.js with a mocked upstream (node tests/worker.test.mjs).
import assert from "node:assert/strict";
import worker from "../worker/qt-edge.js";

const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  const u = new URL(url);
  if (u.hostname === "query1.finance.yahoo.com") {
    const r = new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 71.2 } }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
    Object.defineProperty(r, "url", { value: String(url) });
    return r;
  }
  if (u.hostname === "firms.modaps.eosdis.nasa.gov") {
    const r = new Response("latitude,longitude,frp\n26.1,50.2,12.5\n", { status: 200, headers: { "Content-Type": "text/csv" } });
    Object.defineProperty(r, "url", { value: String(url) });
    return r;
  }
  if (u.hostname === "oilprice.com") {
    const r = new Response("moved", { status: 200 });
    Object.defineProperty(r, "url", { value: "https://evil.example/landing" });
    return r;
  }
  throw new Error("unexpected upstream " + url);
};

const ctx = { waitUntil() {} };
const call = (path, { env = {}, origin = "https://me.github.io", method = "GET" } = {}) =>
  worker.fetch(new Request("https://qt-edge.test" + path, { method, headers: origin ? { Origin: origin } : {} }), env, ctx);
const q = (u) => "/?url=" + encodeURIComponent(u);

let r = await call("/health", { env: { FIRMS_KEY: "k" } });
assert.equal(r.status, 200);
let j = await r.json();
assert.equal(j.ok, true); assert.equal(j.firmsKey, true); assert.ok(j.hosts > 5);
assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");

r = await call("/", {}); assert.equal(r.status, 400);
r = await call(q("https://evil.example/x")); assert.equal(r.status, 403);
r = await call(q("http://query1.finance.yahoo.com/v8/finance/chart/CL=F")); assert.equal(r.status, 400, "http rejected");
r = await call(q("https://query1.finance.yahoo.com:8443/v8/finance/chart/CL=F")); assert.equal(r.status, 400, "port rejected");
r = await call(q("https://user:pw@query1.finance.yahoo.com/v8")); assert.equal(r.status, 400, "credentials rejected");
r = await call(q("https://query1.finance.yahoo.com/v8/finance/chart/CL=F"), { method: "POST" }); assert.equal(r.status, 405);
r = await call(q("https://query1.finance.yahoo.com/v8/finance/chart/CL=F"), { method: "OPTIONS" }); assert.equal(r.status, 204);

// proxied + cached in isolate memory
const n0 = calls.length;
r = await call(q("https://query1.finance.yahoo.com/v8/finance/chart/CL=F?range=1mo"));
assert.equal(r.status, 200); assert.equal(r.headers.get("X-QT-Cache"), "MISS");
j = await r.json(); assert.equal(j.chart.result[0].meta.regularMarketPrice, 71.2);
assert.match(calls.at(-1).init.headers["User-Agent"], /Mozilla/);
r = await call(q("https://query1.finance.yahoo.com/v8/finance/chart/CL=F?range=1mo"));
assert.equal(r.headers.get("X-QT-Cache"), "MEM"); assert.equal(calls.length, n0 + 1, "second call served from memory");

// FIRMS key injection
r = await call(q("https://firms.modaps.eosdis.nasa.gov/api/area/csv/WORKER_KEY/VIIRS_SNPP_NRT/44,22,60,36/1"));
assert.equal(r.status, 400, "no key configured");
r = await call(q("https://firms.modaps.eosdis.nasa.gov/api/area/csv/WORKER_KEY/VIIRS_SNPP_NRT/44,22,60,36/1"), { env: { FIRMS_KEY: "s3cret" } });
assert.equal(r.status, 200);
assert.ok(calls.at(-1).url.includes("/s3cret/"), "secret inserted upstream");
assert.match(await r.text(), /^latitude/);

// redirect off the allow-list is refused
r = await call(q("https://oilprice.com/rss/main")); assert.equal(r.status, 502);

// origin restriction
r = await call(q("https://query1.finance.yahoo.com/v8/finance/chart/CL=F?range=1mo"), { env: { ALLOWED_ORIGINS: "https://me.github.io" } });
assert.equal(r.status, 200); assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://me.github.io");
r = await call(q("https://query1.finance.yahoo.com/v8/finance/chart/CL=F?range=1mo"), { env: { ALLOWED_ORIGINS: "https://me.github.io" }, origin: "https://other.site" });
assert.equal(r.status, 403);

console.log("worker: all checks passed");
