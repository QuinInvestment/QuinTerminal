// Shared building blocks for the function screens.

import { h, mount } from "../core/dom.js";
import { px, signed, spct, pct, dirClass, num, isNum } from "../core/fmt.js";
import * as health from "../core/health.js";
import { makeChart } from "../core/charts.js";

/** Run an async loader inside a panel: spinner, error state, freshness stamp. */
export async function load(p, fn, { quiet = false, label } = {}) {
  if (!quiet && !p.updatedAt) p.state("loading", label);
  try {
    const out = await fn();
    p.state("ok");
    p.touch();
    return out;
  } catch (e) {
    console.warn("[panel]", p.opts.title, e);
    const src = (p.opts.src || []).map((id) => health.SOURCES[id]?.name || id).join(", ");
    if (!p.updatedAt) p.state("error", "Data unavailable", `${e.message || e}${src ? ` — source: ${src}` : ""}`);
    return undefined;
  }
}

/** Mount an ECharts chart inside a panel body (once) and return the handle. */
export async function chartIn(p) {
  if (p._chart) return p._chart;
  const box = h("div", { class: "chart-box" });
  p.body.appendChild(box);
  p._chart = await makeChart(box);
  return p._chart;
}

export function stat(label, value, delta, { cls = "", deltaCls, title, big = false } = {}) {
  return h("div", { class: "stat" + (big ? " big" : ""), title: title || "" },
    h("span", { class: "s-l" }, label),
    h("span", { class: "s-v " + cls }, value),
    delta != null && delta !== "" ? h("span", { class: "s-d " + (deltaCls || "") }, delta) : null);
}

export function quote(r, { showBasis = true } = {}) {
  if (!r) return h("div", { class: "quote" }, "—");
  return h("div", { class: "quote" },
    h("div", { class: "q-name" }, r.name, r.illiquid ? h("span", { class: "tag warn", title: "Less than $2M traded in 24h" }, "THIN") : null),
    h("div", { class: "q-px num" }, px(r.px)),
    h("div", { class: "q-ch " + dirClass(r.ch) }, `${signed(r.ch)}  ${spct(r.chPct)}`),
    h("div", { class: "q-row" },
      h("span", {}, "Oracle ", h("b", {}, px(r.oracle))),
      showBasis ? h("span", {}, "Basis ", h("b", {}, isNum(r.basis) ? (r.basis * 1e4).toFixed(1) + " bp" : "—")) : null,
      h("span", {}, "Funding ", h("b", {}, isNum(r.funding) ? (r.funding * 100 * 24 * 365).toFixed(1) + "%/yr" : "—")),
      h("span", {}, "24h vol ", h("b", {}, isNum(r.vol) ? "$" + num(r.vol / 1e6, 0) + "M" : "—"))));
}

export function pbar(label, p, { d1, color = "var(--s1)", href, sub } = {}) {
  const lab = href ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, label) : label;
  return h("div", { style: { padding: "5px 0", borderBottom: "1px solid var(--line)" } },
    h("div", { class: "row", style: { justifyContent: "space-between", gap: "8px", marginBottom: "3px" } },
      h("span", { class: "small", style: { color: "var(--ink-1)" } }, lab),
      isNum(d1) && Math.abs(d1) >= 0.0005 ? h("span", { class: "tiny " + dirClass(d1) }, `${d1 > 0 ? "+" : "−"}${num(Math.abs(d1) * 100, 1)} pts 24h`) : null),
    h("div", { class: "pbar" }, h("div", { class: "track" }, h("div", { class: "fill", style: { width: `${Math.max(0, Math.min(100, (p || 0) * 100))}%`, background: color } })), h("span", { class: "val" }, isNum(p) ? pct(p, p < 0.1 ? 1 : 0) : "—")),
    sub ? h("div", { class: "tiny muted", style: { marginTop: "2px" } }, sub) : null);
}

/** Diverging factor bar: z in [-3, 3] mapped to the half-width. */
export function factor(name, z, text, title) {
  const w = isNum(z) ? Math.min(1, Math.abs(z) / 3) * 50 : 0;
  return h("div", { class: "factor", title: title || "" },
    h("span", { class: "f-name" }, name),
    h("span", { class: "f-track" }, isNum(z) ? h("span", { class: "f-bar " + (z >= 0 ? "pos" : "neg"), style: { width: w + "%" } }) : null),
    h("span", { class: "f-v " + (isNum(z) ? (z > 0 ? "" : "") : "muted") }, text ?? (isNum(z) ? signed(z, 1) : "—")));
}

export function table(cols, rows, { onRow, selected } = {}) {
  return h("table", { class: "tbl" },
    h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.r ? "r" : "", title: c.title || "" }, c.label)))),
    h("tbody", {}, rows.map((r, i) => h("tr", { class: (onRow ? "clickable " : "") + (selected === i ? "sel" : ""), onclick: onRow ? () => onRow(r, i) : null },
      cols.map((c) => { const v = c.get(r); return h("td", { class: (c.r ? "r " : "") + (c.cls ? c.cls(r) : "") }, v instanceof Node ? v : v ?? "—"); })))));
}

export function empty(text) { return h("div", { class: "note", style: { padding: "10px" } }, text); }

export function seg(options, value, onChange) {
  const el = h("div", { class: "seg", role: "group" });
  const paint = (v) => mount(el, options.map((o) => h("button", { type: "button", "aria-pressed": String(o.value === v), onclick: () => { paint(o.value); onChange(o.value); } }, o.label)));
  paint(value);
  return el;
}

export const ms = (iso) => Date.parse(String(iso).length <= 10 ? iso + "T00:00:00Z" : iso);
