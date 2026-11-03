// Forecast engine shared by the cockpit and the forecast lab.
// Three lenses on the same question ("where can Brent / WTI be in H days?"):
//   1. statistical — GARCH(1,1) + filtered historical simulation on daily returns
//   2. scenario    — a mixture of lognormal regimes (deal / blockade / escalation)
//                    whose weights can be linked to prediction markets
//   3. market      — volatility implied by Polymarket price-barrier ladders

import * as eia from "./eia.js";
import * as hl from "./hyperliquid.js";
import * as poly from "./polymarket.js";
import * as S from "../core/stats.js";

const cache = new Map();

export const INSTRUMENTS = {
  BRENT: { key: "BRENT", eia: "RBRTE", coin: "xyz:BRENTOIL", name: "Brent" },
  WTI: { key: "WTI", eia: "RWTC", coin: "xyz:CL", name: "WTI" },
};

/**
 * Daily history.
 *   points — the RETURN series used for estimation: EIA spot for the long run,
 *            chain-linked with the perp's daily returns after the last EIA
 *            print (EIA lags about a week). Its LEVEL is the physical spot's.
 *   perpPts — the perp's own daily closes (the instrument being forecast).
 *   spotPts — the EIA spot alone (Dated Brent / WTI Cushing).
 *   premium — spot minus perp on the last common day: in 2026 Dated Brent has
 *             traded far above futures, so levels must not be mixed on a chart.
 */
export async function dailyHistory(inst = "BRENT") {
  const k = "hist:" + inst;
  if (cache.has(k) && Date.now() - cache.get(k).at < 15 * 60e3) return cache.get(k).v;
  const I = INSTRUMENTS[inst];
  const [spot, perp] = await Promise.all([
    eia.spot().catch(() => null),
    hl.candles(I.coin, "1d", Date.UTC(2025, 6, 1), Date.now(), 10 * 60e3).catch(() => []),
  ]);
  const spotPts = (spot?.series?.[I.eia] || []).filter((p) => p.v > 0).map((p) => ({ t: p.t, v: p.v }));
  const perpPts = perp.map((c) => ({ t: new Date(c.t).toISOString().slice(0, 10), v: c.c })).filter((p) => p.v > 0);
  let pts = spotPts.slice();
  const eiaLast = pts.length ? pts[pts.length - 1].t : null;
  let spliced = 0, premium = NaN, premiumDate = null;
  if (perpPts.length) {
    if (!pts.length) {
      pts = perpPts.slice();
    } else {
      const anchor = perpPts.find((p) => p.t === eiaLast) || [...perpPts].reverse().find((p) => p.t <= eiaLast);
      if (anchor) {
        const spotAtAnchor = spotPts.find((p) => p.t === anchor.t)?.v ?? pts[pts.length - 1].v;
        premium = spotAtAnchor - anchor.v;
        premiumDate = anchor.t;
        let level = pts[pts.length - 1].v;
        let prev = anchor.v;
        for (const p of perpPts) {
          if (p.t <= eiaLast) continue;
          level *= p.v / prev;
          prev = p.v;
          pts.push({ t: p.t, v: level, spliced: true });
          spliced++;
        }
      }
    }
  }
  const v = { points: pts, spotPts, perpPts, eiaLast, splicedDays: spliced, premium, premiumDate, perp };
  cache.set(k, { at: Date.now(), v });
  return v;
}

/** GARCH fitted on the last ~10 years of daily log returns. */
export async function garch(inst = "BRENT") {
  const k = "garch:" + inst;
  if (cache.has(k) && Date.now() - cache.get(k).at < 30 * 60e3) return cache.get(k).v;
  const { points } = await dailyHistory(inst);
  const closes = points.slice(-2600).map((p) => p.v);
  const r = S.logReturns(closes);
  const g = S.garchFit(r);
  const v = { g, returns: r, lastDate: points[points.length - 1]?.t };
  cache.set(k, { at: Date.now(), v });
  return v;
}

export function realized(returns) {
  const last = (n) => S.realizedVol(returns.slice(-n));
  return { d20: last(20), d60: last(60), d250: last(250), ewma: Math.sqrt(S.ewmaVariance(returns).pop() * 252) };
}

/** Polymarket term structure of P(Hormuz normal by date) -> P(by horizon) */
export function reopenProbAt(curve, tMs) {
  if (!curve || !curve.length) return NaN;
  const pts = curve.filter((c) => Number.isFinite(c.p)).sort((a, b) => a.t - b.t);
  if (!pts.length) return NaN;
  if (tMs <= pts[0].t) {
    // interpolate from 0 at "now" to the first deadline, constant hazard
    const T = (pts[0].t - Date.now()) / 86400000, h = (tMs - Date.now()) / 86400000;
    if (T <= 0) return pts[0].p;
    const lam = -Math.log(1 - Math.min(pts[0].p, 0.999)) / T;
    return 1 - Math.exp(-lam * Math.max(0, h));
  }
  for (let i = 1; i < pts.length; i++) {
    if (tMs <= pts[i].t) {
      const a = pts[i - 1], b = pts[i];
      const w = (tMs - a.t) / (b.t - a.t);
      return a.p + w * (b.p - a.p);
    }
  }
  // beyond the last deadline: extend with the last implied hazard
  const a = pts[pts.length - 2] || { t: Date.now(), p: 0 }, b = pts[pts.length - 1];
  const dt = (b.t - a.t) / 86400000;
  const lam = dt > 0 && b.p < 1 ? Math.max(0, -Math.log((1 - b.p) / Math.max(1e-6, 1 - a.p)) / dt) : 0;
  return 1 - (1 - b.p) * Math.exp(-lam * (tMs - b.t) / 86400000);
}

/** cumulative probability of an event by year-end converted to a horizon with constant hazard */
export function hazardToHorizon(pByEnd, endMs, hDays) {
  if (!Number.isFinite(pByEnd)) return NaN;
  const T = (endMs - Date.now()) / 86400000;
  if (T <= 0) return pByEnd;
  const lam = -Math.log(1 - Math.min(pByEnd, 0.999)) / T;
  return 1 - Math.exp(-lam * hDays);
}

/**
 * Default scenario set. Probabilities: reopening from the Polymarket term
 * structure, escalation from "US invades Iran before 2027" scaled to the
 * horizon; the rest is the grinding blockade. Targets are editable assumptions.
 */
export function defaultScenarios({ S0, prewar, hDays, events, gVol }) {
  const curve = events ? poly.reopenCurve(events) : [];
  const tH = Date.now() + hDays * 86400000;
  let pDeal = reopenProbAt(curve, tH);
  let dealSrc = "Polymarket: Hormuz traffic normal by date (interpolated)";
  if (!Number.isFinite(pDeal)) { pDeal = 0.12; dealSrc = "assumption (no market found)"; }
  let pEsc = NaN, escSrc = "assumption";
  if (events) {
    for (const e of events) for (const m of e.markets) {
      if (/u\.?s\.? invade iran/i.test(m.q) && Number.isFinite(m.p)) { pEsc = hazardToHorizon(m.p, Date.parse(m.end || "2027-01-01"), hDays); escSrc = "Polymarket: US invades Iran before 2027 (hazard-scaled)"; }
    }
  }
  if (!Number.isFinite(pEsc)) pEsc = 0.08;
  pDeal = Math.min(0.9, Math.max(0.01, pDeal));
  pEsc = Math.min(0.6, Math.max(0.01, pEsc));
  const pBase = Math.max(0.05, 1 - pDeal - pEsc);
  const norm = pDeal + pEsc + pBase;
  const pre = Number.isFinite(prewar) ? prewar : S0 * 0.65;
  return [
    // a reopening cannot leave crude dearer than the blockade does: cap the target below today's price
    { id: "deal", name: "Deal and reopening", p: pDeal / norm, target: Math.round(Math.min(S0 * 0.95, Math.max(pre * 1.25, S0 * 0.7))), vol: 0.45, src: dealSrc, why: "Flows recover over weeks, but stocks are depleted and the SPR needs refilling, so prices settle above the pre-war level." },
    { id: "base", name: "Grinding blockade", p: pBase / norm, target: Math.round(S0), vol: Math.max(0.3, gVol || 0.4), src: "residual", why: "Futures are a martingale under the pricing measure: the median stays near today's price; volatility from the GARCH model." },
    { id: "esc", name: "Escalation", p: pEsc / norm, target: Math.round(S0 * 1.3), vol: 0.7, src: escSrc, why: "Large-scale strikes, Bab el-Mandeb closure or damage to Gulf export infrastructure (Ras Tanura, Yanbu)." },
  ];
}

export function mixture(scen, T) {
  const comps = scen.map((s) => ({ w: s.p, median: s.target, sigma: s.vol }));
  const q = (p) => S.mixQuantile(p, comps, T);
  return { comps, q5: q(0.05), q25: q(0.25), q50: q(0.5), q75: q(0.75), q95: q(0.95), mean: S.mixMean(comps, T), cdf: (x) => S.mixCdf(x, comps, T), pdf: (x) => S.mixPdf(x, comps, T) };
}

/** Implied vols from WTI barrier ladders ("hit HIGH/LOW $X in <month>"). */
export function ladderVols(ladders, S0) {
  const now = Date.now(), Y = 365 * 86400000;
  return ladders.map((l) => {
    const t1 = Math.max(0, (l.start - now) / Y), t2 = Math.max(1 / 365, (l.end - now) / Y);
    const touchingSide = l.dir === "HIGH" ? l.K > S0 : l.K < S0;
    const iv = touchingSide ? S.impliedVolFromTouch(l.p, S0, l.K, t1, t2) : NaN;
    return { ...l, t1, t2, iv };
  }).filter((x) => Number.isFinite(x.iv));
}
