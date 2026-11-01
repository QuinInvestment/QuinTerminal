// CFTC Commitments of Traders — disaggregated, futures only (Socrata 72hh-3qpy).
// Positions as of Tuesday, published Friday 15:30 ET.

import { getJSON } from "../core/fetcher.js";
import { mean, std, percentileRank } from "../core/stats.js";
import { qs } from "./eia.js";

const DS = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json";

export const CONTRACTS = {
  "067651": { key: "WTI", name: "WTI crude oil (NYMEX)" },
  "06765T": { key: "BRENT", name: "Brent last-day (NYMEX)" },
  "111659": { key: "RBOB", name: "RBOB gasoline (NYMEX)" },
  "022651": { key: "ULSD", name: "NY Harbor ULSD (NYMEX)" },
  "023651": { key: "NG", name: "Henry Hub natural gas (NYMEX)" },
};

const n = (v) => (v == null || v === "" ? NaN : +v);

export async function cot(since = "2019-01-01") {
  const codes = Object.keys(CONTRACTS).map((c) => `'${c}'`).join(",");
  const q = Object.entries({
    $where: `cftc_contract_market_code in (${codes}) AND report_date_as_yyyy_mm_dd >= '${since}T00:00:00.000'`,
    $order: "report_date_as_yyyy_mm_dd ASC",
    $limit: "5000",
    $select: [
      "report_date_as_yyyy_mm_dd", "cftc_contract_market_code", "open_interest_all",
      "m_money_positions_long_all", "m_money_positions_short_all", "m_money_positions_spread",
      "prod_merc_positions_long", "prod_merc_positions_short",
      "swap_positions_long_all", "swap__positions_short_all", "swap__positions_spread_all",
      "other_rept_positions_long", "other_rept_positions_short",
      "nonrept_positions_long_all", "nonrept_positions_short_all",
      "traders_m_money_long_all", "traders_m_money_short_all",
    ].join(","),
  });
  const rows = await getJSON(`${DS}?${qs(q)}`, { ttl: 6 * 3600e3, persist: true, source: "cftc", timeout: 30e3 });
  const by = {};
  for (const r of rows) {
    const code = r.cftc_contract_market_code;
    if (!CONTRACTS[code]) continue;
    (by[code] ||= []).push({
      t: String(r.report_date_as_yyyy_mm_dd).slice(0, 10),
      oi: n(r.open_interest_all),
      mmL: n(r.m_money_positions_long_all), mmS: n(r.m_money_positions_short_all), mmSp: n(r.m_money_positions_spread),
      pmL: n(r.prod_merc_positions_long), pmS: n(r.prod_merc_positions_short),
      swL: n(r.swap_positions_long_all), swS: n(r.swap__positions_short_all),
      orL: n(r.other_rept_positions_long), orS: n(r.other_rept_positions_short),
      nrL: n(r.nonrept_positions_long_all), nrS: n(r.nonrept_positions_short_all),
      tMmL: n(r.traders_m_money_long_all), tMmS: n(r.traders_m_money_short_all),
    });
  }
  for (const code of Object.keys(by)) {
    for (const x of by[code]) {
      x.mmNet = x.mmL - x.mmS;
      x.pmNet = x.pmL - x.pmS;
      x.swNet = x.swL - x.swS;
      x.mmNetPct = x.oi > 0 ? x.mmNet / x.oi : NaN;
      x.mmRatio = x.mmS > 0 ? x.mmL / x.mmS : NaN;
    }
  }
  return by;
}

/** Positioning summary over a 3-year look-back. */
export function positioning(rows, lookbackWeeks = 156) {
  if (!rows || rows.length < 10) return null;
  const last = rows[rows.length - 1], prev = rows[rows.length - 2];
  const hist = rows.slice(-lookbackWeeks).map((r) => r.mmNet);
  const histPct = rows.slice(-lookbackWeeks).map((r) => r.mmNetPct);
  return {
    t: last.t, net: last.mmNet, wow: last.mmNet - prev.mmNet, long: last.mmL, short: last.mmS, oi: last.oi,
    netPct: last.mmNetPct, ratio: last.mmRatio,
    pctile: percentileRank(last.mmNet, hist),
    z: (last.mmNet - mean(hist)) / (std(hist) || 1),
    zPct: (last.mmNetPct - mean(histPct)) / (std(histPct) || 1),
    min: Math.min(...hist), max: Math.max(...hist),
  };
}
