// ECB reference FX via Frankfurter: oil priced in importers' currencies.

import { getJSON } from "../core/fetcher.js";

const BASE = "https://api.frankfurter.dev/v1";
export const CCY = [
  { c: "EUR", label: "Euro area" }, { c: "JPY", label: "Japan" }, { c: "CNY", label: "China" },
  { c: "INR", label: "India" }, { c: "KRW", label: "South Korea" }, { c: "GBP", label: "UK" },
];

export async function latest() {
  return getJSON(`${BASE}/latest?from=USD&to=${CCY.map((x) => x.c).join(",")}`, { ttl: 60 * 60e3, source: "fx", timeout: 15e3 });
}

/** {date: {EUR: rate,...}} USD-based, from a start date */
export async function history(start = "2025-10-01") {
  const j = await getJSON(`${BASE}/${start}..?from=USD&to=${CCY.map((x) => x.c).join(",")}`, { ttl: 6 * 3600e3, source: "fx", persist: true, timeout: 20e3 });
  return j?.rates || {};
}
