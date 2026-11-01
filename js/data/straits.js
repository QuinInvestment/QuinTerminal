// straits.live — an open Hormuz tracker. Transit counts are IMF PortWatch
// (AIS-derived, published weekly with ~2-day lag); computed metrics are CC0.
// Falls back to the project's daily GitHub mirror when the site is unreachable.

import { getJSON, getText, parseCSV } from "../core/fetcher.js";

const SITE = "https://straits.live";
const MIRROR = "https://raw.githubusercontent.com/jasonhjohnson/strait-of-hormuz-data/main/data";

export const ATTRIBUTION = "straits.live (CC0 metrics) · transit counts © IMF PortWatch";

export async function status() {
  try {
    return await getJSON(`${SITE}/status`, { ttl: 90e3, source: "straits", timeout: 15e3 });
  } catch (e) {
    return await getJSON(`${MIRROR}/status.json`, { ttl: 30 * 60e3, source: "straits", timeout: 15e3 });
  }
}

/** Daily Hormuz transits since 2025-02-28: [{t, total, tanker, cargo}] */
export async function transits() {
  let text;
  try { text = await getText(`${SITE}/data/transits.csv`, { ttl: 30 * 60e3, source: "straits", persist: true, timeout: 15e3 }); }
  catch { text = await getText(`${MIRROR}/transits.csv`, { ttl: 60 * 60e3, source: "straits", persist: true, timeout: 15e3 }); }
  return parseCSV(text).map((r) => ({ t: r.date, total: +r.n_total, tanker: +r.n_tanker, cargo: +r.n_cargo })).filter((r) => r.t && Number.isFinite(r.total));
}

/** Hormuz Index daily history (crisis pressure, escalation forecast). */
export async function indexDaily() {
  const text = await getText(`${MIRROR}/hormuz-index-daily.csv`, { ttl: 3 * 3600e3, source: "straits", persist: true, timeout: 15e3 });
  return parseCSV(text);
}

/** Recent incident headlines with type tags. */
export async function events() {
  let text;
  try { text = await getText(`${SITE}/data/events.csv`, { ttl: 5 * 60e3, source: "straits", timeout: 15e3 }); }
  catch { text = await getText(`${MIRROR}/events.csv`, { ttl: 60 * 60e3, source: "straits", timeout: 15e3 }); }
  return parseCSV(text);
}

const num = (v) => (v == null || v === "" ? NaN : +v);

/** Normalise the status bundle into the fields the UI uses. */
export function digest(s) {
  if (!s) return null;
  const t = s.transits || {};
  const dt = s.dailyTransits || {};
  const hi = s.hormuzIndex || {};
  const ins = s.insurance || {};
  return {
    verdict: s.verdict?.status || "unknown",
    verdictShort: s.verdict?.short || "",
    verdictText: s.verdict?.long || "",
    narrative: s.narrative?.summary || "",
    narrativeAt: s.narrative?.arcUpdatedAt || s.narrative?.arcUpdated || "",
    brief: s.dailyBrief || null,
    transits: {
      count: num(t.count ?? dt.nTotal), baseline: num(t.baseline ?? dt.preCrisisBaselineMedian), throughputPct: num(t.throughputPct ?? s.throughputPercent),
      asOf: t.asOfDate || dt.date, ageDays: num(t.asOfAgeDays), tanker: num(dt.nTanker), cargo: num(dt.nCargo), ma7: num(dt.ma7),
      capacityTanker: num(dt.capacityTanker), capacity: num(dt.capacity),
    },
    aisInZone: num(s.aisConcurrentInZone ?? s.shipsTransiting),
    stranded: num(s.stranded), strandedOffshore: num(s.strandedOffshore),
    brent: num(s.brent), wti: num(s.wti), change24h: num(s.change24h), oilAsOf: s.oilAsOf, marketClosed: !!s.marketClosed,
    index: {
      pressure: num(hi.crisisPressure?.value), pressureBand: hi.crisisPressure?.band || "",
      escalation: num(hi.escalationProbability?.value), escalationBand: hi.escalationProbability?.band || "",
      url: hi.methodologyUrl,
    },
    insurance: {
      multiple: num(ins.multiple ?? s.insuranceMultiple), low: num(ins.vlccPremiumLow), high: num(ins.vlccPremiumHigh),
      clubs: ins.withdrawnClubs || [], stale: !!ins.figuresStale, source: ins.sourceName, url: ins.sourceUrl, at: ins.authoredAt,
    },
    bypass: (s.pipelineBypass || []).map((p) => ({
      id: p.id, name: p.name, capacity: num(p.capacityBpd), util: num(p.currentUtilizationPct), status: p.status, terminus: p.terminus,
      notes: p.notes, source: p.sourceName, url: p.sourceUrl, asOf: p.utilizationAsOf, origin: p.originCountry,
    })),
    spr: s.spr ? { mb: num(s.spr.currentMbbl), ch4w: num(s.spr.change4wMbbl), asOf: s.spr.asOfDate } : null,
    gasoline: s.gas ? num(s.gas.nationalAvgUsd) : NaN,
    chokepoints: (s.chokepoints || []).map((c) => ({ key: c.key, label: c.label, date: c.date, n: num(c.nTotal), base: num(c.preCrisisBaselineMedian), recent: num(c.baselineMedian) })),
    markets: (s.predictionMarkets || []).map((m) => ({ q: m.question || m.title, p: num(m.probability), close: m.closeAt, vol: num(m.volumeUsd), url: m.sourceUrl, venue: m.venue })),
    events: (s.events || []).map((e) => ({ title: e.title, type: e.type, sev: e.severity, at: e.occurredAt, lat: e.lat, lng: e.lng })),
    carriers: (s.carrierSuspensions || []).map((c) => ({ carrier: c.carrier, status: c.status, posture: c.hormuzPosture, since: c.since, notes: c.notes })),
    trade: s.tradeImpact ? { oilAtRisk: num(s.tradeImpact.worldOilAtRiskPct), lngAtRisk: num(s.tradeImpact.worldLngAtRiskPct), extraDays: num(s.tradeImpact.alternativeRouteExtraDays), countries: s.tradeImpact.topAffectedCountries || [] } : null,
    rial: s.iranRate ? { mid: num(s.iranRate.midRial), d1: num(s.iranRate.deltaDayPct), d7: num(s.iranRate.delta7dPct), at: s.iranRate.updatedAt } : null,
    darkTankers: s.aisGaps ? { count: num(s.aisGaps.count), expected: num(s.aisGaps.expectedDarkTankers), eligible: num(s.aisGaps.eligibleTankers), z: num(s.aisGaps.stratifiedZ), significant: !!s.aisGaps.significant } : null,
    vesselRisk: s.vesselRisk ? { high: num(s.vesselRisk.high), moderate: num(s.vesselRisk.moderate), low: num(s.vesselRisk.low), total: num(s.vesselRisk.total) } : null,
    jwc: s.jwc ? { label: s.jwc.circularLabel, date: s.jwc.circularDate, url: s.jwc.circularUrl } : null,
  };
}
