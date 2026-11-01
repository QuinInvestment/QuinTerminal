// News aggregation and a transparent headline classifier. Sources: straits.live
// incident feed (always), GDELT (best effort), RSS through the edge proxy
// (optional). Each headline gets topic tags, a region and a supply-risk sign.

import * as straits from "./straits.js";
import * as gdelt from "./gdelt.js";
import { rssAll } from "./proxy.js";
import { proxyOn } from "../core/settings.js";

const RULES = [
  { tag: "Supply risk", sign: +1, re: /\b(attack(ed|s)?|strike[sd]?|drone|missile|explosion|blaze|fire|outage|shut(s|down)?|halt(ed|s)?|clos(e|ed|ure)|blockade|seiz(e|ed|ure)|mines?|hijack|sabotage|force majeure|disrupt(ion|ed|s)?|struck|sank|sunk|evacuat\w+|output cut|cuts? output|production cut)\b/i },
  { tag: "Supply relief", sign: -1, re: /\b(reopen\w*|resum(e|es|ed|ption)|restart\w*|restor(e|es|ed|ing)|ceasefire|truce|deal|agreement|release[sd]? (of )?(oil|crude|stocks|reserves)|spr release|boost(s|ed)? output|raise[sd]? output|increase[sd]? (output|production)|lift(s|ed)? sanctions|waiver|escort(s|ed)? through|back to [\d.]+ million)\b/i },
  // phrases where a risk word ("mines") appears in a relief context: counted twice so relief wins
  { tag: "Supply relief", sign: -2, re: /\b(cleared of mines|clear(s|ing)? (the )?mines|mine[- ]?clear\w*|demining|lanes? (re)?opened|safe passage)\b/i },
  { tag: "Demand", sign: 0, re: /\b(demand|recession|slowdown|consumption|pmi|gdp|imports? (fell|drop|rose|jump))\b/i },
  { tag: "Inventories", sign: 0, re: /\b(inventor(y|ies)|stockpile|stocks? (draw|build|fell|rose)|cushing|eia|api (data|report))\b/i },
  { tag: "Shipping", sign: 0, re: /\b(tankers?|vlcc|shipping|freight|war[- ]risk|insurance|vessel|ship|convoy|escort|reroute\w*|cape of good hope)\b/i },
  { tag: "Policy", sign: 0, re: /\b(opec\+?|quota|iea|sanction\w*|tariff|embargo|price cap|white house|pentagon|treasury)\b/i },
];

// Each region has strong cues (waterways, ports, fields) and weak ones
// (countries, companies). A strong cue anywhere beats a weak one, so "Saudi Red
// Sea ports" files under the Red Sea, not the Gulf.
const REGIONS = [
  { id: "gulf", label: "Gulf / Hormuz", strong: /\b(hormuz|persian gulf|arabian gulf|gulf of oman|kharg|fujairah|bandar abbas|ras tanura|abqaiq|basra|ras laffan|jebel ali|ruwais)\b/i, weak: /\b(iran\w*|saudi\w*|aramco|uae|emirat\w+|kuwait\w*|qatar\w*|iraq\w*|bahrain\w*|oman\w*|tehran|irgc)\b/i },
  { id: "redsea", label: "Red Sea", strong: /\b(red sea|bab el-mandeb|bab-el-mandeb|bab al-mandab|suez|yanbu|jeddah|aden|eilat|sumed)\b/i, weak: /\b(houthi\w*|yemen\w*|egypt\w*)\b/i },
  { id: "russia", label: "Russia / Black Sea / Baltic", strong: /\b(primorsk|ust-luga|novorossiysk|druzhba|black sea|baltic|cpc|kozmino|gulf of finland)\b/i, weak: /\b(russia\w*|ukrain\w*|shadow fleet|kazakh\w*|kremlin)\b/i },
  { id: "africa", label: "Africa", strong: /\b(niger delta|es sider|bonny)\b/i, weak: /\b(libya\w*|nigeria\w*|angola\w*|algeria\w*|sudan\w*)\b/i },
  { id: "americas", label: "Americas", strong: /\b(permian|cushing|gulf of mexico|alberta|spr|strategic petroleum reserve)\b/i, weak: /\b(venezuela\w*|guyana|brazil\w*|mexico|canada|texas|u\.s\.|united states|washington)\b/i },
  { id: "asia", label: "Asia", strong: /\b(malacca|singapore|shandong)\b/i, weak: /\b(china|chinese|india\w*|japan\w*|korea\w*|beijing)\b/i },
];

export function classify(title) {
  const tags = [];
  let score = 0;
  for (const r of RULES) if (r.re.test(title)) { tags.push(r.tag); score += r.sign; }
  const region = REGIONS.find((r) => r.strong.test(title)) || REGIONS.find((r) => r.weak.test(title));
  return { tags: [...new Set(tags)], score: Math.max(-1, Math.min(1, score)), region: region ? region.id : "other", regionLabel: region ? region.label : "Other" };
}

export const REGION_LIST = REGIONS.map(({ id, label }) => ({ id, label }));

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = it.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter((w) => w.length > 3).slice(0, 8).join(" ");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/**
 * Merge every news source into one classified, de-duplicated stream.
 * onUpdate (optional) receives the partial result each time a source lands,
 * so the wire can draw before the slow ones (GDELT) answer.
 * Returns { items, sources: {name: "ok"|"err"|"off"|"pending"} }.
 */
export async function wire({ gdeltQuery = '(oil OR crude OR brent OR opec OR tanker OR refinery OR "strait of hormuz")', onUpdate } = {}) {
  const sources = { "straits.live incidents": "pending", GDELT: "pending" };
  const items = [];
  const snapshot = () => ({ items: dedupe([...items].sort((a, b) => b.t - a.t)).map((it) => ({ ...it, ...classify(it.title) })), sources: { ...sources } });
  const emit = () => { try { onUpdate?.(snapshot()); } catch (e) { console.error(e); } };
  const tasks = [
    straits.events().then((rows) => {
      sources["straits.live incidents"] = "ok";
      for (const r of rows) {
        const t = Date.parse(r.occurred_at_iso || r.occurredAt || r.occurred_at || r.date || r.time || r.published || "");
        const title = r.title || r.headline || "";
        if (!title) continue;
        items.push({ title, url: r.url || r.source_url || r.sourceUrl || r.link || "", src: r.source_name || r.source || "straits.live", t: Number.isFinite(t) ? t : Date.now(), type: r.type || r.event_type || "" });
      }
    }).catch(() => { sources["straits.live incidents"] = "err"; }).finally(emit),
    gdelt.articles(gdeltQuery, { timespan: "2d", max: 75 }).then((rows) => {
      sources.GDELT = "ok";
      for (const r of rows) items.push({ ...r, src: r.src || "gdelt" });
    }).catch(() => { sources.GDELT = "err"; }).finally(emit),
  ];
  if (proxyOn()) {
    sources["RSS (edge proxy)"] = "pending";
    tasks.push(rssAll().then(({ items: rss, status }) => {
      delete sources["RSS (edge proxy)"];
      Object.assign(sources, status);
      items.push(...rss);
    }).catch(() => { sources["RSS (edge proxy)"] = "err"; }).finally(emit));
  } else {
    sources["RSS (needs edge proxy)"] = "off";
  }
  await Promise.all(tasks);
  return snapshot();
}

/** last-24h balance of supply-risk vs relief headlines, -1..+1 */
export function pressure(items, hours = 24) {
  const cut = Date.now() - hours * 3600e3;
  const recent = items.filter((i) => i.t >= cut && i.score !== 0);
  if (!recent.length) return { value: 0, n: 0 };
  return { value: recent.reduce((s, i) => s + i.score, 0) / recent.length, n: recent.length };
}
