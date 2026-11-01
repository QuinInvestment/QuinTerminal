// XAS — cross-asset context: every 24/7 perp on the trade.xyz venue, a
// TradingView reference chart for exchange-listed symbols, energy equities and
// the macro calendar.

import { h, mount } from "../core/dom.js";
import { panel, grid } from "../core/layout.js";
import { sub, get } from "../core/bus.js";
import { px, num, pct, spct, compact, dirClass, isNum } from "../core/fmt.js";
import * as hl from "../data/hyperliquid.js";
import { table } from "./kit.js";
import { tvWidget, tvTheme } from "./tv.js";

const PRESETS = [
  { s: "TVC:UKOIL", l: "Brent CFD" }, { s: "TVC:USOIL", l: "WTI CFD" }, { s: "CBOE:OVX", l: "Oil volatility (OVX)" }, { s: "TVC:DXY", l: "US dollar" },
  { s: "AMEX:XLE", l: "Energy ETF" }, { s: "NYSE:FRO", l: "Frontline" }, { s: "TADAWUL:2222", l: "Aramco" }, { s: "TVC:US10Y", l: "US 10Y" },
];

export default {
  title: "Cross-asset",
  sub: "Oil's neighbours: the full 24/7 perp board, a reference chart for any exchange symbol, energy equities and the macro calendar.",

  async mount(view, { scope, tools, arg }) {
    let symbol = /^[A-Z]+:[A-Z0-9!._]+$/i.test(arg || "") ? arg.toUpperCase() : "TVC:UKOIL";
    const input = h("input", { class: "in mono", value: symbol, style: { width: "170px" }, "aria-label": "TradingView symbol", onkeydown: (e) => { if (e.key === "Enter") { symbol = e.target.value.trim().toUpperCase(); drawTv(); } } });
    mount(tools, h("span", { class: "small dim" }, "Chart symbol"), input, h("div", { class: "seg" }, PRESETS.map((p) => h("button", { type: "button", title: p.s, onclick: () => { symbol = p.s; input.value = p.s; drawTv(); } }, p.l))));

    const pBoard = panel({ title: "24/7 perpetuals (trade.xyz on Hyperliquid)", span: 4, rows: 11, src: ["hl"], flush: true, method: M_BOARD });
    const pTv = panel({ title: "Reference chart", span: 8, rows: 11, src: ["tv"], flush: true, method: M_TV });
    const pEq = panel({ title: "Energy equities", span: 6, rows: 9, src: ["tv"], flush: true });
    const pCal = panel({ title: "Macro calendar", span: 6, rows: 9, src: ["tv"], flush: true });
    view.appendChild(grid(pBoard, pTv, pEq, pCal));

    const paintBoard = (u) => {
      if (!u) return;
      const rows = u.filter((x) => !x.delisted && isNum(x.markPx)).map((x) => ({ ...x, ch: x.prevDayPx > 0 ? x.markPx / x.prevDayPx - 1 : NaN, name: hl.byCoin[x.coin]?.name || x.coin.replace("xyz:", "") })).sort((a, b) => (b.dayNtlVlm || 0) - (a.dayNtlVlm || 0));
      mount(pBoard.body, table([
        { label: "Market", get: (r) => h("span", { class: hl.byCoin[r.coin]?.group === "oil" ? "ac" : "" }, r.name) },
        { label: "Mark", r: true, get: (r) => px(r.markPx) },
        { label: "24h", r: true, cls: (r) => dirClass(r.ch), get: (r) => spct(r.ch, 2) },
        { label: "Volume", r: true, get: (r) => "$" + compact(r.dayNtlVlm) },
        { label: "Funding /yr", r: true, get: (r) => (isNum(r.funding) ? pct(r.funding * 24 * 365, 1) : "—") },
      ], rows));
      pBoard.setData([{ label: "Coin" }, { label: "Mark", num: true }, { label: "Oracle", num: true }, { label: "24h change", num: true }, { label: "Volume $", num: true }, { label: "Open interest", num: true }, { label: "Funding (hourly)", num: true }], rows.map((r) => [r.coin, r.markPx, r.oraclePx, r.ch, r.dayNtlVlm, r.openInterest, r.funding]));
      pBoard.touch();
    };
    scope.sub("hl:universe", paintBoard);

    function drawTv() {
      mount(pTv.body);
      tvWidget(pTv.body, "advanced-chart", { autosize: true, symbol, interval: "60", timezone: "Etc/UTC", theme: tvTheme(), style: "1", locale: "en", allow_symbol_change: true, hide_side_toolbar: false, save_image: false, support_host: "https://www.tradingview.com", backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--bg-1").trim() });
      pTv.setTitle(`Reference chart: ${symbol}`);
      pTv.touch();
    }
    drawTv();

    tvWidget(pEq.body, "market-quotes", {
      width: "100%", height: "100%", isTransparent: true, colorTheme: tvTheme(), locale: "en", showSymbolLogo: true,
      symbolsGroups: [
        { name: "Majors", symbols: [{ name: "NYSE:XOM", displayName: "ExxonMobil" }, { name: "NYSE:CVX", displayName: "Chevron" }, { name: "NYSE:SHEL", displayName: "Shell" }, { name: "NYSE:TTE", displayName: "TotalEnergies" }, { name: "NYSE:BP", displayName: "BP" }, { name: "TADAWUL:2222", displayName: "Saudi Aramco" }] },
        { name: "Producers", symbols: [{ name: "NYSE:COP", displayName: "ConocoPhillips" }, { name: "NYSE:OXY", displayName: "Occidental" }, { name: "NYSE:EQNR", displayName: "Equinor" }, { name: "NYSE:PBR", displayName: "Petrobras" }, { name: "AMEX:XOP", displayName: "E&P ETF" }] },
        { name: "Refiners and services", symbols: [{ name: "NYSE:VLO", displayName: "Valero" }, { name: "NYSE:MPC", displayName: "Marathon Petroleum" }, { name: "NYSE:PSX", displayName: "Phillips 66" }, { name: "NYSE:SLB", displayName: "SLB" }, { name: "NYSE:HAL", displayName: "Halliburton" }] },
      ],
    });
    pEq.touch();
    tvWidget(pCal.body, "events", { colorTheme: tvTheme(), isTransparent: true, width: "100%", height: "100%", locale: "en", importanceFilter: "0,1", countryFilter: "us,eu,cn,in,jp,sa,gb" });
    pCal.touch();
  },
};

const M_BOARD = `<p>All active markets on the trade.xyz HIP-3 venue, sorted by 24-hour notional volume. Everything trades around the clock against oracles built from the underlying exchanges, which is what makes weekend price discovery visible. Low-volume markets can sit far from fair value.</p>`;
const M_TV = `<p>TradingView's free embeddable chart. Exchange data in free widgets is usually delayed and some futures feeds are not available; CFD symbols such as TVC:UKOIL and TVC:USOIL update continuously. Type any TradingView symbol in the toolbar.</p>`;
