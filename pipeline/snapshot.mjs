#!/usr/bin/env node
// Daily snapshot job, run by .github/workflows/snapshot.yml after the NYMEX
// settlement. It archives what free sources do not keep for you, as small
// CSV/JSON files under data/ that the terminal reads from its own origin:
//
//   eia       EIA weekly balances, daily spot history and STEO, fetched with
//             the EIA_KEY secret -> data/eia/{weekly,spot,steo}.json, the
//             fallback the app uses when the visitor's DEMO_KEY is exhausted
//   curve     12 NYMEX WTI (CL) and Brent (BZ) contracts from Yahoo Finance
//             -> data/curve/latest.json, data/history/curve.csv
//   baltic    tankers in the Gulf of Finland from Digitraffic AIS
//             -> data/history/baltic.csv
//   forecast  the terminal's own Brent/WTI forecasts (GARCH-FHS and the
//             market-linked scenario mixture) at 1 week, 1 month, 3 months
//             -> data/history/forecasts.csv, scored later against outcomes
//
//   node pipeline/snapshot.mjs [--out data] [--only eia,curve,baltic,forecast]
//
// Jobs are independent: one failing source never blocks the others, and
// data/manifest.json records what happened. The job reuses the app's own data
// and maths modules, so the archive and the screen can never disagree on parsing.

import "./shim.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { settings } from "../js/core/settings.js";
import { upcoming } from "../js/core/contracts.js";
import * as S from "../js/core/stats.js";
import * as dt from "../js/data/digitraffic.js";
import * as eia from "../js/data/eia.js";
import * as hl from "../js/data/hyperliquid.js";
import * as poly from "../js/data/polymarket.js";
import * as model from "../js/data/model.js";
import { fetchRetry, upsertCsv, writeJson, writeSeriesJson, isoDay, addWeekdays } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PACE_MS = process.env.QT_PACE_MS != null ? +process.env.QT_PACE_MS : 300; // be polite to Yahoo
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null);

// ---------------------------------------------------------------- curve
async function yahooQuote(symbol) {
  const u = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;
  const r = await fetchRetry(u, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(j?.chart?.error?.description || "no result");
  const m = res.meta || {};
  return { price: m.regularMarketPrice, time: (m.regularMarketTime || 0) * 1000, prevClose: m.chartPreviousClose ?? m.previousClose ?? null };
}

export const CURVE_HEADER = ["date", "root", "code", "label", "last_trade", "price", "quote_date"];

export async function curveJob({ out, now }) {
  const date = isoDay(now);
  const roots = [{ id: "CL", cal: "CL" }, { id: "BZ", cal: "B" }];
  const snap = { asOf: new Date(now).toISOString(), date, source: "Yahoo Finance chart API: NYMEX CL (WTI) and BZ (Brent) contracts, snapshot after settlement", CL: [], BZ: [] };
  const rows = [], errors = [];
  for (const R of roots) {
    for (const c of upcoming(R.cal, 12, new Date(now))) {
      // four failures before any success: the source is down, stop hammering it
      if (!rows.length && errors.length >= 4) throw new Error("Yahoo unreachable (" + errors.slice(0, 2).join("; ") + ")");
      try {
        const qd = await yahooQuote(c.yahoo);
        if (!(qd.price > 0)) throw new Error("no price");
        if (now - qd.time > 4 * 86400000) throw new Error("quote older than 4 days");
        const lastTrade = isoDay(+new Date(c.lastTrade));
        snap[R.id].push({ code: c.code, label: c.label, yahoo: c.yahoo, lastTrade, price: qd.price, prevClose: qd.prevClose, quoteTime: new Date(qd.time).toISOString() });
        rows.push({ date, root: R.id, code: c.code, label: c.label, last_trade: lastTrade, price: qd.price, quote_date: isoDay(qd.time) });
      } catch (e) {
        errors.push(`${c.yahoo}: ${e.message}`);
      }
      await sleep(PACE_MS);
    }
  }
  if (!rows.length) throw new Error("no contract returned a price (" + errors.slice(0, 3).join("; ") + ")");
  await writeJson(path.join(out, "curve/latest.json"), snap);
  const n = await upsertCsv(path.join(out, "history/curve.csv"), CURVE_HEADER, rows, ["date", "root", "code"], ["date", "root", "last_trade"]);
  return { contracts: rows.length, historyRows: n, ...(errors.length ? { missing: errors.slice(0, 8) } : {}) };
}

// ---------------------------------------------------------------- Baltic AIS
export const BALTIC_HEADER = ["date", "time", "tankers", "laden", "ballast", "laden_westbound", "aframax_plus", "foc_share", ...dt.TERMINALS.map((t) => "near_" + t.id)];

export async function balticJob({ out, now }) {
  const list = await dt.tankers();
  if (!list.length) throw new Error("Digitraffic returned no tankers");
  const s = dt.summarise(list);
  const row = {
    date: isoDay(now), time: new Date(now).toISOString(), tankers: s.total, laden: s.laden, ballast: s.ballast,
    laden_westbound: s.departing.length, aframax_plus: s.large, foc_share: r4(s.focShare),
    ...Object.fromEntries(s.per.map((p) => ["near_" + p.id, p.total])),
  };
  const n = await upsertCsv(path.join(out, "history/baltic.csv"), BALTIC_HEADER, [row], ["date"], ["date"]);
  return { tankers: s.total, historyRows: n };
}

// ---------------------------------------------------------------- forecasts
export const HORIZONS = [5, 21, 63];
export const FORECAST_HEADER = ["date", "inst", "h", "target", "s0", "rv20", "garch_vol",
  "g_q05", "g_q25", "g_q50", "g_q75", "g_q95", "m_q05", "m_q25", "m_q50", "m_q75", "m_q95",
  "p_deal", "p_base", "p_esc", "returns", "history"];

export async function forecastJob({ out, now }) {
  const date = isoDay(now);
  let board = null;
  try { board = await poly.board(); } catch { /* scenarios fall back to stated assumptions */ }
  let marks = [];
  try { marks = await hl.snapshot("xyz"); } catch { /* fall back to the last daily close */ }
  const rows = [];
  for (const inst of ["BRENT", "WTI"]) {
    const I = model.INSTRUMENTS[inst];
    const hist = await model.dailyHistory(inst);
    const { g, returns } = await model.garch(inst);
    const mark = marks.find((x) => x.coin === I.coin)?.markPx;
    const S0 = Number.isFinite(mark) ? mark : hist.perpPts.at(-1)?.v;
    if (!(S0 > 0)) throw new Error(`${inst}: no current price`);
    const rv20 = S.realizedVol(returns.slice(-20));
    const prewar = hist.points.filter((p) => p.t <= "2026-02-27").pop()?.v;
    for (const H of HORIZONS) {
      const sim = S.fhsSimulate(g, S0, H, { paths: 20000, seed: 7 });
      const q = sim.bands[H - 1];
      const gVol = S.garchHorizonVol(g, H);
      const scen = model.defaultScenarios({ S0, prewar, hDays: Math.round((H * 365) / 252), events: board, gVol });
      const mix = model.mixture(scen, H / 252);
      rows.push({
        date, inst, h: H, target: addWeekdays(date, H), s0: r4(S0), rv20: r4(rv20), garch_vol: r4(gVol),
        g_q05: r4(q[0]), g_q25: r4(q[1]), g_q50: r4(q[2]), g_q75: r4(q[3]), g_q95: r4(q[4]),
        m_q05: r4(mix.q5), m_q25: r4(mix.q25), m_q50: r4(mix.q50), m_q75: r4(mix.q75), m_q95: r4(mix.q95),
        p_deal: r4(scen[0].p), p_base: r4(scen[1].p), p_esc: r4(scen[2].p),
        returns: returns.length, history: hist.spotPts.length ? "eia+perp" : "perp only",
      });
    }
  }
  const n = await upsertCsv(path.join(out, "history/forecasts.csv"), FORECAST_HEADER, rows, ["date", "inst", "h"], ["date", "inst", "h"]);
  return { forecasts: rows.length, historyRows: n, polymarket: !!board };
}

// ---------------------------------------------------------------- EIA mirror
// The weekly balances, daily spot history and STEO, fetched with the repo's
// EIA_KEY secret so visitors without a key (DEMO_KEY is shared and runs out)
// still get them. A file is rewritten only when its data changed, which keeps
// the git history small: weekly changes once a week, STEO once a month.
export const EIA_FILES = {
  weekly: { fetch: () => eia.weekly({ archive: false }), source: "U.S. EIA API v2, Weekly Petroleum Status Report (petroleum/sum/sndw)" },
  spot: { fetch: () => eia.spot({ archive: false }), source: "U.S. EIA API v2, daily spot prices RBRTE and RWTC (petroleum/pri/spt)" },
  steo: { fetch: () => eia.steo({ archive: false }), source: "U.S. EIA API v2, Short-Term Energy Outlook (steo)" },
};

export async function eiaJob({ out, now }) {
  if (!settings.eiaKey) throw new Error("EIA_KEY secret not set: DEMO_KEY is shared by every GitHub runner and is usually exhausted. Add a free key (eia.gov/opendata) as the EIA_KEY repository secret");
  const res = {}, errors = [];
  for (const [name, F] of Object.entries(EIA_FILES)) {
    try {
      const packed = eia.pack(await F.fetch());
      const n = Object.values(packed.series).reduce((a, s) => a + s.length, 0);
      if (!n) throw new Error("empty response");
      const file = path.join(out, `eia/${name}.json`);
      let prev = null;
      try { prev = JSON.parse(await fs.readFile(file, "utf8")); } catch { /* first run */ }
      const changed = !prev || JSON.stringify(prev.series) !== JSON.stringify(packed.series);
      if (changed) await writeSeriesJson(file, { asOf: new Date(now).toISOString(), source: F.source, meta: packed.meta, series: packed.series });
      res[name] = { points: n, changed };
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  if (!Object.keys(res).length) throw new Error(errors.join("; ").slice(0, 280));
  return { ...res, ...(errors.length ? { missing: errors } : {}) };
}

// ---------------------------------------------------------------- runner
export const JOBS = { eia: eiaJob, curve: curveJob, baltic: balticJob, forecast: forecastJob };

export async function run({ out = path.join(ROOT, "data"), only = Object.keys(JOBS), now = Date.now(), log = console.log } = {}) {
  settings.eiaKey = process.env.EIA_KEY || settings.eiaKey || "";
  const manifestPath = path.join(out, "manifest.json");
  let manifest = { version: 1, jobs: {} };
  try { manifest = JSON.parse(await (await import("node:fs/promises")).readFile(manifestPath, "utf8")); } catch { /* first run */ }
  manifest.jobs ||= {};
  let ok = 0;
  for (const name of only) {
    const t0 = Date.now();
    try {
      const res = await JOBS[name]({ out, now });
      manifest.jobs[name] = { ok: true, at: new Date(now).toISOString(), ms: Date.now() - t0, ...res };
      ok++;
      log(`ok    ${name} ${JSON.stringify(res)}`);
    } catch (e) {
      manifest.jobs[name] = { ...(manifest.jobs[name] || {}), ok: false, failedAt: new Date(now).toISOString(), error: String(e.message || e).slice(0, 300) };
      log(`FAIL  ${name}: ${e.message}`);
    }
  }
  manifest.updated = new Date(now).toISOString();
  await writeJson(manifestPath, manifest);
  return { ok, total: only.length, manifest };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const only = arg("--only") ? arg("--only").split(",").filter((j) => JOBS[j]) : undefined;
  const res = await run({ out: arg("--out") ? path.resolve(arg("--out")) : undefined, only });
  // fail the workflow only when every job failed, so partial data is still committed
  process.exit(res.ok === 0 ? 1 : 0);
}
