import {
  attr,
  child,
  children,
  descendants,
  drawingColor,
  escapeXml,
  path,
  valAttr,
  type Theme,
} from "./ooxml";

export type ChartKind = "bar" | "line" | "area" | "pie" | "doughnut" | "scatter" | "radar";

export type ChartSeries = {
  name: string;
  values: Array<number | null>;
  xValues?: Array<number | null>;
  color?: string | null;
  pointColors?: Array<string | null>;
  marker?: boolean;
};

export type ChartGroup = {
  kind: ChartKind;
  barDir: "col" | "bar";
  grouping: "clustered" | "stacked" | "percentStacked" | "standard";
  gapWidth: number;
  holeSize: number;
  firstSliceAngle: number;
  varyColors: boolean;
  showValues: boolean;
  showPercent: boolean;
  categories: string[];
  series: ChartSeries[];
};

export type ChartModel = {
  title: string | null;
  legend: "r" | "l" | "t" | "b" | "tr" | null;
  groups: ChartGroup[];
  background: string | null;
  border: string | null;
  valueFormat: string | null;
  palette: string[];
  fontFamily: string;
  /** Base text size in points (axis labels, legend). */
  fontSize: number;
  titleSize: number;
};

const DEFAULT_PALETTE = ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"];

function paletteFromTheme(theme: Theme) {
  return ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"].map(
    (key, index) => `#${theme.colors[key] ?? DEFAULT_PALETTE[index]!.slice(1)}`,
  );
}

function seriesColorFallback(palette: string[], index: number) {
  const base = palette[index % palette.length] ?? "#4472C4";
  const cycle = Math.floor(index / palette.length);
  if (!cycle) return base;
  // Later cycles use darker / lighter variants like Office does.
  const factor = cycle % 2 ? 0.6 : 1.4;
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(base.slice(offset, offset + 2), 16));
  return `#${rgb
    .map((value) =>
      Math.round(
        Math.max(
          0,
          Math.min(255, factor > 1 ? value + (255 - value) * (factor - 1) : value * factor),
        ),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function richText(node: Element | undefined) {
  if (!node) return "";
  const paragraphs = descendants(node, "p");
  if (paragraphs.length) {
    return paragraphs
      .map((paragraph) =>
        descendants(paragraph, "t")
          .map((t) => t.textContent ?? "")
          .join(""),
      )
      .join("\n")
      .trim();
  }
  return descendants(node, "v")
    .map((v) => v.textContent ?? "")
    .join("")
    .trim();
}

function cachePoints(ref: Element | undefined): { count: number; points: Map<number, string> } {
  const points = new Map<number, string>();
  if (!ref) return { count: 0, points };
  const cache =
    descendants(ref, "numCache")[0] ??
    descendants(ref, "strCache")[0] ??
    descendants(ref, "numLit")[0] ??
    descendants(ref, "strLit")[0];
  const multi = descendants(ref, "multiLvlStrCache")[0];
  const source = cache ?? multi;
  if (!source) return { count: 0, points };
  const count = Number(valAttr(child(source, "ptCount")) ?? 0);
  // For multi-level categories, use the innermost level.
  const level = multi ? descendants(multi, "lvl")[0] : source;
  for (const pt of children(level, "pt")) {
    const index = Number(attr(pt, "idx") ?? -1);
    const value = child(pt, "v")?.textContent ?? "";
    if (index >= 0) points.set(index, value);
  }
  return { count: Math.max(count, points.size ? Math.max(...points.keys()) + 1 : 0), points };
}

function numberList(ref: Element | undefined) {
  const { count, points } = cachePoints(ref);
  return Array.from({ length: count }, (_, index) => {
    const raw = points.get(index);
    if (raw === undefined || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  });
}

function stringList(ref: Element | undefined) {
  const { count, points } = cachePoints(ref);
  return Array.from({ length: count }, (_, index) => points.get(index) ?? "");
}

function formatCategory(value: string, formatCode: string | null) {
  if (!formatCode || !/[dmy]/i.test(formatCode) || !/^\d+(\.\d+)?$/.test(value)) return value;
  const serial = Number(value);
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
  return date.toISOString().slice(0, 10);
}

const KIND_BY_TAG: Record<string, ChartKind> = {
  barChart: "bar",
  bar3DChart: "bar",
  lineChart: "line",
  line3DChart: "line",
  stockChart: "line",
  areaChart: "area",
  area3DChart: "area",
  pieChart: "pie",
  pie3DChart: "pie",
  ofPieChart: "pie",
  doughnutChart: "doughnut",
  scatterChart: "scatter",
  bubbleChart: "scatter",
  radarChart: "radar",
};

/** Parses a DrawingML chart part (xl/charts/chartN.xml or ppt/charts/chartN.xml). */
function defaultRunSize(node: Element | undefined) {
  const size = attr(descendants(child(node, "txPr"), "defRPr")[0], "sz");
  return size ? Number(size) / 100 : null;
}

export function parseChartXml(
  xml: XMLDocument,
  theme: Theme,
  defaults: { border: boolean; fontSize?: number },
): ChartModel | null {
  const space = xml.documentElement;
  const chart = child(space, "chart");
  const plotArea = child(chart, "plotArea");
  if (!chart || !plotArea) return null;
  const palette = paletteFromTheme(theme);
  const groups: ChartGroup[] = [];
  let seriesIndex = 0;
  for (const node of children(plotArea)) {
    const kind = KIND_BY_TAG[node.localName];
    if (!kind) continue;
    const barDir = valAttr(child(node, "barDir")) === "bar" ? "bar" : "col";
    const groupingValue =
      valAttr(child(node, "grouping")) ?? (kind === "bar" ? "clustered" : "standard");
    const grouping = (
      ["clustered", "stacked", "percentStacked", "standard"].includes(groupingValue)
        ? groupingValue
        : "standard"
    ) as ChartGroup["grouping"];
    const groupLabels = child(node, "dLbls");
    const group: ChartGroup = {
      kind,
      barDir,
      grouping,
      gapWidth: Number(valAttr(child(node, "gapWidth")) ?? 150),
      holeSize: Number(valAttr(child(node, "holeSize")) ?? (kind === "doughnut" ? 50 : 0)),
      firstSliceAngle: Number(valAttr(child(node, "firstSliceAng")) ?? 0),
      varyColors:
        (valAttr(child(node, "varyColors")) ??
          (kind === "pie" || kind === "doughnut" ? "1" : "0")) === "1",
      showValues: valAttr(child(groupLabels, "showVal")) === "1",
      showPercent: valAttr(child(groupLabels, "showPercent")) === "1",
      categories: [],
      series: [],
    };
    for (const ser of children(node, "ser")) {
      const index = Number(valAttr(child(ser, "idx")) ?? seriesIndex);
      const spPr = child(ser, "spPr");
      const fill = drawingColor(child(spPr, "solidFill"), theme);
      const line = drawingColor(path(spPr, "ln", "solidFill"), theme);
      const color =
        (kind === "line" || kind === "scatter" || kind === "radar"
          ? (line ?? fill)
          : (fill ?? line)) ?? seriesColorFallback(palette, index);
      const catRef = child(ser, "cat") ?? child(ser, "xVal");
      const valRef = child(ser, "val") ?? child(ser, "yVal");
      const formatCode = descendants(catRef, "formatCode")[0]?.textContent ?? null;
      const categories = stringList(catRef).map((value) => formatCategory(value, formatCode));
      const values = numberList(valRef);
      if (!group.categories.length && categories.length) group.categories = categories;
      const labels = child(ser, "dLbls");
      if (valAttr(child(labels, "showVal")) === "1") group.showValues = true;
      if (valAttr(child(labels, "showPercent")) === "1") group.showPercent = true;
      const pointColors: Array<string | null> = [];
      for (const dPt of children(ser, "dPt")) {
        const pointIndex = Number(valAttr(child(dPt, "idx")) ?? -1);
        const pointColor = drawingColor(path(dPt, "spPr", "solidFill"), theme);
        if (pointIndex >= 0) pointColors[pointIndex] = pointColor;
      }
      const markerSymbol = valAttr(path(ser, "marker", "symbol"));
      const series: ChartSeries = {
        name: richText(child(ser, "tx")) || `Series ${index + 1}`,
        values,
        color,
        pointColors,
        marker:
          kind === "scatter" ||
          (kind === "line" &&
            markerSymbol !== "none" &&
            (markerSymbol !== null || valAttr(child(node, "marker")) === "1")),
      };
      if (kind === "scatter") series.xValues = numberList(child(ser, "xVal"));
      group.series.push(series);
      seriesIndex++;
    }
    if (!group.categories.length) {
      const length = Math.max(0, ...group.series.map((series) => series.values.length));
      group.categories = Array.from({ length }, (_, index) => String(index + 1));
    }
    if (group.series.length) groups.push(group);
  }
  if (!groups.length) return null;

  const titleNode = child(chart, "title");
  const autoDeleted = valAttr(child(chart, "autoTitleDeleted")) === "1";
  const allSeries = groups.flatMap((group) => group.series);
  let title: string | null = null;
  if (titleNode)
    title =
      richText(child(titleNode, "tx")) ||
      (allSeries.length === 1 ? allSeries[0]!.name : "Chart Title");
  else if (
    !autoDeleted &&
    allSeries.length === 1 &&
    (groups[0]!.kind === "pie" || groups[0]!.kind === "doughnut")
  )
    title = allSeries[0]!.name;

  const legendNode = child(chart, "legend");
  const legendPos = valAttr(child(legendNode, "legendPos")) ?? "r";
  const spPr = child(space, "spPr");
  const background = child(spPr, "noFill")
    ? null
    : (drawingColor(child(spPr, "solidFill"), theme) ?? (defaults.border ? "#FFFFFF" : null));
  const lineNode = child(spPr, "ln");
  const border = child(lineNode, "noFill")
    ? null
    : (drawingColor(child(lineNode, "solidFill"), theme) ?? (defaults.border ? "#D9D9D9" : null));
  const valAx = child(plotArea, "valAx");
  const baseSize =
    defaultRunSize(space) ?? defaultRunSize(child(plotArea, "catAx")) ?? defaults.fontSize ?? 10;
  const titleSize =
    Number(
      attr(descendants(titleNode, "defRPr")[0], "sz") ??
        attr(descendants(titleNode, "rPr")[0], "sz") ??
        0,
    ) / 100 || baseSize * 1.4;
  return {
    fontSize: baseSize,
    titleSize,
    title,
    legend: legendNode
      ? ((["r", "l", "t", "b", "tr"].includes(legendPos) ? legendPos : "r") as ChartModel["legend"])
      : null,
    groups,
    background,
    border,
    valueFormat: attr(child(valAx, "numFmt"), "formatCode"),
    palette,
    fontFamily: theme.minorFont || "Calibri",
  };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function niceScale(min: number, max: number, ticks = 5) {
  if (min === max) {
    if (min === 0) max = 1;
    else if (min > 0) min = 0;
    else max = 0;
  }
  const span = max - min;
  const rough = span / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const values: number[] = [];
  for (let value = niceMin; value <= niceMax + step / 2; value += step)
    values.push(Math.round(value / step) * step);
  return { min: niceMin, max: niceMax, step, values };
}

function formatNumber(value: number, format: string | null, percent = false) {
  if (percent || (format && /%/.test(format))) {
    const scaled = percent ? value : value * 100;
    return `${Math.round(scaled * 10) / 10}%`;
  }
  const decimals = format ? /\.(0+)/.exec(format)?.[1]?.length : undefined;
  const currency = format ? (/[$€£¥]/.exec(format)?.[0] ?? "") : "";
  const abs = Math.abs(value);
  const text = abs.toLocaleString("en-US", {
    maximumFractionDigits: decimals ?? (abs >= 100 ? 0 : 2),
    minimumFractionDigits: decimals ?? 0,
    useGrouping: !format || /,/.test(format) || abs >= 10000,
  });
  return `${value < 0 ? "-" : ""}${currency}${text}`;
}

function textWidth(text: string, size: number) {
  return text.length * size * 0.52;
}

function truncate(text: string, maxWidth: number, size: number) {
  if (textWidth(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && textWidth(`${out}…`, size) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

type Box = { x: number; y: number; width: number; height: number };

/** Renders a chart model as an SVG string sized in CSS pixels. */
export function renderChartSvg(model: ChartModel, width: number, height: number) {
  const font = model.fontSize * (96 / 72);
  const titleFont = model.titleSize * (96 / 72);
  const scale = font / 12;
  const muted = "#595959";
  const parts: string[] = [];
  const family = escapeXml(`${model.fontFamily}, Calibri, Carlito, Arial, sans-serif`);
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${family}">`,
  );
  if (model.background || model.border) {
    parts.push(
      `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="${model.background ?? "none"}" stroke="${model.border ?? "none"}" stroke-width="1"/>`,
    );
  }
  const pad = 10 * scale;
  let area: Box = { x: pad, y: pad, width: width - pad * 2, height: height - pad * 2 };
  if (model.title) {
    const lines = model.title.split("\n").slice(0, 2);
    lines.forEach((line, index) =>
      parts.push(
        `<text x="${width / 2}" y="${area.y + titleFont * (index + 0.9)}" text-anchor="middle" font-size="${titleFont}" fill="${muted}">${escapeXml(truncate(line, area.width, titleFont))}</text>`,
      ),
    );
    const used = titleFont * lines.length + 8 * scale;
    area = { ...area, y: area.y + used, height: area.height - used };
  }

  const primary = model.groups[0]!;
  const circular = primary.kind === "pie" || primary.kind === "doughnut";
  void scale;
  const legendItems = circular
    ? primary.categories.map((name, index) => ({
        name,
        color: pointColor(model, primary, primary.series[0]!, index),
      }))
    : model.groups.flatMap((group) =>
        group.series.map((series) => ({
          name: series.name,
          color: series.color ?? "#4472C4",
          line: group.kind === "line" || group.kind === "scatter",
        })),
      );
  if (model.legend && legendItems.length) {
    area = drawLegend(parts, model.legend, legendItems, area, font, muted);
  }

  if (circular) drawPie(parts, model, primary, area, font);
  else if (primary.kind === "radar") drawRadar(parts, model, primary, area, font, muted);
  else drawCartesian(parts, model, area, font, muted);
  parts.push("</svg>");
  return parts.join("");
}

function pointColor(model: ChartModel, group: ChartGroup, series: ChartSeries, index: number) {
  return (
    series.pointColors?.[index] ??
    (group.varyColors ? seriesColorFallback(model.palette, index) : (series.color ?? "#4472C4"))
  );
}

function drawLegend(
  parts: string[],
  position: NonNullable<ChartModel["legend"]>,
  items: Array<{ name: string; color: string; line?: boolean }>,
  area: Box,
  font: number,
  color: string,
): Box {
  const swatch = font * 0.75;
  const gap = font * 0.5;
  const vertical = position === "r" || position === "l" || position === "tr";
  if (vertical) {
    const widest = Math.min(
      area.width * 0.35,
      Math.max(...items.map((item) => textWidth(item.name, font))) + swatch + gap * 3,
    );
    const total = items.length * font * 1.5;
    const x = position === "l" ? area.x : area.x + area.width - widest;
    let y = position === "tr" ? area.y : area.y + Math.max(0, (area.height - total) / 2);
    for (const item of items) {
      parts.push(legendSwatch(x + gap, y + font * 0.35, swatch, item.color, item.line));
      parts.push(
        `<text x="${x + gap * 2 + swatch}" y="${y + font}" font-size="${font}" fill="${color}">${escapeXml(truncate(item.name, widest - swatch - gap * 3, font))}</text>`,
      );
      y += font * 1.5;
    }
    return position === "l"
      ? { ...area, x: area.x + widest, width: area.width - widest }
      : { ...area, width: area.width - widest - gap };
  }
  const widths = items.map((item) => textWidth(item.name, font) + swatch + gap * 3);
  const rows: Array<Array<number>> = [[]];
  let rowWidth = 0;
  widths.forEach((itemWidth, index) => {
    if (rowWidth + itemWidth > area.width && rows[rows.length - 1]!.length) {
      rows.push([]);
      rowWidth = 0;
    }
    rows[rows.length - 1]!.push(index);
    rowWidth += itemWidth;
  });
  const lineHeight = font * 1.5;
  const blockHeight = rows.length * lineHeight;
  let y = position === "t" ? area.y : area.y + area.height - blockHeight;
  for (const row of rows) {
    const total = row.reduce((sum, index) => sum + widths[index]!, 0);
    let x = area.x + (area.width - total) / 2;
    for (const index of row) {
      const item = items[index]!;
      parts.push(legendSwatch(x + gap, y + font * 0.35, swatch, item.color, item.line));
      parts.push(
        `<text x="${x + gap * 2 + swatch}" y="${y + font}" font-size="${font}" fill="${color}">${escapeXml(item.name)}</text>`,
      );
      x += widths[index]!;
    }
    y += lineHeight;
  }
  return position === "t"
    ? {
        ...area,
        y: area.y + blockHeight + font * 0.5,
        height: area.height - blockHeight - font * 0.5,
      }
    : { ...area, height: area.height - blockHeight - font * 0.5 };
}

function legendSwatch(x: number, y: number, size: number, color: string, line?: boolean) {
  if (line)
    return `<line x1="${x - size * 0.3}" y1="${y + size / 2}" x2="${x + size * 1.3}" y2="${y + size / 2}" stroke="${color}" stroke-width="${Math.max(1.5, size / 4)}"/>`;
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${color}"/>`;
}

function drawPie(parts: string[], model: ChartModel, group: ChartGroup, area: Box, font: number) {
  const series = group.series[0]!;
  const values = series.values.map((value) => Math.max(0, value ?? 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) return;
  const radius = Math.max(4, Math.min(area.width, area.height) / 2 - font * 0.5);
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  const inner =
    group.kind === "doughnut"
      ? (radius * Math.max(10, Math.min(90, group.holeSize || 50))) / 100
      : 0;
  let angle = ((group.firstSliceAngle || 0) - 90) * (Math.PI / 180);
  values.forEach((value, index) => {
    if (!value) return;
    const sweep = (value / total) * Math.PI * 2;
    const end = angle + sweep;
    const color = pointColor(model, group, series, index);
    const large = sweep > Math.PI ? 1 : 0;
    const p = (r: number, a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    if (sweep >= Math.PI * 2 - 1e-6) {
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}" stroke="#fff" stroke-width="1"/>`,
      );
      if (inner)
        parts.push(
          `<circle cx="${cx}" cy="${cy}" r="${inner}" fill="${model.background ?? "#fff"}"/>`,
        );
    } else if (inner) {
      parts.push(
        `<path d="M${p(radius, angle)} A${radius},${radius} 0 ${large} 1 ${p(radius, end)} L${p(inner, end)} A${inner},${inner} 0 ${large} 0 ${p(inner, angle)} Z" fill="${color}" stroke="#fff" stroke-width="1"/>`,
      );
    } else {
      parts.push(
        `<path d="M${cx},${cy} L${p(radius, angle)} A${radius},${radius} 0 ${large} 1 ${p(radius, end)} Z" fill="${color}" stroke="#fff" stroke-width="1"/>`,
      );
    }
    if (group.showValues || group.showPercent) {
      const mid = angle + sweep / 2;
      const labelRadius = inner ? (radius + inner) / 2 : radius * 0.65;
      const label = group.showPercent
        ? `${Math.round((value / total) * 100)}%`
        : formatNumber(value, model.valueFormat);
      parts.push(
        `<text x="${cx + labelRadius * Math.cos(mid)}" y="${cy + labelRadius * Math.sin(mid) + font * 0.35}" text-anchor="middle" font-size="${font}" fill="#fff">${escapeXml(label)}</text>`,
      );
    }
    angle = end;
  });
}

function drawRadar(
  parts: string[],
  model: ChartModel,
  group: ChartGroup,
  area: Box,
  font: number,
  muted: string,
) {
  const count = group.categories.length;
  if (count < 3) return;
  const all = group.series.flatMap((series) =>
    series.values.filter((value): value is number => value !== null),
  );
  const scale = niceScale(Math.min(0, ...all), Math.max(...all, 1));
  const radius = Math.min(area.width, area.height) / 2 - font * 1.5;
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  const point = (index: number, value: number) => {
    const a = -Math.PI / 2 + (index / count) * Math.PI * 2;
    const r = ((value - scale.min) / (scale.max - scale.min)) * radius;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  for (const tick of scale.values) {
    const ring = Array.from({ length: count }, (_, index) => point(index, tick).join(",")).join(
      " ",
    );
    parts.push(`<polygon points="${ring}" fill="none" stroke="#D9D9D9" stroke-width="1"/>`);
  }
  group.categories.forEach((category, index) => {
    const [x, y] = point(index, scale.max);
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#D9D9D9"/>`);
    const [lx, ly] = point(index, scale.max + (scale.max - scale.min) * 0.12);
    parts.push(
      `<text x="${lx}" y="${ly + font * 0.35}" text-anchor="middle" font-size="${font}" fill="${muted}">${escapeXml(category)}</text>`,
    );
  });
  group.series.forEach((series) => {
    const points = series.values
      .map((value, index) => point(index, value ?? 0).join(","))
      .join(" ");
    parts.push(
      `<polygon points="${points}" fill="none" stroke="${series.color}" stroke-width="2.25"/>`,
    );
  });
}

function drawCartesian(parts: string[], model: ChartModel, area: Box, font: number, muted: string) {
  const primary = model.groups[0]!;
  const horizontal = primary.kind === "bar" && primary.barDir === "bar";
  const scatter = primary.kind === "scatter";
  const categories = primary.categories;
  const count = Math.max(
    1,
    categories.length,
    ...model.groups.flatMap((group) => group.series.map((series) => series.values.length)),
  );

  // Value range, accounting for stacking.
  let min = 0;
  let max = 0;
  const percent = model.groups.some((group) => group.grouping === "percentStacked");
  for (const group of model.groups) {
    if (group.grouping === "stacked" || group.grouping === "percentStacked") {
      for (let index = 0; index < count; index++) {
        let positive = 0;
        let negative = 0;
        const total =
          group.series.reduce((sum, series) => sum + Math.abs(series.values[index] ?? 0), 0) || 1;
        for (const series of group.series) {
          const raw = series.values[index] ?? 0;
          const value = group.grouping === "percentStacked" ? (raw / total) * 100 : raw;
          if (value >= 0) positive += value;
          else negative += value;
        }
        max = Math.max(max, positive);
        min = Math.min(min, negative);
      }
    } else {
      for (const series of group.series) {
        for (const value of series.values) {
          if (value === null) continue;
          max = Math.max(max, value);
          min = Math.min(min, value);
        }
      }
    }
  }
  if (!scatter && primary.kind === "line" && min > 0) {
    // Line charts in Office also start at zero unless values are all far from it.
    min = 0;
  }
  const targetTicks = Math.max(
    3,
    Math.min(10, Math.floor(horizontal ? area.width / (font * 5) : area.height / (font * 2.4))),
  );
  const scale = percent
    ? { min: 0, max: 100, step: 20, values: [0, 20, 40, 60, 80, 100] }
    : niceScale(min, max, targetTicks);
  let xScale: ReturnType<typeof niceScale> | null = null;
  if (scatter) {
    const xs = primary.series.flatMap((series) =>
      (series.xValues ?? []).filter((value): value is number => value !== null),
    );
    xScale = xs.length ? niceScale(Math.min(0, ...xs), Math.max(...xs)) : niceScale(0, count);
  }

  const valueLabels = scale.values.map((value) => formatNumber(value, model.valueFormat, percent));
  const categoryLabels = scatter
    ? (xScale?.values ?? []).map((value) => formatNumber(value, null))
    : categories;
  const valueLabelWidth =
    Math.max(...valueLabels.map((label) => textWidth(label, font))) + font * 0.6;
  const categoryLabelWidth =
    Math.max(0, ...categoryLabels.map((label) => textWidth(label, font))) + font * 0.6;
  const plotWidthGuess = area.width - valueLabelWidth - font * 0.6;
  const rotateLabels =
    !horizontal &&
    !scatter &&
    count > 1 &&
    categoryLabelWidth > plotWidthGuess / count &&
    count <= 40;
  const rotatedHeight = rotateLabels
    ? Math.min(area.height * 0.4, categoryLabelWidth * 0.72 + font)
    : 0;
  const plot: Box = horizontal
    ? {
        x: area.x + Math.min(area.width * 0.4, categoryLabelWidth),
        y: area.y + font * 0.4,
        width: area.width - Math.min(area.width * 0.4, categoryLabelWidth) - font,
        height: area.height - font * 2,
      }
    : {
        x: area.x + valueLabelWidth,
        y: area.y + font * 0.6,
        width: plotWidthGuess,
        height: area.height - font * 2.2 - rotatedHeight,
      };
  if (plot.width < 10 || plot.height < 10) return;

  const valueToPos = (value: number) =>
    horizontal
      ? plot.x + ((value - scale.min) / (scale.max - scale.min)) * plot.width
      : plot.y + plot.height - ((value - scale.min) / (scale.max - scale.min)) * plot.height;

  // Gridlines and value axis labels.
  scale.values.forEach((value, index) => {
    const pos = valueToPos(value);
    if (horizontal) {
      parts.push(
        `<line x1="${pos}" y1="${plot.y}" x2="${pos}" y2="${plot.y + plot.height}" stroke="#D9D9D9" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${pos}" y="${plot.y + plot.height + font * 1.3}" text-anchor="middle" font-size="${font}" fill="${muted}">${escapeXml(valueLabels[index]!)}</text>`,
      );
    } else {
      parts.push(
        `<line x1="${plot.x}" y1="${pos}" x2="${plot.x + plot.width}" y2="${pos}" stroke="#D9D9D9" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${plot.x - font * 0.4}" y="${pos + font * 0.35}" text-anchor="end" font-size="${font}" fill="${muted}">${escapeXml(valueLabels[index]!)}</text>`,
      );
    }
  });

  const band = (horizontal ? plot.height : plot.width) / count;
  const zero = valueToPos(Math.max(scale.min, Math.min(scale.max, 0)));
  // Category axis line.
  if (horizontal)
    parts.push(
      `<line x1="${zero}" y1="${plot.y}" x2="${zero}" y2="${plot.y + plot.height}" stroke="#BFBFBF"/>`,
    );
  else
    parts.push(
      `<line x1="${plot.x}" y1="${zero}" x2="${plot.x + plot.width}" y2="${zero}" stroke="#BFBFBF"/>`,
    );

  // Category labels (skip some if crowded).
  if (!scatter) {
    const step = Math.max(
      1,
      Math.ceil(
        (horizontal ? font * 1.2 : rotateLabels ? font * 1.1 : categoryLabelWidth * 0.9) / band,
      ),
    );
    categories.forEach((label, index) => {
      if (index % step) return;
      if (rotateLabels) {
        const x = plot.x + (index + 0.5) * band;
        const y = plot.y + plot.height + font * 0.8;
        const maxLength = (rotatedHeight - font) / 0.72;
        parts.push(
          `<text x="${x}" y="${y}" text-anchor="end" font-size="${font}" fill="${muted}" transform="rotate(-45 ${x} ${y})">${escapeXml(truncate(label, maxLength, font))}</text>`,
        );
      } else if (horizontal) {
        const y = plot.y + (count - index - 0.5) * band;
        parts.push(
          `<text x="${plot.x - font * 0.4}" y="${y + font * 0.35}" text-anchor="end" font-size="${font}" fill="${muted}">${escapeXml(truncate(label, area.width * 0.4, font))}</text>`,
        );
      } else {
        const x = plot.x + (index + 0.5) * band;
        parts.push(
          `<text x="${x}" y="${plot.y + plot.height + font * 1.3}" text-anchor="middle" font-size="${font}" fill="${muted}">${escapeXml(truncate(label, band * step, font))}</text>`,
        );
      }
    });
  } else if (xScale) {
    xScale.values.forEach((value, index) => {
      const x = plot.x + ((value - xScale!.min) / (xScale!.max - xScale!.min)) * plot.width;
      parts.push(
        `<line x1="${x}" y1="${plot.y}" x2="${x}" y2="${plot.y + plot.height}" stroke="#EEEEEE"/>`,
      );
      parts.push(
        `<text x="${x}" y="${plot.y + plot.height + font * 1.3}" text-anchor="middle" font-size="${font}" fill="${muted}">${escapeXml(categoryLabels[index] ?? "")}</text>`,
      );
    });
  }

  const barGroups = model.groups.filter((group) => group.kind === "bar");
  const clusteredBars = barGroups.reduce(
    (sum, group) =>
      sum +
      (group.grouping === "clustered" || group.grouping === "standard" ? group.series.length : 1),
    0,
  );
  let barOffset = 0;
  for (const group of model.groups) {
    const stacked = group.grouping === "stacked" || group.grouping === "percentStacked";
    const totals = Array.from(
      { length: count },
      (_, index) =>
        group.series.reduce((sum, series) => sum + Math.abs(series.values[index] ?? 0), 0) || 1,
    );
    const adjust = (value: number, index: number) =>
      group.grouping === "percentStacked" ? (value / totals[index]!) * 100 : value;
    if (group.kind === "bar") {
      const slots = Math.max(1, clusteredBars);
      const barSize = band / (slots + group.gapWidth / 100);
      const start = (band - barSize * slots) / 2;
      const positive = new Array<number>(count).fill(0);
      const negative = new Array<number>(count).fill(0);
      group.series.forEach((series, seriesIndex) => {
        const slot = stacked ? barOffset : barOffset + seriesIndex;
        series.values.forEach((raw, index) => {
          if (raw === null) return;
          const value = adjust(raw, index);
          let from = 0;
          let to = value;
          if (stacked) {
            if (value >= 0) {
              from = positive[index]!;
              positive[index]! += value;
              to = positive[index]!;
            } else {
              from = negative[index]!;
              negative[index]! += value;
              to = negative[index]!;
            }
          }
          const a = valueToPos(from);
          const b = valueToPos(to);
          const color = series.pointColors?.[index] ?? series.color ?? "#4472C4";
          if (horizontal) {
            const y = plot.y + (count - index - 1) * band + start + slot * barSize;
            parts.push(
              `<rect x="${Math.min(a, b)}" y="${y}" width="${Math.abs(b - a)}" height="${barSize}" fill="${color}"/>`,
            );
            if (group.showValues)
              parts.push(
                `<text x="${Math.max(a, b) + 3}" y="${y + barSize / 2 + font * 0.35}" font-size="${font * 0.9}" fill="${muted}">${escapeXml(formatNumber(raw, model.valueFormat))}</text>`,
              );
          } else {
            const x = plot.x + index * band + start + slot * barSize;
            parts.push(
              `<rect x="${x}" y="${Math.min(a, b)}" width="${barSize}" height="${Math.abs(b - a)}" fill="${color}"/>`,
            );
            if (group.showValues)
              parts.push(
                `<text x="${x + barSize / 2}" y="${Math.min(a, b) - 3}" text-anchor="middle" font-size="${font * 0.9}" fill="${muted}">${escapeXml(formatNumber(raw, model.valueFormat))}</text>`,
              );
          }
        });
      });
      barOffset += stacked ? 1 : group.series.length;
      continue;
    }
    const cumulative = new Array<number>(count).fill(0);
    group.series.forEach((series) => {
      const color = series.color ?? "#4472C4";
      const points: Array<[number, number] | null> = series.values.map((raw, index) => {
        if (raw === null) return null;
        let value = adjust(raw, index);
        if (stacked) {
          cumulative[index]! += value;
          value = cumulative[index]!;
        }
        const x =
          scatter && xScale
            ? plot.x +
              (((series.xValues?.[index] ?? index + 1) - xScale.min) / (xScale.max - xScale.min)) *
                plot.width
            : plot.x + (index + 0.5) * band;
        return [x, valueToPos(value)];
      });
      const valid = points.filter((point): point is [number, number] => point !== null);
      if (group.kind === "area" && valid.length) {
        const baseline = valueToPos(0);
        const d = `M${valid[0]![0]},${baseline} ${valid.map(([x, y]) => `L${x},${y}`).join(" ")} L${valid[valid.length - 1]![0]},${baseline} Z`;
        parts.push(`<path d="${d}" fill="${color}" fill-opacity="${stacked ? 1 : 0.85}"/>`);
      } else if (valid.length) {
        if (group.kind === "line" || (scatter && series.marker === false)) {
          const d = points
            .map((point, index) =>
              point
                ? `${index === 0 || !points[index - 1] ? "M" : "L"}${point[0]},${point[1]}`
                : "",
            )
            .join(" ");
          parts.push(
            `<path d="${d}" fill="none" stroke="${color}" stroke-width="${2.25 * Math.max(0.8, font / 12)}" stroke-linejoin="round" stroke-linecap="round"/>`,
          );
        }
        if (series.marker) {
          valid.forEach(([x, y]) =>
            parts.push(
              `<circle cx="${x}" cy="${y}" r="${font * 0.3}" fill="${color}" stroke="${color}"/>`,
            ),
          );
        }
      }
      if (group.showValues) {
        points.forEach((point, index) => {
          if (!point) return;
          parts.push(
            `<text x="${point[0]}" y="${point[1] - font * 0.5}" text-anchor="middle" font-size="${font * 0.9}" fill="${muted}">${escapeXml(formatNumber(series.values[index] ?? 0, model.valueFormat))}</text>`,
          );
        });
      }
    });
  }
}
