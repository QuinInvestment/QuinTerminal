// QuinTerminal — boot, router, tape, status and command registry.

import { $, h, mount, sparkline } from "./core/dom.js";
import { pub, sub, get, Scope } from "./core/bus.js";
import { settings, save, set, proxyOn } from "./core/settings.js";
import { register, initCommandLine, all as allCommands } from "./core/cmd.js";
import { renderClocks } from "./core/clock.js";
import { initDrawer, openDrawer, closeDrawer, toast } from "./core/ui.js";
import { exitFocus, resetFocus, startAgoTicker } from "./core/layout.js";
import { disposeAll } from "./core/charts.js";
import * as health from "./core/health.js";
import * as alerts from "./core/alerts.js";
import * as hl from "./data/hyperliquid.js";
import * as straits from "./data/straits.js";
import { px, signed, spct, dirClass, int, ago } from "./core/fmt.js";

export const MODULES = [
  { code: "OIL", label: "Cockpit", key: "F1", alt: "1", load: () => import("./modules/cockpit.js") },
  { code: "MAP", label: "World map", key: "F3", alt: "3", load: () => import("./modules/map.js") },
  { code: "NEWS", label: "News wire", alt: "0", load: () => import("./modules/news.js") },
  { code: "CAL", label: "Calendar", load: () => import("./modules/calendar.js") },
  { code: "BAL", label: "World balance", key: "F2", load: () => import("./modules/balance.js") },
  { code: "STK", label: "Inventories", key: "F6", alt: "5", load: () => import("./modules/stocks.js") },
  { code: "REF", label: "Refining", load: () => import("./modules/refining.js") },
  { code: "FLOW", label: "Chokepoints", load: () => import("./modules/flows.js") },
  { code: "SHIP", label: "Tankers", alt: "9", load: () => import("./modules/maritime.js") },
  { code: "CRV", label: "Prices & curve", key: "F4", alt: "4", load: () => import("./modules/curve.js") },
  { code: "FCST", label: "Forecast lab", key: "F9", alt: "8", load: () => import("./modules/forecast.js") },
  { code: "RISK", label: "Event risk", key: "F8", alt: "7", load: () => import("./modules/risk.js") },
  { code: "POS", label: "Positioning", key: "F7", alt: "6", load: () => import("./modules/positioning.js") },
  { code: "XAS", label: "Cross-asset", load: () => import("./modules/xasset.js") },
  { code: "HRMZ", label: "Strait of Hormuz", alt: "2", load: () => import("./modules/hormuz.js") },
  { code: "SYS", label: "Data & settings", load: () => import("./modules/system.js") },
];

const RAIL = [
  ["Overview", ["OIL", "MAP", "NEWS", "CAL"]],
  ["Physical market", ["BAL", "STK", "REF", "FLOW", "SHIP"]],
  ["Markets", ["CRV", "FCST", "RISK", "POS", "XAS"]],
  ["Regions", ["HRMZ"]],
  [null, ["SYS"]],
];

let current = null; // { code, mod, scope }
let navToken = 0;

// ---------------------------------------------------------------- router
export async function go(code, arg = "") {
  const entry = MODULES.find((m) => m.code === code) || MODULES[0];
  const token = ++navToken;
  exitFocus();
  resetFocus();
  closeDrawer();
  if (current) {
    try { current.scope.dispose(); current.mod.unmount?.(); } catch (e) { console.error(e); }
    disposeAll();
    current = null;
  }
  document.querySelectorAll(".fn").forEach((b) => b.setAttribute("aria-current", b.dataset.code === entry.code ? "page" : "false"));
  const view = $("#view");
  mount(view, h("div", { class: "p-state" }, h("div", { class: "msg" }, h("div", { class: "spinner" }), "Loading " + entry.label.toLowerCase())));
  let mod;
  try {
    mod = (await entry.load()).default;
  } catch (e) {
    console.error(e);
    mount(view, h("div", { class: "p-state err" }, h("div", { class: "msg" }, h("strong", {}, "This function failed to load"), String(e.message || e))));
    return;
  }
  if (token !== navToken) return;
  mount($("#viewTitle"), h("span", { class: "code" }, entry.code), mod.title || entry.label);
  $("#viewSub").textContent = mod.sub || "";
  const tools = $("#viewTools");
  mount(tools);
  mount(view);
  view.scrollTop = 0;
  const scope = new Scope();
  current = { code: entry.code, mod, scope };
  settings.module = entry.code;
  save();
  if (location.hash.slice(1).split("/")[0] !== entry.code) history.replaceState(null, "", "#" + entry.code + (arg ? "/" + encodeURIComponent(arg) : ""));
  document.title = `${entry.code} ${mod.title || entry.label} | QuinTerminal`;
  try {
    await mod.mount(view, { scope, tools, arg, go });
  } catch (e) {
    console.error(e);
    view.appendChild(h("div", { class: "p-state err" }, h("div", { class: "msg" }, h("strong", {}, "Something broke while drawing this screen"), String(e.message || e))));
  }
}

function buildRail() {
  const rail = $("#rail");
  const nodes = [];
  RAIL.forEach(([label, codes], gi) => {
    if (label) nodes.push(h("div", { class: "rail-group" }, label));
    else if (gi) nodes.push(h("div", { class: "rail-sep" }));
    for (const code of codes) {
      const m = MODULES.find((x) => x.code === code);
      nodes.push(h("button", { class: "fn", type: "button", dataset: { code }, title: `${m.label} (${m.code}${m.key ? ", " + m.key : ""})`, onclick: () => go(code) },
        h("span", { class: "code" }, m.code), h("span", { class: "lbl" }, m.label), h("span", { class: "key" }, m.key || "")));
    }
  });
  nodes.push(h("div", { class: "rail-note" }, "Type a code in the GO bar or press its key. Every figure names its source and its age."));
  mount(rail, nodes);
}

// ---------------------------------------------------------------- tape
const TAPE = ["BRENT", "WTI", "BW", "HO", "CRACK", "NG", "GOLD", "SPX", "NDX", "EUR", "JPY", "TLT", "COPPER"];
const tapeEls = new Map();

function buildTape() {
  const tape = $("#tape");
  mount(tape, TAPE.map((k) => {
    const el = h("button", { class: "tk", type: "button", dataset: { k }, onclick: () => go("CRV", k) },
      h("span", { class: "sym" }, k), h("span", { class: "ch" }), h("span", { class: "px" }, "—"));
    tapeEls.set(k, el);
    return el;
  }));
  sub("tape", (t) => {
    for (const k of TAPE) {
      const r = t.rows[k] || t.derived[k];
      const el = tapeEls.get(k);
      if (!r || !el) continue;
      el.querySelector(".sym").textContent = r.short || k;
      el.querySelector(".px").textContent = px(r.px);
      const ch = el.querySelector(".ch");
      ch.textContent = r.derived ? signed(r.ch) : spct(r.chPct);
      ch.className = "ch " + dirClass(r.ch);
      el.classList.toggle("illiquid", !!r.illiquid);
      el.title = `${r.name}${r.illiquid ? ", thin market: treat with care" : ""}${r.derived ? "" : `. 24h ${spct(r.chPct)}, volume $${int((r.vol || 0) / 1e6)}M`}`;
      const old = el.querySelector("svg.sp");
      if (r.spark && r.spark.length > 2) {
        const s = sparkline(r.spark, { color: r.ch >= 0 ? "var(--up)" : "var(--down)" });
        if (old) old.replaceWith(s); else el.appendChild(s);
      }
    }
  });
  for (const k of TAPE) {
    sub("tick:" + k, ({ dir }) => {
      const el = tapeEls.get(k);
      if (!el) return;
      el.classList.remove("flash-up", "flash-down");
      void el.offsetWidth;
      el.classList.add(dir > 0 ? "flash-up" : "flash-down");
    }, { replay: false });
  }
  let last = 0;
  sub("tape", () => {
    if (Date.now() - last < 2000) return;
    last = Date.now();
    alerts.evaluateRules(hl.prices());
  });
}

// ---------------------------------------------------------------- shared feeds
// The Hormuz status feeds several screens (cockpit, chokepoints, risk, forecast
// lab), so it is loaded once here and published on the bus.
function startStraitsFeed() {
  const load = async () => {
    try {
      const raw = await straits.status();
      pub("straits:raw", raw);
      pub("straits:digest", straits.digest(raw));
    } catch {}
  };
  load();
  setInterval(() => { if (!document.hidden) load(); }, 120e3);
}

// ---------------------------------------------------------------- health + status bar
// One word for the state of the data, with its dot: Live, Delayed or Offline.
function startStatus() {
  const pill = $("#healthPill");
  pill.addEventListener("click", () => go("SYS"));
  let stream = "connecting", sum = null;
  const paint = () => {
    const s = sum || { ok: 0, stale: 0, err: 0 };
    const live = s.ok + s.stale;
    const tracked = live + s.err;
    let word = "Connecting", cls = "";
    if (tracked || stream === "live") {
      if (stream === "live" && s.err <= tracked / 3 && s.stale === 0) { word = "Live"; cls = "ok"; }
      else if (stream === "live" || live > 0) { word = "Delayed"; cls = "warn"; }
      else { word = "Offline"; cls = "err"; }
    }
    $("#healthText").textContent = word;
    $("#healthDot").className = "dot " + cls;
    $("#healthCount").textContent = tracked ? `${live}/${tracked}` : "";
    pill.title = tracked ? `${s.ok} sources live, ${s.stale} on a cached copy, ${s.err} failing. Price stream ${stream}.` : "Connecting to the data sources";
    $("#sbSources").textContent = `Sources: ${s.ok} live, ${s.stale} cached, ${s.err} failing`;
  };
  sub("health", (s) => { sum = s; paint(); });
  sub("hl:status", (st) => {
    stream = st.state;
    $("#sbWs").replaceChildren(h("span", { class: "dot " + (st.state === "live" ? "ok" : st.state === "connecting" ? "warn" : "err") }), st.state === "live" ? "Price stream live (Hyperliquid)" : st.state === "connecting" ? "Price stream connecting" : "Price stream down, retrying");
    paint();
  });
  const paintProxy = () => { $("#sbProxy").textContent = proxyOn() ? "Edge proxy on" : "Edge proxy off"; };
  paintProxy();
  window.addEventListener("qt:settings", paintProxy);
}

// ---------------------------------------------------------------- alerts button
function startAlertsUi() {
  const badge = $("#alertsBadge");
  sub("alerts", (a) => { badge.hidden = !a.unseen; badge.textContent = String(Math.min(99, a.unseen)); });
  $("#alertsBtn").addEventListener("click", () => { alerts.markSeen(); openAlertsDrawer(); });
}

export function openAlertsDrawer() {
  const log = alerts.list();
  const rules = settings.alertRules || [];
  const sym = h("select", { class: "in", "aria-label": "Instrument" }, ["BRENT", "WTI", "BW", "CRACK", "HO", "NG", "GOLD", "SPX"].map((s) => h("option", { value: s }, s)));
  const op = h("select", { class: "in", "aria-label": "Direction" }, h("option", { value: ">" }, "above"), h("option", { value: "<" }, "below"));
  const val = h("input", { class: "in", type: "number", step: "0.1", placeholder: "Level", "aria-label": "Level", style: { width: "96px" } });
  const content = h("div", {},
    h("h3", { class: "prose" }, "Price rules"),
    h("p", { class: "note" }, "A rule fires once each time the live price crosses the level. Rules are stored in this browser."),
    h("table", { class: "tbl" }, h("tbody", {}, rules.map((r) => h("tr", {},
      h("td", {}, `${r.sym} ${r.op === ">" ? "above" : "below"} ${r.value}`),
      h("td", { class: "c", style: { textAlign: "right" } }, h("button", { class: "btn ghost", type: "button", onclick: () => { alerts.removeRule(r.id); openAlertsDrawer(); } }, "Remove")))))),
    h("div", { class: "row", style: { margin: "12px 0 18px" } }, sym, op, val,
      h("button", { class: "btn primary", type: "button", onclick: () => { const v = parseFloat(val.value); if (Number.isFinite(v)) { alerts.addRule(sym.value, op.value, v); openAlertsDrawer(); } } }, "Add rule"),
      h("button", { class: "btn", type: "button", onclick: async () => { const ok = await alerts.enableNotifications(); toast(ok ? "Desktop notifications on" : "Notifications blocked by the browser"); } }, "Desktop notifications")),
    h("h3", { class: "prose" }, "Alert log"),
    log.length ? h("div", {}, log.map((a) => h("div", { class: "alert-item" }, h("span", { class: "sev " + a.sev }), h("div", {}, h("div", {}, a.title), h("div", { class: "muted" }, a.text)), h("span", { class: "when" }, ago(a.ts)))))
      : h("p", { class: "note" }, "No alerts yet. Signals from the functions and your price rules will appear here."));
  openDrawer("Alerts", content);
}

// ---------------------------------------------------------------- theme
function applyTheme() {
  const root = document.documentElement;
  root.setAttribute("data-theme", settings.theme === "day" ? "day" : "night");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", getComputedStyle(root).getPropertyValue("--panel").trim());
}
/** "day", "night" or "toggle". */
export function setTheme(t) {
  set("theme", t === "toggle" ? (settings.theme === "day" ? "night" : "day") : t === "day" ? "day" : "night");
  applyTheme();
  if (current) go(current.code);
}

// ---------------------------------------------------------------- commands
function registerCommands() {
  MODULES.forEach((m, i) => register({ code: m.code, label: m.label, key: m.key, alt: m.alt, order: i, run: (arg) => go(m.code, arg) }));
  register({ code: "HELP", aliases: ["?"], label: "List every function and command", order: 90, run: () => showHelp() });
  register({ code: "THEME", label: "Switch palette: THEME DAY or THEME NIGHT", args: "DAY|NIGHT", order: 91, run: (a) => setTheme(/day/i.test(a) ? "day" : /night/i.test(a) ? "night" : "toggle") });
  register({ code: "ALERT", label: "Add a price rule, e.g. ALERT BRENT > 120", args: "SYM >|< LEVEL", order: 92, run: (a) => {
    const m = a.toUpperCase().match(/^(\w+)\s*([<>])\s*([\d.]+)/);
    if (!m) return openAlertsDrawer();
    alerts.addRule(m[1], m[2], parseFloat(m[3]));
    toast("Rule added", `${m[1]} ${m[2]} ${m[3]}`);
  } });
  register({ code: "OPT", label: "Price an option: OPT strike days [vol%] [call|put]", args: "K DAYS", order: 93, run: (a) => go("FCST", "opt " + a) });
  register({ code: "SHOCK", label: "Supply shock: SHOCK mb/d days", args: "MBD DAYS", order: 94, run: (a) => go("FCST", "shock " + a) });
  register({ code: "CHART", aliases: ["GP"], label: "Price chart: CHART WTI 15m", args: "SYM INT", order: 95, run: (a) => go("CRV", a) });
  register({ code: "POLY", label: "Search event markets: POLY iran", args: "QUERY", order: 96, run: (a) => go("RISK", a) });
  register({ code: "PROXY", label: "Set the edge proxy URL", args: "URL", order: 97, run: (a) => { set("proxyUrl", a.trim()); window.dispatchEvent(new Event("qt:settings")); toast(a.trim() ? "Edge proxy set" : "Edge proxy cleared", a.trim()); } });
  register({ code: "KEY", label: "Store an API key: KEY EIA abc… or KEY FIRMS abc…", args: "EIA|FIRMS KEY", order: 98, run: (a) => {
    const [which, k] = a.trim().split(/\s+/);
    if (/eia/i.test(which)) set("eiaKey", k || ""); else if (/firms/i.test(which)) set("firmsKey", k || ""); else return toast("Use KEY EIA <key> or KEY FIRMS <key>");
    window.dispatchEvent(new Event("qt:settings"));
    toast("Key saved in this browser", which.toUpperCase());
  } });
  register({ code: "EXPORT", label: "Download a JSON snapshot of the live data", order: 99, run: () => exportSnapshot() });
}

function showHelp() {
  const rows = allCommands().sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  openDrawer("Functions and commands", h("div", {},
    h("p", { class: "note" }, "Type a code in the GO bar and press Enter or GO. Ctrl K or / focuses the bar; Tab completes; Esc leaves a full-screen panel."),
    h("table", { class: "tbl" }, h("tbody", {}, rows.map((c) => h("tr", {}, h("td", { class: "mono nowrap", style: { color: "var(--text)" } }, c.code + (c.args ? " " + c.args : "")), h("td", {}, c.label), h("td", { class: "muted nowrap mono" }, c.key || (c.alt ? "Alt " + c.alt : ""))))))));
}

function exportSnapshot() {
  const snap = {
    exportedAt: new Date().toISOString(),
    tape: get("tape"),
    hormuz: get("straits:digest"),
    sources: health.list().map(({ id, name, state, lastOk, ms, err }) => ({ id, name, state, lastOk: lastOk ? new Date(lastOk).toISOString() : null, ms, err })),
    alerts: alerts.list().slice(0, 50),
    note: "QuinTerminal snapshot. Sources: Hyperliquid, U.S. EIA, IMF PortWatch, straits.live and the others listed under SYS. Perp prices are not exchange settlements.",
  };
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `quinterminal-snapshot-${Date.now()}.json` });
  document.body.appendChild(a); a.click(); a.remove();
}

// ---------------------------------------------------------------- boot
function boot() {
  applyTheme();
  buildRail();
  buildTape();
  registerCommands();
  initCommandLine();
  initDrawer();
  renderClocks();
  startStatus();
  startAlertsUi();
  startStraitsFeed();
  startAgoTicker();
  $("#themeBtn").addEventListener("click", () => setTheme("toggle"));
  $("#settingsBtn").addEventListener("click", () => go("SYS"));
  window.addEventListener("qt:go", (e) => go(e.detail.code, e.detail.arg || ""));
  window.addEventListener("qt:theme", (e) => setTheme(e.detail));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!closeDrawer()) exitFocus(); } });
  window.addEventListener("hashchange", () => {
    const [code, arg] = location.hash.slice(1).split("/");
    if (code && (!current || current.code !== code.toUpperCase())) go(code.toUpperCase(), decodeURIComponent(arg || ""));
  });
  hl.startTape();
  const [code, arg] = location.hash.slice(1).split("/");
  go((code || settings.module || "OIL").toUpperCase(), decodeURIComponent(arg || ""));
}

boot();
