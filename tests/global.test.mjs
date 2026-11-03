// The global-oil additions: chokepoint statistics (PortWatch), the oil
// calendar (release schedules, holiday shifts, expiries) and the cracks.
// node tests/global.test.mjs
import assert from "node:assert/strict";
import * as pw from "../js/data/portwatch.js";
import { events } from "../js/core/calendar.js";
import { crackSpreads } from "../js/data/eia.js";

const ok = (m) => console.log("ok  ", m);
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// ---------------------------------------------------------------- PortWatch
{
  // 400 days, 40 tankers a day for the first year, then 10 a day for the last 50 days
  const start = Date.UTC(2025, 8, 1);
  const rows = Array.from({ length: 400 }, (_, i) => ({ t: iso(start + i * DAY), tk: i >= 350 ? 10 : 40, tot: 100, cap: 1e6 }));
  const ma = pw.trailing(rows, "tk", 7);
  assert.equal(ma.length, rows.length - 6, "one point per full 7-day window");
  assert.equal(ma[0].v, 40);
  const s = pw.summarise({ id: "x", name: "Test strait", rows });
  assert.equal(s.last, 10, "last 7-day mean");
  assert.equal(s.ly, 40, "same weeks a year earlier (364 days back)");
  assert.ok(Math.abs(s.yoy - -0.75) < 1e-12, "change on the year");
  assert.equal(s.prior4, 10, "prior four weeks already low");
  assert.equal(s.lastYear.at(-1).t, s.asOf, "last year's line is shifted onto this year's dates");
  ok("PortWatch 7-day means, year-on-year alignment");
  // gaps: a window needs 70 % of its days
  const gappy = rows.map((r, i) => (i % 3 === 0 ? { ...r, tk: NaN } : r));
  assert.ok(pw.trailing(gappy, "tk", 7).length > 200 && pw.trailing(gappy, "tk", 7).every((p) => p.v === 40 || p.v === 10 || (p.v > 10 && p.v < 40)), "missing days tolerated");
  const sparse = rows.map((r, i) => (i % 2 === 0 ? { ...r, tk: NaN } : r));
  assert.equal(pw.trailing(sparse, "tk", 7).length, 0, "too sparse to average");
  ok("PortWatch gaps");
}

// ---------------------------------------------------------------- calendar
{
  const ev = events(new Date("2026-09-01T00:00:00Z"), new Date("2027-01-15T00:00:00Z"));
  const find = (tag, day) => ev.find((e) => e.tag === tag && iso(e.t) === day);
  // Labor Day, Monday 7 Sept 2026: EIA moves to Thursday 11:00 New York (15:00 UTC), API to Wednesday
  assert.ok(find("EIA", "2026-09-10") && !find("EIA", "2026-09-09"), "EIA after a Monday holiday");
  assert.equal(find("EIA", "2026-09-10").t.toISOString(), "2026-09-10T15:00:00.000Z");
  assert.ok(find("API", "2026-09-09"), "API a day later too");
  // a normal week: Wednesday 10:30 New York, which is 15:30 UTC in winter
  assert.equal(find("EIA", "2026-11-04").t.toISOString(), "2026-11-04T15:30:00.000Z");
  // Thanksgiving week: the rig count comes on Wednesday
  assert.ok(find("RIGS", "2026-11-25") && !find("RIGS", "2026-11-27"), "rig count on the Wednesday of Thanksgiving week");
  // Christmas Friday: CFTC on the next Monday, rigs on Thursday
  assert.ok(find("COT", "2026-12-28") && find("RIGS", "2026-12-24"), "Christmas shifts");
  // expiries from the exchange rules
  assert.ok(find("CL", "2026-11-20"), "WTI Dec-26 stops trading on 20 Nov 2026");
  assert.ok(find("BRENT", "2026-11-30"), "Brent Jan-27 on the last business day of November");
  // dated events
  assert.ok(find("STEO", "2026-11-10") && find("STEO", "2026-12-08"), "STEO release dates");
  assert.ok(find("OPEC+", "2026-12-06"), "OPEC+ ministerial meeting");
  assert.ok(ev.every((e, i) => i === 0 || e.t >= ev[i - 1].t), "sorted");
  ok("calendar: schedules, holiday shifts, expiries, dated events");
}

// ---------------------------------------------------------------- cracks
{
  const S = {
    EER_EPMRU_PF4_Y35NY_DPG: [{ t: "2026-10-23", v: 2.5 }],
    EER_EPD2DXL0_PF4_Y35NY_DPG: [{ t: "2026-10-23", v: 3.0 }],
    EER_EPJK_PF4_RGC_DPG: [{ t: "2026-10-23", v: 2.8 }],
    RWTC: [{ t: "2026-10-23", v: 80 }],
    RBRTE: [{ t: "2026-10-23", v: 84 }],
  };
  const c = crackSpreads(S);
  const r = c.rows[0];
  assert.equal(r.k321, (2 * 2.5 * 42 + 3.0 * 42 - 3 * 80) / 3);
  assert.equal(r.k321, 32);
  assert.equal(r.diesel, 3.0 * 42 - 84);
  assert.equal(r.gas, 2.5 * 42 - 84);
  assert.ok(Math.abs(r.jet - (2.8 * 42 - 84)) < 1e-9);
  assert.equal(c.dieselLeg, "EER_EPD2DXL0_PF4_Y35NY_DPG");
  ok("crack spreads");
}

console.log("global: all checks passed");
