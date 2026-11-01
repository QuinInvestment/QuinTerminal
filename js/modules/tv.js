// TradingView embeddable widgets (free, delayed for most exchange data).
// If the script is blocked (ad blockers often do), the container says so
// instead of staying blank.
import { h } from "../core/dom.js";
import * as health from "../core/health.js";

export function tvWidget(container, kind, config, { fallback } = {}) {
  const inner = h("div", { class: "tradingview-widget-container__widget", style: { height: "100%" } });
  const wrap = h("div", { class: "tradingview-widget-container tv-box" }, inner);
  const s = document.createElement("script");
  s.type = "text/javascript";
  s.async = true;
  s.src = `https://s3.tradingview.com/external-embedding/embed-widget-${kind}.js`;
  s.textContent = JSON.stringify(config);
  s.onload = () => health.setState("tv", "ok", "widget loaded");
  s.onerror = () => {
    health.report("tv", { ok: false, err: "TradingView script blocked or unreachable" });
    wrap.replaceChildren(h("div", { class: "p-state err" }, h("div", { class: "msg" },
      h("strong", {}, "TradingView did not load"),
      fallback || "Content blockers often stop TradingView's widget script. Allow s3.tradingview.com for this site, or use the 24/7 perp charts in CRV.")));
  };
  wrap.appendChild(s);
  container.appendChild(wrap);
  return wrap;
}

export const tvTheme = () => (document.documentElement.dataset.theme === "day" ? "light" : "dark");
