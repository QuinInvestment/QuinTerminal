// SYS — data sources and their health, settings (keys, edge proxy, crisis
// banner), edge-proxy setup, about.

import { h, mount } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { settings, set, reset, proxyOn } from "../core/settings.js";
import { ago, int } from "../core/fmt.js";
import * as health from "../core/health.js";
import * as idb from "../core/idb.js";
import { dropMemoryCache } from "../core/fetcher.js";
import { toast } from "../core/ui.js";
import { table } from "./kit.js";

const STATE = {
  ok: ["ok", "live"],
  stale: ["warn", "cached copy"],
  err: ["crit", "failing"],
  idle: ["", "not used yet"],
  off: ["", "off"],
  pending: ["", "waiting"],
};

export default {
  title: "Data and settings",
  sub: "Every source, its status and latency; your keys and the optional edge proxy; how the terminal is built.",

  async mount(view, { scope, arg }) {
    const pSrc = panel({ title: "Data sources", span: 12, rows: 10, flush: true, lead: true, method: M_SRC });
    const pSet = panel({ title: "Settings", span: 6, rows: 9 });
    const pProxy = panel({ title: "Edge proxy (optional, free)", span: 6, rows: 9, method: M_PROXY });
    const pAbout = panel({ title: "About", span: 12, rows: 4 });
    view.appendChild(grid(pSrc, pSet, pProxy, pAbout));

    const stateOf = (r) => {
      const needsProxy = /edge proxy/.test(r.needs);
      if (r.state === "idle" && needsProxy && !proxyOn()) return ["", "off: needs edge proxy"];
      return STATE[r.state] || ["", r.state];
    };

    const paintSrc = () => {
      const rows = health.list();
      mount(pSrc.body, table([
        { label: "Source", get: (r) => h("span", { class: r.id === arg ? "ac" : "", style: { fontWeight: r.id === arg ? 700 : 400 } },
          r.docs?.startsWith("http") ? h("a", { href: r.docs, target: "_blank", rel: "noopener noreferrer" }, r.name) : r.name) },
        { label: "What", get: (r) => h("span", { class: "small dim" }, r.what) },
        { label: "Status", get: (r) => { const [cls, txt] = stateOf(r); return h("span", { class: "tag " + cls, title: r.err || r.note || "" }, txt); } },
        { label: "Last OK", r: true, get: (r) => (r.lastOk ? ago(r.lastOk) : "—") },
        { label: "Latency", r: true, get: (r) => (r.ms ? int(r.ms) + " ms" : "—") },
        { label: "Needs", get: (r) => h("span", { class: "small " + (r.needs === "none" ? "muted" : "") }, r.needs) },
        { label: "Note", get: (r) => h("span", { class: "tiny muted" }, r.err || r.note || "") },
      ], rows));
      pSrc.setData([{ label: "Id" }, { label: "Source" }, { label: "State" }, { label: "Last OK" }, { label: "Latency ms", num: true }, { label: "Needs" }, { label: "Error" }],
        rows.map((r) => [r.id, r.name, r.state, r.lastOk ? new Date(r.lastOk).toISOString() : "", r.ms ?? "", r.needs, r.err || ""]));
      pSrc.touch();
    };
    scope.sub("health", paintSrc);
    scope.every(15e3, paintSrc, { now: false });

    // ------------------------------------------------ settings
    const changed = () => window.dispatchEvent(new Event("qt:settings"));
    const field = (label, key, { type = "text", placeholder = "", hint = "" } = {}) => h("label", { class: "fld", style: { marginBottom: "10px" } }, label,
      h("input", { class: "in mono", type, value: settings[key] || "", placeholder, autocomplete: "off", spellcheck: "false",
        onchange: (e) => { set(key, e.target.value.trim()); changed(); toast("Saved", label); } }),
      hint ? h("span", { class: "tiny muted" }, hint) : null);
    mount(pSet.body,
      field("EIA API key", "eiaKey", { type: "password", placeholder: "DEMO_KEY is used when empty", hint: "Free and instant at eia.gov/opendata. DEMO_KEY is shared by everyone on your network and capped at about 30 calls an hour." }),
      field("Edge proxy URL", "proxyUrl", { placeholder: "https://qt-edge.<you>.workers.dev", hint: "Unlocks full futures strips, OVX, equities, military aircraft, RSS news and fire detections." }),
      field("NASA FIRMS map key", "firmsKey", { type: "password", placeholder: "optional", hint: "Free at firms.modaps.eosdis.nasa.gov/api/map_key. Used through the edge proxy." }),
      h("div", { class: "row" },
        h("label", { class: "fld" }, "Palette", h("select", { class: "in", onchange: (e) => window.dispatchEvent(new CustomEvent("qt:theme", { detail: e.target.value })) },
          h("option", { value: "night", selected: settings.theme !== "day" }, "Night"),
          h("option", { value: "day", selected: settings.theme === "day" }, "Day"))),
        h("label", { class: "fld" }, "Hormuz disruption start", h("input", { class: "in", type: "date", value: settings.crisisStart, onchange: (e) => { set("crisisStart", e.target.value); changed(); toast("Saved", "Disruption start date"); } }))),
      h("div", { class: "row", style: { marginTop: "12px" } },
        h("button", { class: "btn", type: "button", onclick: async () => { await idb.clearAll(); dropMemoryCache(); toast("Cached data cleared", "Panels fetch fresh data on their next refresh"); } }, "Clear cached data"),
        h("button", { class: "btn ghost", type: "button", onclick: () => { reset(); toast("Settings reset"); setTimeout(() => location.reload(), 400); } }, "Reset settings")),
      h("p", { class: "tiny muted", style: { marginTop: "8px" } }, "Keys and settings stay in this browser's local storage and are only sent to the service they belong to."));

    // ------------------------------------------------ proxy
    const status = h("span", { class: "small" });
    const testBtn = h("button", { class: "btn primary", type: "button", onclick: testProxy }, "Test proxy");
    const paintProxy = () => { testBtn.disabled = !proxyOn(); status.className = "small dim"; status.textContent = proxyOn() ? "Configured, not tested" : "Not configured"; };
    async function testProxy() {
      status.textContent = "Testing…";
      const t0 = performance.now();
      try {
        const r = await fetch(settings.proxyUrl.replace(/\/+$/, "") + "/health", { cache: "no-store", signal: AbortSignal.timeout(10e3) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json().catch(() => ({}));
        status.className = "small up";
        status.textContent = `Reachable in ${int(performance.now() - t0)} ms${j.hosts ? `, ${j.hosts} allowed hosts` : ""}`;
      } catch (e) {
        status.className = "small down";
        status.textContent = "Not reachable: " + (e.name === "TimeoutError" ? "timed out" : e.message);
      }
    }
    paintProxy();
    window.addEventListener("qt:settings", paintProxy);
    scope.add(() => window.removeEventListener("qt:settings", paintProxy));
    mount(pProxy.body,
      h("ol", { class: "prose", style: { paddingLeft: "18px", margin: "0 0 10px" } },
        h("li", {}, "Create a free Cloudflare account, open Workers & Pages and choose Create Worker."),
        h("li", {}, "Replace the starter code with ", h("code", {}, "worker/qt-edge.js"), " from this repository, then deploy."),
        h("li", {}, "Optional: add a ", h("code", {}, "FIRMS_KEY"), " secret in the worker's settings so the key never sits in the browser."),
        h("li", {}, "Paste the worker URL in Settings and press Test proxy.")),
      h("div", { class: "row" }, testBtn, status),
      h("p", { class: "tiny muted", style: { marginTop: "8px" } }, "The proxy forwards GET requests to an allow-list of public data hosts only, caches them at the edge and adds the CORS headers browsers need. Cloudflare's free tier allows 100,000 requests a day."));

    mount(pAbout.body, h("div", { class: "prose", style: { maxWidth: "none", columns: "2 360px", columnGap: "28px" } },
      h("p", {}, "QuinTerminal is a static web app: no server, no account, no tracking. Your browser talks directly to public APIs, and an optional edge proxy covers the few that refuse browser requests. Every panel names its sources, shows when it last updated, and has a method note (ⓘ), a table view and a CSV export."),
      h("p", {}, "Live prices come from 24/7 perpetual futures on Hyperliquid that track CME and ICE crude; they are not official exchange settlements. Fundamentals come from the EIA and the CFTC; physical flows from IMF PortWatch (via straits.live), Digitraffic AIS and the EIA; event odds from Polymarket; attention from Wikipedia; news from GDELT and RSS."),
      h("p", {}, "Forecasts are probabilistic and ship with their backtests. Nothing here is investment advice. Data can be late, wrong or missing; the table above says which feeds are live right now."),
      h("p", { class: "small" }, "Keyboard: Ctrl K or / to type a function, Tab to complete, Enter to run, Esc to leave a focused panel. F1 to F4 and F6 to F9 jump to the main functions; Alt plus a digit for the rest. Type HELP for every command.")));
  },
};

const M_SRC = `<p>Each source reports after every request: <b>live</b> means the last call succeeded, <b>cached copy</b> means the last call failed and the panel shows the most recent good copy (kept up to 30 minutes in memory, longer in IndexedDB for slow-moving data), <b>failing</b> means there is nothing to show.</p><p>Latency is the round trip of the last successful call, including queueing behind the per-host rate limits the terminal enforces (GDELT allows one call every 5 seconds; EIA's DEMO_KEY about 30 an hour).</p>`;
const M_PROXY = `<p>Some public sources do not send the CORS headers a browser needs (Yahoo Finance, adsb.lol, most RSS feeds, NASA FIRMS CSV). The edge proxy is a 150-line Cloudflare Worker that forwards GET requests to an explicit allow-list of those hosts, caches the response at the edge for a time that depends on the host, and adds the headers. It holds no user data and refuses every other destination, so it cannot be used as an open relay.</p>`;
