// End-to-end check of pipeline/snapshot.mjs against a mocked network
// (node tests/pipeline.test.mjs). Verifies outputs, idempotent re-runs,
// day-over-day appends and that one failing source does not block the rest.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.QT_BACKOFF_MS = "5";
process.env.QT_PACE_MS = "0";
process.env.EIA_KEY = "TESTKEY";

// ---------------------------------------------------------------- mock network
let yahooDown = false, eiaDown = false, eiaCalls = 0;
let archiveDir = null; // where file:// reads of data/ are served from (the test's output dir)
const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 27, 21, 40);
const rand = (() => { let s = 42; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); })();
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

function walk(n, start, vol) { const out = []; let v = start; for (let i = 0; i < n; i++) { v *= Math.exp(vol * gauss()); out.push(v); } return out; }
const spotDays = [];
for (let t = Date.UTC(2014, 0, 2); t < NOW - 7 * DAY; t += DAY) { const d = new Date(t).getUTCDay(); if (d && d < 6) spotDays.push(new Date(t).toISOString().slice(0, 10)); }
const brent = walk(spotDays.length, 60, 0.02), wti = brent.map((v) => v * 0.94);
const perpStart = Date.UTC(2025, 6, 1);
const perpN = Math.floor((NOW - perpStart) / DAY);
const perpB = walk(perpN, 70, 0.022), perpW = perpB.map((v) => v * 0.92);

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname.endsWith("finance.yahoo.com")) {
    if (yahooDown) return json({ error: "down" }, 503);
    const sym = decodeURIComponent(url.pathname.split("/").pop());
    const k = sym.charCodeAt(3) % 13;
    return json({ chart: { result: [{ meta: { regularMarketPrice: (sym.startsWith("BZ") ? 105 : 98) - k * 0.8, regularMarketTime: Math.floor((NOW - 2 * 3600e3) / 1000), chartPreviousClose: 97 } }] } });
  }
  if (url.hostname === "meri.digitraffic.fi") {
    if (url.pathname.endsWith("/vessels")) return json(Array.from({ length: 30 }, (_, i) => ({ mmsi: 273000000 + i, name: "TANKER " + i, shipType: 80, referencePointA: 200, referencePointB: 44, referencePointC: 20, referencePointD: 22, draught: i % 2 ? 140 : 80, destination: "RUPRI", eta: 0 })));
    return json({ features: Array.from({ length: 30 }, (_, i) => ({ mmsi: 273000000 + i, geometry: { coordinates: [27 + (i % 10) * 0.2, 59.8 + (i % 5) * 0.1] }, properties: { sog: i % 3 ? 10 : 0.2, cog: 250, heading: 250, navStat: i % 4 ? 0 : 1, timestampExternal: Date.now() - 600e3 } })) });
  }
  if (url.hostname === "api.hyperliquid.xyz") {
    const body = JSON.parse(init.body || "{}");
    if (body.type === "metaAndAssetCtxs") return json([{ universe: [{ name: "xyz:CL" }, { name: "xyz:BRENTOIL" }] }, [{ markPx: "99.5", prevDayPx: "98" }, { markPx: "108.25", prevDayPx: "107" }]]);
    if (body.type === "candleSnapshot") {
      const series = body.req.coin === "xyz:CL" ? perpW : perpB;
      return json(series.map((c, i) => ({ t: perpStart + i * DAY, T: perpStart + (i + 1) * DAY - 1, o: String(c), h: String(c * 1.01), l: String(c * 0.99), c: String(c), v: "1000", n: 10 })).filter((c) => c.t >= body.req.startTime));
    }
  }
  if (url.protocol === "file:") {
    // the app reads its archive from data/ next to index.html; serve the test output instead
    const rel = decodeURIComponent(url.pathname).split("/data/").pop();
    try { return new Response(await fs.readFile(path.join(archiveDir, rel), "utf8"), { status: 200 }); }
    catch { return new Response("not found", { status: 404 }); }
  }
  if (url.hostname === "api.eia.gov") {
    eiaCalls++;
    if (eiaDown) return json({ error: "rate limited" }, 429);
    let data;
    if (url.pathname.includes("/sndw/")) {
      const weeks = spotDays.filter((d, i) => i % 5 === 4 && d >= "2018-01-01");
      data = weeks.flatMap((d, i) => [{ period: d, series: "WCESTUS1", value: String(420000 + 9000 * Math.sin(i / 8)) }, { period: d, series: "WCSSTUS1", value: String(380000 - 40 * i) }]);
    } else if (url.pathname.includes("/steo/")) {
      data = Array.from({ length: 96 }, (_, i) => { const t = new Date(Date.UTC(2019, i, 1)).toISOString().slice(0, 7); return [{ period: t, seriesId: "BREPUUS", value: String(70 + i / 4) }, { period: t, seriesId: "PAPR_WORLD", value: String(100 + i / 50) }, { period: t, seriesId: "PATC_WORLD", value: String(100.4 + i / 60) }]; }).flat();
    } else {
      data = spotDays.flatMap((d, i) => [{ period: d, series: "RBRTE", value: brent[i].toFixed(2) }, { period: d, series: "RWTC", value: wti[i].toFixed(2) }]);
    }
    const off = +(url.searchParams.get("offset") || 0), len = +(url.searchParams.get("length") || 5000);
    return json({ response: { total: data.length, data: data.slice(off, off + len) } });
  }
  if (url.hostname === "gamma-api.polymarket.com") return json({ events: [] });
  throw new Error("unmocked " + url.href);
};

// ---------------------------------------------------------------- run
const { run } = await import("../pipeline/snapshot.mjs");
const { parseCsv } = await import("../pipeline/lib.mjs");
const out = await fs.mkdtemp(path.join(os.tmpdir(), "qt-pipe-"));
archiveDir = out;
const read = async (f) => fs.readFile(path.join(out, f), "utf8");
const quiet = () => {};

let res = await run({ out, now: NOW, log: quiet });
assert.equal(res.ok, 4, "all four jobs succeed: " + JSON.stringify(res.manifest.jobs));

// EIA mirror: three files, compact [t, v] pairs, paged spot history complete
const eWeekly = JSON.parse(await read("eia/weekly.json"));
const eSpot = JSON.parse(await read("eia/spot.json"));
const eSteo = JSON.parse(await read("eia/steo.json"));
assert.ok(eWeekly.series.WCESTUS1.length > 300 && Array.isArray(eWeekly.series.WCESTUS1[0]), "weekly mirror packed");
assert.equal(eSpot.series.RBRTE.length, spotDays.length, "all spot pages fetched (" + spotDays.length + " days)");
assert.ok(eSteo.series.PAPR_WORLD.length === 96, "steo mirror");
assert.equal(res.manifest.jobs.eia.spot.changed, true);

const latest = JSON.parse(await read("curve/latest.json"));
assert.equal(latest.CL.length, 12); assert.equal(latest.BZ.length, 12);
assert.equal(latest.CL[0].code, "CLZ6"); assert.equal(latest.BZ[0].code, "BZ6");
let curve = parseCsv(await read("history/curve.csv"));
assert.equal(curve.length, 24);

const baltic = parseCsv(await read("history/baltic.csv"));
assert.equal(baltic.length, 1); assert.equal(+baltic[0].tankers, 30);

let fc = parseCsv(await read("history/forecasts.csv"));
assert.equal(fc.length, 6, "2 instruments x 3 horizons");
for (const r of fc) {
  const g = ["g_q05", "g_q25", "g_q50", "g_q75", "g_q95"].map((k) => +r[k]);
  const m = ["m_q05", "m_q25", "m_q50", "m_q75", "m_q95"].map((k) => +r[k]);
  assert.ok(g.every((v, i) => i === 0 || v > g[i - 1]), "GARCH quantiles increase " + g);
  assert.ok(m.every((v, i) => i === 0 || v > m[i - 1]), "mixture quantiles increase " + m);
  assert.ok(Math.abs(+r.p_deal + +r.p_base + +r.p_esc - 1) < 1e-3, "scenario weights sum to 1");
  assert.equal(r.history, "eia+perp");
}
assert.equal(+fc.find((r) => r.inst === "BRENT").s0, 108.25, "forecast starts from the live mark");
assert.equal(fc.find((r) => r.inst === "WTI" && r.h === "5").target, "2026-11-03", "5 weekdays after Tue 27 Oct");

// same day again: rows replaced, not duplicated; unchanged EIA files are not rewritten
const spotStat = await fs.stat(path.join(out, "eia/spot.json"));
res = await run({ out, now: NOW + 3600e3, log: quiet });
assert.equal(res.manifest.jobs.eia.spot.changed, false, "identical EIA data leaves the file alone");
assert.equal((await fs.stat(path.join(out, "eia/spot.json"))).mtimeMs, spotStat.mtimeMs);
assert.equal(parseCsv(await read("history/curve.csv")).length, 24, "idempotent within a day");
assert.equal(parseCsv(await read("history/forecasts.csv")).length, 6);

// next day with Yahoo down: curve fails, the others still write, manifest says why
yahooDown = true;
res = await run({ out, now: NOW + DAY, log: quiet });
assert.equal(res.ok, 3);
const man = JSON.parse(await read("manifest.json"));
assert.equal(man.jobs.curve.ok, false); assert.match(man.jobs.curve.error, /Yahoo unreachable|no contract returned a price/);
assert.equal(man.jobs.baltic.ok, true);
assert.equal(parseCsv(await read("history/curve.csv")).length, 24, "failed job leaves history untouched");
assert.equal(parseCsv(await read("history/baltic.csv")).length, 2);
assert.equal(parseCsv(await read("history/forecasts.csv")).length, 12);

// ---------------------------------------------------------------- app side: archive fallback
// A visitor with only DEMO_KEY whose quota is gone gets the mirror instead of an error.
const eia = await import("../js/data/eia.js");
const { settings } = await import("../js/core/settings.js");
const health = await import("../js/core/health.js");
settings.eiaKey = "";               // DEMO_KEY, as for a first-time visitor
eiaDown = true;                     // ...whose shared quota is exhausted (HTTP 429)
const w = await eia.weekly();
assert.ok(w.archivedAt, "weekly came from the archive");
assert.equal(w.series.WCESTUS1.length, eWeekly.series.WCESTUS1.length);
assert.ok(typeof w.series.WCESTUS1[0].t === "string" && Number.isFinite(w.series.WCESTUS1[0].v), "unpacked to {t, v}");
const st = health.list().find((x) => x.id === "eia");
assert.equal(st.state, "stale"); assert.match(st.note, /daily archive/);
// spot: the archive is current (last day within 10 days), so no EIA call at all
eiaDown = false;
const before = eiaCalls;
const sp = await eia.spot();
assert.equal(eiaCalls, before, "fresh archive spares the shared DEMO_KEY");
assert.equal(sp.series.RBRTE.length, spotDays.length);
// with a personal key the live API comes first again
settings.eiaKey = "TESTKEY";
const live = await eia.spot();
assert.ok(!live.archivedAt, "own key goes live (served from the session cache here)");

await fs.rm(out, { recursive: true, force: true });
console.log("pipeline: all checks passed");
process.exit(0);
