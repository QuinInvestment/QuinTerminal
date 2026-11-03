// Panels: the unit every function screen is built from. A panel owns a header
// (title, sources, freshness, actions), a body, and optional table data so
// every chart has a table view and a CSV export.

import { h, icon, ICONS, mount, clear, $ } from "./dom.js";
import { ago } from "./fmt.js";
import { openDrawer } from "./ui.js";
import { SOURCES } from "./health.js";

let focusState = null;

export function grid(...panels) {
  return h("div", { class: "grid" }, panels.map((p) => (p && p.el ? p.el : p)));
}

/**
 * panel({ title, span, rows, src: ["eia"], method: "text/html", flush, chart, lead, alarm, foot })
 */
export function panel(opts = {}) {
  const { title = "", span = 4, rows = 6, src = [], method = null, flush = false, chart = false, lead = false, alarm = false, foot = null, cls = "" } = opts;
  const titleEl = h("div", { class: "p-title" }, title);
  const metaText = h("span", { class: "p-time" });
  const srcBtn = (id) => h("button", { class: "p-src", type: "button", title: (SOURCES[id]?.name || id) + " — open data sources", onclick: () => window.dispatchEvent(new CustomEvent("qt:go", { detail: { code: "SYS", arg: id } })) }, shortName(id));
  const srcEls = src.slice(0, 2).map(srcBtn);
  if (src.length > 2) srcEls.push(h("button", { class: "p-src", type: "button", title: src.slice(2).map((id) => SOURCES[id]?.name || id).join(", "), onclick: () => window.dispatchEvent(new CustomEvent("qt:go", { detail: { code: "SYS" } })) }, "+" + (src.length - 2)));
  const actions = h("div", { class: "p-actions" });
  const head = h("div", { class: "p-head" }, titleEl, h("div", { class: "p-meta" }, srcEls, metaText), actions);
  const body = h("div", { class: "p-body" + (flush ? " flush" : "") + (chart ? " chart" : "") });
  const el = h("section", { class: `panel ${lead ? "lead" : ""} ${alarm ? "alarm" : ""} ${cls}`.trim(), style: { gridColumn: `span ${span}`, gridRow: `span ${rows}` } }, head, body);
  let footEl = null;
  if (foot) { footEl = h("div", { class: "p-foot" }, foot); el.appendChild(footEl); }

  let tableData = null;
  let updatedAt = 0;
  let stateEl = null;

  const btn = (ic, label, fn) => h("button", { class: "p-btn", type: "button", title: label, "aria-label": label, onclick: fn }, icon(ICONS[ic]));
  const tableBtn = btn("table", "Table view", () => showTable());
  const csvBtn = btn("download", "Export CSV", () => exportCsv());
  tableBtn.hidden = csvBtn.hidden = true;
  if (method) actions.appendChild(btn("info", "Method and sources", () => openDrawer(title + " — method", typeof method === "function" ? method() : method)));
  actions.append(tableBtn, csvBtn, btn("expand", "Focus", () => toggleFocus(api)));

  function showTable() {
    if (!tableData) return;
    const { columns, rows: data } = tableData;
    const tbl = h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, columns.map((c) => h("th", { class: c.num ? "r" : "" }, c.label)))),
      h("tbody", {}, data.slice(0, 5000).map((r) => h("tr", {}, columns.map((c, i) => h("td", { class: c.num ? "r" : "" }, fmtCell(r[i], c)))))));
    openDrawer(title + " — data", h("div", {}, h("p", { class: "note" }, `${data.length.toLocaleString()} rows. Use Export CSV for the full set.`), tbl));
  }

  function exportCsv() {
    if (!tableData) return;
    const { columns, rows: data } = tableData;
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = [columns.map((c) => esc(c.label)).join(","), ...data.map((r) => r.map(esc).join(","))].join("\n");
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const a = h("a", { href: URL.createObjectURL(blob), download: slug(title) + ".csv" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  const api = {
    el, body, head, opts,
    setTitle(t) { mount(titleEl, t); },
    touch(ts = Date.now()) { updatedAt = ts; metaText.dataset.ts = String(ts); metaText.textContent = ago(ts); metaText.title = "Updated " + new Date(ts).toLocaleString(); },
    get updatedAt() { return updatedAt; },
    setFoot(content) {
      if (!footEl) { footEl = h("div", { class: "p-foot" }); el.appendChild(footEl); }
      mount(footEl, content);
    },
    /** state: "loading" | "error" | "empty" | "ok" */
    state(kind, msg, detail) {
      el.classList.toggle("is-loading", kind === "loading");
      if (stateEl) { stateEl.remove(); stateEl = null; }
      if (kind === "ok") return;
      const inner = kind === "loading"
        ? h("div", { class: "msg" }, h("div", { class: "spinner" }), msg || "Loading")
        : h("div", { class: "msg" }, h("strong", {}, msg || (kind === "error" ? "No data" : "Nothing to show")), detail ? h("div", {}, detail) : null);
      stateEl = h("div", { class: "p-state " + (kind === "error" ? "err" : "") }, inner);
      body.appendChild(stateEl);
    },
    /** columns: [{label, num, d}], rows: arrays */
    setData(columns, rows) {
      tableData = { columns, rows };
      tableBtn.hidden = csvBtn.hidden = !rows || !rows.length;
    },
    addAction(node) { actions.prepend(node); },
    clear() { clear(body); stateEl = null; },
  };
  return api;
}

function fmtCell(v, c) {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return c.d != null ? v.toFixed(c.d) : (Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(+v.toFixed(4)));
  return String(v);
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "data";
}

function shortName(id) {
  return ({ hl: "HL", eia: "EIA", cftc: "CFTC", straits: "STR", poly: "POLY", ais: "AIS", meteo: "WX", gdacs: "GDACS", eonet: "EONET", wiki: "WIKI", gdelt: "GDELT", fx: "FX", basemap: "MAP", gibs: "GIBS", tv: "TV", yahoo: "YF", adsb: "ADSB", rss: "RSS", firms: "FIRMS", archive: "ARCH", portwatch: "PW" })[id] || id.toUpperCase();
}

// ---------------------------------------------------------------- focus mode
export function toggleFocus(p) {
  const layer = $("#focusLayer");
  if (focusState && focusState.p === p) return exitFocus();
  if (focusState) exitFocus();
  const ph = document.createComment("panel-placeholder");
  p.el.parentNode.insertBefore(ph, p.el);
  focusState = { p, ph, style: p.el.getAttribute("style") };
  p.el.removeAttribute("style");
  layer.appendChild(p.el);
  layer.hidden = false;
}

export function exitFocus() {
  if (!focusState) return false;
  const { p, ph, style } = focusState;
  if (style) p.el.setAttribute("style", style);
  ph.parentNode ? ph.parentNode.replaceChild(p.el, ph) : p.el.remove();
  $("#focusLayer").hidden = true;
  focusState = null;
  return true;
}

export function resetFocus() {
  if (focusState) { const { ph } = focusState; ph.remove(); focusState.p.el.remove(); }
  focusState = null;
  const layer = $("#focusLayer");
  clear(layer);
  layer.hidden = true;
}

/** Re-stamp the "x ago" labels once a minute. */
export function startAgoTicker() {
  setInterval(() => {
    document.querySelectorAll(".p-time").forEach((el) => {
      const t = Number(el.dataset.ts || 0);
      if (t) el.textContent = ago(t);
    });
  }, 20000);
}
