// ECharts wrapper: one theme read from the CSS tokens (so night and day switch
// without duplicated code), resize handling, and option builders for the chart
// forms the terminal uses (time series, bands, fans, bars, heatmaps).
// House rules: transparent background, one y-axis, few series (past four a
// chart regroups into highlight and grey context), flat areas at 12 % or less,
// square marks.

import { loadLib } from "./loader.js";
import { cssVar, esc } from "./dom.js";
import { px, num, isNum, shortDay } from "./fmt.js";

export const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"];
export const color = (v) => (v && v.startsWith("--") ? cssVar(v) : v);
export const seriesColor = (i) => cssVar(SERIES[i % SERIES.length]);

/** "#rrggbb" (or a token) at an opacity, as rgba() for ECharts and canvas. */
export function alpha(c, a) {
  const hex = color(c) || "";
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

const live = new Set();

export async function makeChart(el) {
  const echarts = await loadLib("echarts");
  const chart = echarts.init(el, null, { renderer: "canvas" });
  const ro = new ResizeObserver(() => { if (!chart.isDisposed()) chart.resize(); });
  ro.observe(el);
  const handle = {
    chart,
    set(option, notMerge = true) { if (!chart.isDisposed()) chart.setOption(option, { notMerge, lazyUpdate: true }); },
    dispose() { ro.disconnect(); live.delete(handle); if (!chart.isDisposed()) chart.dispose(); },
  };
  live.add(handle);
  return handle;
}

export function disposeAll() { for (const h of [...live]) h.dispose(); }

export function theme() {
  return {
    text: cssVar("--text"), body: cssVar("--body"), muted: cssVar("--muted"), faint: cssVar("--faint"),
    line: cssVar("--line"), lineStrong: cssVar("--line-strong"), panel: cssVar("--panel"), raised: cssVar("--raised"), bg: cssVar("--bg"),
    accent: cssVar("--accent"), accentSoft: cssVar("--accent-soft"), ref: cssVar("--ref"), up: cssVar("--up"), down: cssVar("--down"),
    font: cssVar("--font-sans") || "sans-serif", mono: cssVar("--font-mono") || "monospace",
    // older names, still read by a few modules
    get ink1() { return this.text; }, get ink2() { return this.muted; }, get ink3() { return this.faint; },
    get grid() { return this.line; }, get surface() { return this.panel; }, get hazard() { return this.down; },
  };
}

function axisCommon(T) {
  return {
    axisLine: { lineStyle: { color: T.lineStrong, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: T.muted, fontSize: 11, fontFamily: T.font },
    splitLine: { show: false },
    nameTextStyle: { color: T.muted, fontSize: 11, fontFamily: T.font },
  };
}
const yGrid = (T) => ({ show: true, lineStyle: { color: T.line, width: 1, type: "solid" } });

export function tooltipStyle(T) {
  return {
    backgroundColor: T.raised,
    borderColor: T.lineStrong,
    borderWidth: 1,
    padding: [7, 10],
    textStyle: { color: T.text, fontSize: 12, fontFamily: T.font },
    extraCssText: "box-shadow:none;border-radius:0;",
  };
}

/** Tooltip row: a short key in the series colour, the value in mono, then the name. */
export function ttRow(colorHex, name, value) {
  const T = theme();
  return `<div style="display:flex;align-items:center;gap:8px;line-height:1.6"><span style="display:inline-block;width:12px;height:2px;background:${colorHex}"></span><span style="font-family:${esc(T.mono)};color:${T.text}">${esc(value)}</span><span style="color:${T.muted}">${esc(name)}</span></div>`;
}
const ttHead = (T, label) => `<div style="color:${T.muted};margin-bottom:3px;font-family:${esc(T.mono)};font-size:11px">${esc(label)}</div>`;

/** Resolved style for series i: its colour, 2 px for the lead line, 1.75 px for the others. */
function seriesStyle(s, i) {
  const c = color(s.color || SERIES[i % SERIES.length]);
  return { c, dashed: !!s.dashed, width: s.width || (i === 0 ? 2 : 1.75) };
}

/**
 * Time-series option.
 * series: [{ name, data: [[ms, v], ...], color: "--s1", type: "line"|"bar", area, width, step, z, dashed, opacity }]
 * bands:  [{ name, lower: [[ms,v]], upper: [[ms,v]], color: "--s1", opacity }]
 */
export function tsOption({ series = [], bands = [], yFmt = (v) => px(v), tipFmt, yMin, yMax, yScale = true, legend = true, marks = [], areas = [], zoom = false, logY = false, grid } = {}) {
  const T = theme();
  if (series.some((s) => s.type === "bar") && yMin == null) yScale = false; // bars start at zero
  const out = [];
  bands.forEach((b, i) => {
    const c = color(b.color || "--s1");
    const lowerMap = new Map(b.lower.map((p) => [p[0], p[1]]));
    const common = b.upper.filter((p) => lowerMap.has(p[0]) && isNum(p[1]) && isNum(lowerMap.get(p[0])));
    const base = common.map((p) => [p[0], lowerMap.get(p[0])]);
    const diff = common.map((p) => [p[0], p[1] - lowerMap.get(p[0])]);
    const stack = "band" + i;
    out.push({ name: b.name + " low", type: "line", data: base, stack, symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true, tooltip: { show: false }, z: 1 });
    out.push({ name: b.name, type: "line", data: diff, stack, symbol: "none", itemStyle: { color: c }, lineStyle: { opacity: 0, color: c }, areaStyle: { color: c, opacity: Math.min(0.15, b.opacity ?? 0.15) }, silent: true, z: 1, _band: true });
  });
  series.forEach((s, i) => {
    const st = seriesStyle(s, i);
    const isBar = s.type === "bar";
    const o = {
      name: s.name,
      type: s.type || "line",
      data: s.data,
      symbol: s.symbol || "none",
      symbolSize: s.symbolSize || 6,
      showSymbol: !!s.showSymbol,
      step: s.step || false,
      z: s.z || 3,
      sampling: s.data && s.data.length > 2000 ? "lttb" : undefined,
      itemStyle: { color: st.c, borderRadius: 0 },
      lineStyle: { color: st.c, width: st.width, opacity: s.opacity ?? 1, type: st.dashed ? [5, 3] : "solid", cap: "butt", join: "miter" },
      emphasis: { focus: "none", lineStyle: { width: st.width } },
      barMaxWidth: 12,
      barCategoryGap: "24%",
      connectNulls: false,
    };
    if (isBar) o.itemStyle.opacity = s.opacity ?? 1;
    if (s.area) o.areaStyle = { color: st.c, opacity: Math.min(0.12, typeof s.area === "number" ? s.area : 0.1) };
    if (i === 0 && (marks.length || areas.length)) {
      o.markLine = marks.length ? {
        silent: true, symbol: "none",
        label: { color: T.muted, fontSize: 10, fontFamily: T.font, position: "end", formatter: (p) => p.data.text || "" },
        lineStyle: { color: T.faint, width: 1, type: "solid", opacity: 0.9 },
        data: marks.map((m) => (m.x != null
          ? { xAxis: m.x, text: m.label, label: { position: "end" }, lineStyle: m.color ? { color: color(m.color), type: m.dashed ? [4, 3] : "solid" } : undefined }
          : { yAxis: m.y, text: m.label, label: { position: "insideEndTop" }, lineStyle: m.color ? { color: color(m.color), type: m.dashed ? [4, 3] : "solid" } : undefined })),
      } : undefined;
      o.markArea = areas.length ? {
        silent: true,
        itemStyle: { color: areas[0].color ? areaColor(areas[0].color) : T.raised },
        label: { color: T.muted, fontSize: 10, fontFamily: T.font, position: "insideTopLeft" },
        data: areas.map((a) => [{ xAxis: a.from, name: a.label || "", itemStyle: a.color ? { color: areaColor(a.color) } : undefined }, { xAxis: a.to }]),
      } : undefined;
    }
    out.push(o);
  });
  const legendItems = series.filter((s) => !s.noLegend).map((s) => s.name).concat(bands.map((b) => b.name));
  const showLegend = legend && legendItems.length > 1;
  const xLabels = marks.some((m) => m.x != null && m.label); // vertical-line labels sit above the plot
  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { fontFamily: T.font },
    grid: { left: 8, right: 14, top: (showLegend ? 28 : 12) + (xLabels ? 14 : 0), bottom: zoom ? 46 : 8, containLabel: true, ...(grid || {}) },
    legend: showLegend ? legendStyle(T, legendItems) : undefined,
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(T),
      axisPointer: { type: "line", lineStyle: { color: T.faint, width: 1 }, label: { show: false } },
      formatter: (params) => {
        if (!params || !params.length) return "";
        const t = params[0].value?.[0] ?? params[0].axisValue;
        const head = ttHead(T, typeof t === "number" ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : t);
        const rows = params
          .filter((p) => !String(p.seriesName).endsWith(" low"))
          .map((p) => {
            let v = Array.isArray(p.value) ? p.value[1] : p.value;
            const isBand = out[p.seriesIndex]?._band;
            if (isBand) {
              const lowSeries = out[p.seriesIndex - 1];
              const low = lowSeries?.data?.[p.dataIndex]?.[1];
              if (isNum(low) && isNum(v)) return ttRow(p.color, p.seriesName, `${(tipFmt || yFmt)(low)} – ${(tipFmt || yFmt)(low + v)}`);
            }
            return ttRow(p.color, p.seriesName, isNum(v) ? (tipFmt || yFmt)(v) : "—");
          });
        return head + rows.join("");
      },
    },
    // hierarchical labels: a bare day number ("17") is ambiguous, so days carry the month
    xAxis: { type: "time", ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, hideOverlap: true, formatter: { year: "{yyyy}", month: "{MMM}", day: "{d} {MMM}", hour: "{HH}:{mm}", minute: "{HH}:{mm}" } } },
    yAxis: { type: logY ? "log" : "value", scale: yScale, min: yMin, max: yMax, ...axisCommon(T), axisLine: { show: false }, splitLine: yGrid(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => yFmt(v) } },
    dataZoom: zoom ? [{ type: "inside", throttle: 50 }, { type: "slider", height: 18, bottom: 6, borderColor: T.line, backgroundColor: "transparent", fillerColor: alpha(T.accent, 0.12), dataBackground: { lineStyle: { color: T.faint, opacity: 0.6 }, areaStyle: { opacity: 0 } }, selectedDataBackground: { lineStyle: { color: T.accent }, areaStyle: { opacity: 0 } }, handleStyle: { color: T.muted, borderColor: T.muted }, moveHandleStyle: { color: T.line }, textStyle: { color: T.muted, fontSize: 10 } }] : undefined,
    series: out,
  };
}

function areaColor(c) {
  // area tints are flat and light: a token is shown at 10 %
  if (c.startsWith("--")) return alpha(c.replace(/-soft$/, ""), 0.1);
  return c;
}

function legendStyle(T, data) {
  return {
    type: "scroll", top: 0, left: 0, right: 0, itemWidth: 14, itemHeight: 2, icon: "rect", itemGap: 14,
    pageIconColor: T.muted, pageIconInactiveColor: T.line, pageIconSize: 9, pageTextStyle: { color: T.muted, fontSize: 10 },
    textStyle: { color: T.muted, fontSize: 11, fontFamily: T.font }, data, inactiveColor: T.lineStrong,
  };
}

/** Category bar chart (one series = one colour; signed bars use the diverging pair). */
export function barOption({ cats, values, colorVar = "--s1", fmt = (v) => num(v, 1), horizontal = false, signed = false, labels = true, highlight, integer = false }) {
  const T = theme();
  const c = color(colorVar);
  const data = values.map((v, i) => ({
    value: v,
    itemStyle: {
      color: signed ? (v >= 0 ? cssVar("--div-pos") : cssVar("--div-neg")) : (highlight && highlight(i) ? T.accent : c),
      borderRadius: 0,
    },
  }));
  const cat = { type: "category", data: cats, ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, interval: 0, hideOverlap: true } };
  const val = { type: "value", minInterval: integer ? 1 : undefined, ...axisCommon(T), axisLine: { show: false }, splitLine: yGrid(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => fmt(v) } };
  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { fontFamily: T.font },
    grid: { left: 8, right: labels ? 44 : 12, top: 10, bottom: 6, containLabel: true },
    tooltip: { trigger: "item", ...tooltipStyle(T), formatter: (p) => ttRow(p.color, p.name, fmt(p.value)) },
    xAxis: horizontal ? { ...val, splitLine: { show: false } } : cat,
    yAxis: horizontal ? { ...cat, inverse: true } : val,
    series: [{
      type: "bar", data, barMaxWidth: 14, barCategoryGap: "38%",
      label: labels ? { show: true, position: horizontal ? "right" : "top", color: T.muted, fontSize: 10, fontFamily: T.mono, formatter: (p) => fmt(p.value) } : undefined,
    }],
  };
}

/** Heatmap with a diverging scale centred on zero (or a one-hue sequential scale). */
export function heatOption({ xCats, yCats, cells, min = -1, max = 1, fmt = (v) => num(v, 2), diverging = true }) {
  const T = theme();
  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { fontFamily: T.font },
    grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
    tooltip: { trigger: "item", ...tooltipStyle(T), formatter: (p) => `${ttHead(T, `${yCats[p.value[1]]} × ${xCats[p.value[0]]}`)}<span style="font-family:${esc(T.mono)}">${esc(fmt(p.value[2]))}</span>` },
    xAxis: { type: "category", data: xCats, ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, interval: 0, rotate: xCats.length > 8 ? 35 : 0 } },
    yAxis: { type: "category", data: yCats, ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, interval: 0 } },
    visualMap: {
      min, max, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemWidth: 10, itemHeight: 120,
      text: [fmt(max), fmt(min)], textGap: 6, // a colour ramp without its end values says nothing
      textStyle: { color: T.muted, fontSize: 10, fontFamily: T.mono },
      inRange: { color: diverging ? [cssVar("--div-neg"), cssVar("--div-mid"), cssVar("--div-pos")] : [cssVar("--seq-1"), cssVar("--seq-3"), cssVar("--seq-6")] },
    },
    series: [{
      type: "heatmap", data: cells, itemStyle: { borderColor: T.panel, borderWidth: 2 },
      label: { show: xCats.length <= 12, color: T.text, fontSize: 10, fontFamily: T.mono, formatter: (p) => fmt(p.value[2]) },
      emphasis: { itemStyle: { borderColor: T.text, borderWidth: 1 } },
    }],
  };
}

/** Category line chart (x = labels). */
export function catLineOption({ cats, series, yFmt = (v) => num(v, 1), legend = true, marks = [] }) {
  const T = theme();
  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { fontFamily: T.font },
    grid: { left: 8, right: 14, top: legend && series.length > 1 ? 28 : 12, bottom: 8, containLabel: true },
    legend: legend && series.length > 1 ? legendStyle(T, undefined) : undefined,
    tooltip: { trigger: "axis", ...tooltipStyle(T), axisPointer: { type: "line", lineStyle: { color: T.faint } },
      formatter: (ps) => ttHead(T, ps[0].axisValue) + ps.map((p) => ttRow(p.color, p.seriesName, isNum(p.value) ? yFmt(p.value) : "—")).join("") },
    xAxis: { type: "category", data: cats, boundaryGap: false, ...axisCommon(T) },
    yAxis: { type: "value", scale: true, ...axisCommon(T), axisLine: { show: false }, splitLine: yGrid(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => yFmt(v) } },
    series: series.map((s, i) => {
      const st = seriesStyle(s, i);
      return {
        name: s.name, type: "line", data: s.data, symbol: s.symbol ?? "rect", symbolSize: 6, showSymbol: s.showSymbol ?? true,
        itemStyle: { color: st.c }, lineStyle: { width: st.width, color: st.c, type: st.dashed ? [5, 3] : "solid" },
        areaStyle: s.area ? { color: st.c, opacity: 0.1 } : undefined,
        markLine: i === 0 && marks.length ? { silent: true, symbol: "none", lineStyle: { color: T.faint, type: "solid" }, label: { color: T.muted, fontSize: 10, formatter: (p) => p.data.label || "" }, data: marks.map((m) => ({ yAxis: m.y, label: m.label })) } : undefined,
      };
    }),
  };
}

export const msDay = 86400000;
export const dayLabel = (ms) => shortDay(ms);
