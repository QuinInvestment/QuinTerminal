// ECharts wrapper: one theme built from the CSS tokens, resize handling, and
// option builders for the chart forms the terminal uses (time series, range
// bands, fans, bars, heatmaps). Single y-axis everywhere — no dual axes.

import { loadLib } from "./loader.js";
import { cssVar, esc } from "./dom.js";
import { px, num, isNum, shortDay } from "./fmt.js";

export const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"];
export const color = (v) => (v && v.startsWith("--") ? cssVar(v) : v);
export const seriesColor = (i) => cssVar(SERIES[i % SERIES.length]);

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
    ink1: cssVar("--ink-1"), ink2: cssVar("--ink-2"), ink3: cssVar("--ink-3"),
    grid: cssVar("--grid"), line: cssVar("--line-2"), surface: cssVar("--bg-1"), raised: cssVar("--bg-2"),
    accent: cssVar("--accent"), hazard: cssVar("--hazard"), up: cssVar("--up"), down: cssVar("--down"),
    font: cssVar("--font-sans") || "sans-serif",
  };
}

function axisCommon(T) {
  return {
    axisLine: { lineStyle: { color: T.line, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: T.ink3, fontSize: 11, fontFamily: T.font },
    splitLine: { lineStyle: { color: T.grid, width: 1, type: "solid" } },
    nameTextStyle: { color: T.ink3, fontSize: 11, fontFamily: T.font },
  };
}

export function tooltipStyle(T) {
  return {
    backgroundColor: T.surface,
    borderColor: T.line,
    borderWidth: 1,
    padding: [6, 8],
    textStyle: { color: T.ink1, fontSize: 12, fontFamily: T.font },
    extraCssText: "box-shadow: 0 10px 30px rgba(0,0,0,.35); border-radius: 2px;",
  };
}

/** Tooltip row: value first (strong), series name second, keyed by a short line. */
export function ttRow(colorHex, name, value) {
  return `<div style="display:flex;align-items:center;gap:6px;line-height:1.5"><span style="display:inline-block;width:10px;height:2px;background:${colorHex}"></span><b style="font-variant-numeric:tabular-nums">${esc(value)}</b><span style="opacity:.7">${esc(name)}</span></div>`;
}

/**
 * Time-series option.
 * series: [{ name, data: [[ms, v], ...], color: "--s1", type: "line"|"bar", area, width, step, z, dashed, opacity }]
 * bands:  [{ name, lower: [[ms,v]], upper: [[ms,v]], color: "--s1", opacity }]
 */
export function tsOption({ series = [], bands = [], yFmt = (v) => px(v), tipFmt, yMin, yMax, yScale = true, legend = true, marks = [], areas = [], zoom = false, logY = false, grid } = {}) {
  const T = theme();
  const out = [];
  bands.forEach((b, i) => {
    const c = color(b.color || "--s1");
    const lowerMap = new Map(b.lower.map((p) => [p[0], p[1]]));
    const common = b.upper.filter((p) => lowerMap.has(p[0]) && isNum(p[1]) && isNum(lowerMap.get(p[0])));
    const base = common.map((p) => [p[0], lowerMap.get(p[0])]);
    const diff = common.map((p) => [p[0], p[1] - lowerMap.get(p[0])]);
    const stack = "band" + i;
    out.push({ name: b.name + " low", type: "line", data: base, stack, symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true, tooltip: { show: false }, z: 1 });
    out.push({ name: b.name, type: "line", data: diff, stack, symbol: "none", itemStyle: { color: c }, lineStyle: { opacity: 0, color: c }, areaStyle: { color: c, opacity: b.opacity ?? 0.14 }, silent: true, z: 1, _band: true });
  });
  series.forEach((s, i) => {
    const c = color(s.color || SERIES[i % 8]);
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
      itemStyle: { color: c, borderRadius: s.type === "bar" ? [2, 2, 0, 0] : 0 },
      lineStyle: { color: c, width: s.width || 2, opacity: s.opacity ?? 1, type: s.dashed ? [4, 3] : "solid", cap: "round", join: "round" },
      emphasis: { focus: "none", lineStyle: { width: (s.width || 2) + 0.5 } },
      barMaxWidth: 12,
      barCategoryGap: "20%",
      connectNulls: false,
    };
    if (s.area) o.areaStyle = { color: c, opacity: typeof s.area === "number" ? s.area : 0.1 };
    if (i === 0 && (marks.length || areas.length)) {
      o.markLine = marks.length ? {
        silent: true, symbol: "none",
        label: { color: T.ink2, fontSize: 10, fontFamily: T.font, position: "end", formatter: (p) => p.data.text || "" },
        lineStyle: { color: T.ink3, width: 1, type: "solid", opacity: 0.8 },
        data: marks.map((m) => (m.x != null
          ? { xAxis: m.x, text: m.label, label: { position: "end" }, lineStyle: m.color ? { color: color(m.color) } : undefined }
          : { yAxis: m.y, text: m.label, label: { position: "insideEndTop" }, lineStyle: m.color ? { color: color(m.color) } : undefined })),
      } : undefined;
      o.markArea = areas.length ? {
        silent: true,
        itemStyle: { color: color(areas[0].color || "--hazard-soft") },
        label: { color: T.ink2, fontSize: 10, fontFamily: T.font, position: "insideTopLeft" },
        data: areas.map((a) => [{ xAxis: a.from, name: a.label || "", itemStyle: a.color ? { color: color(a.color) } : undefined }, { xAxis: a.to }]),
      } : undefined;
    }
    out.push(o);
  });
  const legendItems = series.filter((s) => !s.noLegend).map((s) => s.name).concat(bands.map((b) => b.name));
  const showLegend = legend && legendItems.length > 1;
  const xLabels = marks.some((m) => m.x != null && m.label); // vertical-line labels sit above the plot
  return {
    animation: false,
    textStyle: { fontFamily: T.font },
    grid: { left: 8, right: 14, top: (showLegend ? 26 : 12) + (xLabels ? 14 : 0), bottom: zoom ? 46 : 8, containLabel: true, ...(grid || {}) },
    legend: showLegend ? {
      type: "scroll", top: 0, left: 0, right: 0, itemWidth: 14, itemHeight: 3, icon: "rect", itemGap: 12,
      pageIconColor: T.ink2, pageIconInactiveColor: T.line, pageIconSize: 9, pageTextStyle: { color: T.ink3, fontSize: 10 },
      textStyle: { color: T.ink2, fontSize: 11, fontFamily: T.font }, data: legendItems, inactiveColor: T.line,
    } : undefined,
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(T),
      axisPointer: { type: "line", lineStyle: { color: T.ink3, width: 1 }, label: { show: false } },
      formatter: (params) => {
        if (!params || !params.length) return "";
        const t = params[0].value?.[0] ?? params[0].axisValue;
        const head = `<div style="color:${T.ink3};margin-bottom:2px">${esc(typeof t === "number" ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : t)}</div>`;
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
    xAxis: { type: "time", ...axisCommon(T), splitLine: { show: false }, axisLabel: { ...axisCommon(T).axisLabel, hideOverlap: true, formatter: { year: "{yyyy}", month: "{MMM}", day: "{d} {MMM}", hour: "{HH}:{mm}", minute: "{HH}:{mm}" } } },
    yAxis: { type: logY ? "log" : "value", scale: yScale, min: yMin, max: yMax, ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => yFmt(v) } },
    dataZoom: zoom ? [{ type: "inside", throttle: 50 }, { type: "slider", height: 18, bottom: 6, borderColor: T.line, backgroundColor: "transparent", fillerColor: "rgba(127,127,127,.12)", dataBackground: { lineStyle: { color: T.ink3, opacity: 0.4 }, areaStyle: { opacity: 0 } }, handleStyle: { color: T.ink3 }, textStyle: { color: T.ink3, fontSize: 10 } }] : undefined,
    series: out,
  };
}

/** Category bar chart (one series = one colour). */
export function barOption({ cats, values, colorVar = "--s1", fmt = (v) => num(v, 1), horizontal = false, signed = false, labels = true, highlight, integer = false }) {
  const T = theme();
  const c = color(colorVar);
  const data = values.map((v, i) => ({
    value: v,
    itemStyle: {
      color: signed ? (v >= 0 ? color("--div-pos") : color("--div-neg")) : (highlight && highlight(i) ? T.accent : c),
      borderRadius: horizontal ? (v >= 0 ? [0, 2, 2, 0] : [2, 0, 0, 2]) : (v >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2]),
    },
  }));
  const cat = { type: "category", data: cats, ...axisCommon(T), splitLine: { show: false }, axisLabel: { ...axisCommon(T).axisLabel, interval: 0, hideOverlap: true } };
  const val = { type: "value", minInterval: integer ? 1 : undefined, ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => fmt(v) } };
  return {
    animation: false,
    textStyle: { fontFamily: T.font },
    grid: { left: 8, right: labels ? 40 : 12, top: 10, bottom: 6, containLabel: true },
    tooltip: { trigger: "item", ...tooltipStyle(T), formatter: (p) => ttRow(p.color, p.name, fmt(p.value)) },
    xAxis: horizontal ? val : cat,
    yAxis: horizontal ? { ...cat, inverse: true } : val,
    series: [{
      type: "bar", data, barMaxWidth: 16, barCategoryGap: "35%",
      label: labels ? { show: true, position: horizontal ? "right" : "top", color: T.ink2, fontSize: 10, fontFamily: T.font, formatter: (p) => fmt(p.value) } : undefined,
    }],
  };
}

/** Heatmap with a diverging scale centred on zero. */
export function heatOption({ xCats, yCats, cells, min = -1, max = 1, fmt = (v) => num(v, 2), diverging = true }) {
  const T = theme();
  return {
    animation: false,
    textStyle: { fontFamily: T.font },
    grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
    tooltip: { trigger: "item", ...tooltipStyle(T), formatter: (p) => `<div style="color:${T.ink3}">${esc(yCats[p.value[1]])} × ${esc(xCats[p.value[0]])}</div><b>${esc(fmt(p.value[2]))}</b>` },
    xAxis: { type: "category", data: xCats, ...axisCommon(T), splitLine: { show: false }, axisLabel: { ...axisCommon(T).axisLabel, interval: 0, rotate: xCats.length > 8 ? 35 : 0 } },
    yAxis: { type: "category", data: yCats, ...axisCommon(T), splitLine: { show: false }, axisLabel: { ...axisCommon(T).axisLabel, interval: 0 } },
    visualMap: {
      min, max, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemWidth: 10, itemHeight: 120,
      text: [fmt(max), fmt(min)], textGap: 6, // a colour ramp without its end values says nothing
      textStyle: { color: T.ink3, fontSize: 10 },
      inRange: { color: diverging ? [cssVar("--div-neg"), cssVar("--div-mid"), cssVar("--div-pos")] : [cssVar("--seq-1"), cssVar("--seq-3"), cssVar("--seq-6")] },
    },
    series: [{
      type: "heatmap", data: cells, itemStyle: { borderColor: T.surface, borderWidth: 2 },
      label: { show: xCats.length <= 12, color: T.ink1, fontSize: 10, fontFamily: T.font, formatter: (p) => fmt(p.value[2]) },
      emphasis: { itemStyle: { borderColor: T.ink1, borderWidth: 1 } },
    }],
  };
}

/** Category line chart (x = labels). */
export function catLineOption({ cats, series, yFmt = (v) => num(v, 1), legend = true, marks = [] }) {
  const T = theme();
  return {
    animation: false,
    textStyle: { fontFamily: T.font },
    grid: { left: 8, right: 14, top: legend && series.length > 1 ? 26 : 12, bottom: 8, containLabel: true },
    legend: legend && series.length > 1 ? { type: "scroll", top: 0, left: 0, right: 0, itemWidth: 14, itemHeight: 3, icon: "rect", textStyle: { color: T.ink2, fontSize: 11 }, pageIconColor: T.ink2, pageIconInactiveColor: T.line, pageIconSize: 9, pageTextStyle: { color: T.ink3, fontSize: 10 } } : undefined,
    tooltip: { trigger: "axis", ...tooltipStyle(T), axisPointer: { type: "line", lineStyle: { color: T.ink3 } },
      formatter: (ps) => `<div style="color:${T.ink3}">${esc(ps[0].axisValue)}</div>` + ps.map((p) => ttRow(p.color, p.seriesName, isNum(p.value) ? yFmt(p.value) : "—")).join("") },
    xAxis: { type: "category", data: cats, boundaryGap: false, ...axisCommon(T), splitLine: { show: false } },
    yAxis: { type: "value", scale: true, ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => yFmt(v) } },
    series: series.map((s, i) => ({
      name: s.name, type: "line", data: s.data, symbol: s.symbol ?? "circle", symbolSize: 6, showSymbol: s.showSymbol ?? true,
      itemStyle: { color: color(s.color || SERIES[i]) }, lineStyle: { width: s.width || 2, color: color(s.color || SERIES[i]), type: s.dashed ? [4, 3] : "solid" },
      areaStyle: s.area ? { color: color(s.color || SERIES[i]), opacity: 0.1 } : undefined,
      markLine: i === 0 && marks.length ? { silent: true, symbol: "none", lineStyle: { color: T.ink3, type: "solid" }, label: { color: T.ink2, fontSize: 10, formatter: (p) => p.data.label || "" }, data: marks.map((m) => ({ yAxis: m.y, label: m.label })) } : undefined,
    })),
  };
}

export const msDay = 86400000;
export const dayLabel = (ms) => shortDay(ms);
