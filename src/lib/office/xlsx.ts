import * as SSF from "ssf";
import {
  OFFICE_LIMITS,
  OfficeError,
  nextFrame,
  throwIfCancelled,
  extensionOf,
  type RenderContext,
} from "./common";
import { renderChartSvg } from "./charts";
import type { ExcelOptions } from "./convert";
import { officeFontStack } from "./fonts";
import { createPage, waitForAssets, type RenderHost } from "./host";
import {
  csvWorkbook,
  defaultCellStyle,
  loadWorkbook,
  type Anchor,
  type BorderEdge,
  type Cell,
  type CellStyle,
  type Range,
  type Sheet,
  type Workbook,
} from "./xlsx-model";

export const XLSX_EXTRA_CSS = `
.xl-pane { position: absolute; overflow: hidden; }
.xl-layer { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.xl-fill, .xl-grid, .xl-border, .xl-text, .xl-drawing { position: absolute; box-sizing: border-box; }
.xl-text { display: flex; overflow: hidden; padding: 0 2px; line-height: 1.2; }
.xl-text > span { display: block; min-width: 0; }
.xl-text a { color: inherit; text-decoration: inherit; }
.xl-text.xl-nowrap > span { white-space: pre; }
.xl-text.xl-wrap > span { white-space: pre-wrap; overflow-wrap: anywhere; width: 100%; }
.xl-hf { position: absolute; display: grid; grid-template-columns: 1fr 1fr 1fr; font-size: 10pt; line-height: 1.2; white-space: pre-wrap; }
.xl-hf > div:nth-child(1) { text-align: left; }
.xl-hf > div:nth-child(2) { text-align: center; }
.xl-hf > div:nth-child(3) { text-align: right; }
`;

const PAPER_INCHES: Record<number, [number, number]> = {
  1: [8.5, 11],
  2: [8.5, 11],
  3: [11, 17],
  4: [17, 11],
  5: [8.5, 14],
  6: [5.5, 8.5],
  7: [7.25, 10.5],
  8: [11.69, 16.54],
  9: [8.27, 11.69],
  10: [8.27, 11.69],
  11: [5.83, 8.27],
  12: [9.84, 13.9],
  13: [7.17, 10.12],
  14: [8.5, 13],
  15: [8.46, 10.83],
  16: [10, 14],
  17: [11, 17],
  18: [8.5, 11],
  19: [3.875, 8.875],
  20: [4.125, 9.5],
  27: [4.33, 8.66],
  28: [6.38, 9.02],
  34: [6.93, 9.84],
  37: [3.875, 7.5],
  38: [4.33, 8.66],
  39: [14.875, 11],
  41: [8.5, 13],
  66: [16.54, 23.39],
  70: [4.13, 5.83],
  75: [11.69, 8.27],
  77: [16.54, 11.69],
};

const DPI = 96;

type Metrics = {
  x: number[];
  y: number[];
  width: (col: number) => number;
  height: (row: number) => number;
};

type Pane = { rows: [number, number]; cols: [number, number]; left: number; top: number };

type SheetPage = {
  sheet: Sheet;
  panes: Pane[];
  widthPt: number;
  heightPt: number;
  scale: number;
  contentWidth: number;
  contentHeight: number;
  indexInSheet: number;
};

export async function renderWorkbook(
  input: ArrayBuffer,
  fileName: string,
  host: RenderHost,
  context: RenderContext,
  options: ExcelOptions,
  warnings: string[],
): Promise<HTMLElement[]> {
  context.progress("Reading workbook…");
  setGridOption(options.gridlines);
  let workbook: Workbook;
  if (extensionOf(fileName) === ".csv") {
    const text = decodeText(new Uint8Array(input));
    workbook = csvWorkbook(text, fileName.replace(/\.[^.]+$/, ""), defaultCellStyle());
  } else {
    workbook = await loadWorkbook(input);
  }
  throwIfCancelled(context);

  let sheets = workbook.sheets.filter((sheet) => !sheet.hidden);
  if (options.scope === "active") {
    const active = workbook.sheets[workbook.activeTab] ?? sheets[0];
    sheets = active && !active.hidden ? [active] : sheets.slice(0, 1);
  }
  if (!sheets.length) throw new OfficeError("empty-document");

  const plan: SheetPage[] = [];
  const metricsBySheet = new Map<Sheet, Metrics>();
  let formulaWithoutValue = false;
  for (const sheet of sheets) {
    throwIfCancelled(context);
    context.progress(`Laying out “${sheet.name}”…`);
    if (sheet.kind === "chartsheet") {
      const chart = sheet.drawings.find((drawing) => drawing.kind === "chart");
      if (!chart) continue;
      const [w, h] = paperSize(sheet, options, true);
      plan.push({
        sheet,
        panes: [],
        widthPt: w * 72,
        heightPt: h * 72,
        scale: 1,
        contentWidth: 0,
        contentHeight: 0,
        indexInSheet: 0,
      });
      continue;
    }
    const metrics = measureSheet(sheet, workbook, host);
    metricsBySheet.set(sheet, metrics);
    const pages = paginateSheet(sheet, workbook, metrics, options);
    plan.push(...pages);
    if (plan.length > OFFICE_LIMITS.pages) throw new OfficeError("too-many-pages");
    if (!formulaWithoutValue) formulaWithoutValue = hasEmptyFormulaCells(sheet);
    await nextFrame();
  }
  if (!plan.length) throw new OfficeError("empty-document");
  if (formulaWithoutValue) {
    warnings.push(
      "Some formulas have no saved results. Open the file in Excel, save it, then convert again to show them.",
    );
  }

  const pages: HTMLElement[] = [];
  const total = plan.length;
  for (let index = 0; index < plan.length; index++) {
    throwIfCancelled(context);
    if (index % 5 === 0) {
      context.progress(`Drawing page ${index + 1} of ${total}…`);
      await nextFrame();
    }
    const item = plan[index]!;
    const page = createPage(host.doc, item.widthPt, item.heightPt);
    host.root.appendChild(page);
    if (item.sheet.kind === "chartsheet") drawChartsheet(page, item, options);
    else drawSheetPage(page, item, workbook, metricsBySheet.get(item.sheet)!, fileName);
    drawHeaderFooter(page, item, index + 1, total, fileName);
    fixNumberOverflow(page);
    pages.push(page);
  }
  await waitForAssets(host.doc);
  return pages;
}

function decodeText(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function hasEmptyFormulaCells(sheet: Sheet) {
  return sheet.emptyFormulas;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

function styleOf(workbook: Workbook, cell: Cell | undefined) {
  return (cell && workbook.styles[cell.style]) || workbook.defaultStyle;
}

function hasValue(cell: Cell | undefined) {
  return !!cell && cell.value !== null && cell.value !== "";
}

function usedRange(sheet: Sheet, workbook: Workbook, metrics: Metrics): Range | null {
  let r1 = Infinity;
  let c1 = Infinity;
  let r2 = 0;
  let c2 = 0;
  const include = (row: number, col: number) => {
    r1 = Math.min(r1, row);
    c1 = Math.min(c1, col);
    r2 = Math.max(r2, row);
    c2 = Math.max(c2, col);
  };
  for (const [row, cells] of sheet.cells) {
    for (const [col, cell] of cells) {
      const style = workbook.styles[cell.style];
      const b = style?.border;
      if (hasValue(cell) || style?.fill || b?.left || b?.right || b?.top || b?.bottom)
        include(row, col);
      // Left-aligned text that overflows into empty columns extends the printed range, like Excel.
      if (
        cell.type === "s" &&
        typeof cell.value === "string" &&
        style &&
        !style.align.wrap &&
        ["general", "left"].includes(style.align.horizontal)
      ) {
        const estimate =
          Math.max(...cell.value.split("\n").map((line) => line.length)) *
            style.font.size *
            (96 / 72) *
            0.52 +
          4;
        let end = col;
        let used = metrics.width(col);
        while (used < estimate && end < col + 50 && !hasValue(cells.get(end + 1))) {
          end++;
          used += metrics.width(end);
        }
        if (end > col) include(row, end);
      }
    }
  }
  for (const merge of sheet.merges) {
    const topLeft = sheet.cells.get(merge.r1)?.get(merge.c1);
    if (hasValue(topLeft)) {
      include(merge.r1, merge.c1);
      include(merge.r2, merge.c2);
    }
  }
  for (const drawing of sheet.drawings) {
    const box = anchorBox(drawing.anchor, metrics);
    const from = locate(box.x, box.y, metrics);
    const to = locate(box.x + box.width - 1, box.y + box.height - 1, metrics);
    include(from.row, from.col);
    include(to.row, to.col);
  }
  if (!r2) return null;
  return { r1, c1, r2, c2 };
}

function locate(x: number, y: number, metrics: Metrics) {
  let col = 1;
  while (col < metrics.x.length - 1 && metrics.x[col + 1]! <= x) col++;
  let row = 1;
  while (row < metrics.y.length - 1 && metrics.y[row + 1]! <= y) row++;
  return { col, row };
}

function anchorBox(anchor: Anchor, metrics: Metrics) {
  const xAt = (col: number) => metrics.x[Math.min(col, metrics.x.length - 1)] ?? 0;
  const yAt = (row: number) => metrics.y[Math.min(row, metrics.y.length - 1)] ?? 0;
  if (anchor.absolute) {
    return {
      x: anchor.absolute.x,
      y: anchor.absolute.y,
      width: anchor.ext?.width ?? 0,
      height: anchor.ext?.height ?? 0,
    };
  }
  const x = xAt(anchor.from.col) + Math.min(anchor.from.colOff, metrics.width(anchor.from.col));
  const y = yAt(anchor.from.row) + Math.min(anchor.from.rowOff, metrics.height(anchor.from.row));
  if (anchor.to) {
    const x2 = xAt(anchor.to.col) + Math.min(anchor.to.colOff, metrics.width(anchor.to.col));
    const y2 = yAt(anchor.to.row) + Math.min(anchor.to.rowOff, metrics.height(anchor.to.row));
    return { x, y, width: Math.max(1, x2 - x), height: Math.max(1, y2 - y) };
  }
  return { x, y, width: anchor.ext?.width ?? 0, height: anchor.ext?.height ?? 0 };
}

function colWidthPx(sheet: Sheet, workbook: Workbook, col: number) {
  const info = sheet.colWidths.get(col);
  if (info?.hidden) return 0;
  const width = info?.width ?? sheet.defaultColWidth;
  return Math.max(0, Math.round(width * workbook.maxDigitWidth));
}

/** Column/row pixel offsets, including auto-fit heights for wrapped or large text. */
function measureSheet(sheet: Sheet, workbook: Workbook, host: RenderHost): Metrics {
  let maxCol = 1;
  let maxRow = 1;
  for (const [row, cells] of sheet.cells) {
    maxRow = Math.max(maxRow, row);
    for (const col of cells.keys()) maxCol = Math.max(maxCol, col);
  }
  for (const merge of sheet.merges) {
    maxRow = Math.max(maxRow, merge.r2);
    maxCol = Math.max(maxCol, merge.c2);
  }
  for (const drawing of sheet.drawings) {
    const anchor = drawing.anchor;
    maxCol = Math.max(maxCol, (anchor.to?.col ?? anchor.from.col) + 30);
    maxRow = Math.max(maxRow, (anchor.to?.row ?? anchor.from.row) + 60);
  }
  for (const range of sheet.printAreas ?? []) {
    maxRow = Math.max(maxRow, Math.min(range.r2, maxRow + 1000));
    maxCol = Math.max(maxCol, Math.min(range.c2, maxCol + 200));
  }
  maxCol = Math.min(maxCol + 60, 16384);
  maxRow = Math.min(maxRow + 1, 1048576);

  const widths: number[] = [0];
  for (let col = 1; col <= maxCol; col++) widths[col] = colWidthPx(sheet, workbook, col);
  const defaultHeight = (sheet.defaultRowHeight * DPI) / 72;
  const heights: number[] = [0];
  const needsFit: number[] = [];
  const mergedCells = new Set<string>();
  for (const merge of sheet.merges) {
    if (merge.r1 === merge.r2 && merge.c1 === merge.c2) continue;
    for (let row = merge.r1; row <= merge.r2; row++)
      for (let col = merge.c1; col <= merge.c2; col++) mergedCells.add(`${row}:${col}`);
  }
  for (let row = 1; row <= maxRow; row++) {
    const info = sheet.rows.get(row);
    if (info?.hidden) {
      heights[row] = 0;
      continue;
    }
    if (info?.height !== null && info?.height !== undefined) {
      heights[row] = (info.height * DPI) / 72;
      continue;
    }
    heights[row] = defaultHeight;
    const cells = sheet.cells.get(row);
    if (!cells) continue;
    for (const cell of cells.values()) {
      if (!hasValue(cell) || mergedCells.has(`${row}:${cell.col}`)) continue;
      const style = styleOf(workbook, cell);
      if (
        style.align.wrap ||
        style.font.size > 11.5 ||
        (typeof cell.value === "string" && cell.value.includes("\n"))
      ) {
        needsFit.push(row);
        break;
      }
    }
  }

  if (needsFit.length) {
    // Measure wrapped/large text to emulate Excel's automatic row height.
    const probe = host.doc.createElement("div");
    probe.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;";
    host.root.appendChild(probe);
    for (const row of needsFit) {
      let needed = heights[row]!;
      for (const cell of sheet.cells.get(row)!.values()) {
        if (!hasValue(cell) || mergedCells.has(`${row}:${cell.col}`)) continue;
        const style = styleOf(workbook, cell);
        const text = formatCell(cell, style, workbook).text;
        const span = host.doc.createElement("div");
        applyFont(span.style, style.font);
        span.style.lineHeight = "1.2";
        span.style.whiteSpace = style.align.wrap ? "pre-wrap" : "pre";
        span.style.overflowWrap = "anywhere";
        span.style.width = style.align.wrap
          ? `${Math.max(4, (widths[cell.col] ?? 64) - 4)}px`
          : "auto";
        span.textContent = text || " ";
        probe.appendChild(span);
        needed = Math.max(needed, span.offsetHeight + 2);
        span.remove();
      }
      heights[row] = Math.min(needed, 409 * (DPI / 72));
    }
    probe.remove();
  }

  const x: number[] = [0, 0];
  for (let col = 1; col <= maxCol; col++) x[col + 1] = x[col]! + widths[col]!;
  const y: number[] = [0, 0];
  for (let row = 1; row <= maxRow; row++) y[row + 1] = y[row]! + heights[row]!;
  return {
    x,
    y,
    width: (col) => widths[col] ?? (col > maxCol ? colWidthPx(sheet, workbook, col) : 0),
    height: (row) => heights[row] ?? defaultHeight,
  };
}

function spanX(metrics: Metrics, c1: number, c2: number) {
  let total = 0;
  for (let col = c1; col <= c2; col++) total += metrics.width(col);
  return total;
}

function spanY(metrics: Metrics, r1: number, r2: number) {
  let total = 0;
  for (let row = r1; row <= r2; row++) total += metrics.height(row);
  return total;
}

function paperSize(sheet: Sheet, options: ExcelOptions, preferLandscape = false): [number, number] {
  const [w, h] = PAPER_INCHES[sheet.setup.paperSize] ?? PAPER_INCHES[1]!;
  let orientation = options.orientation === "file" ? sheet.setup.orientation : options.orientation;
  if (orientation === "default") orientation = preferLandscape ? "landscape" : "portrait";
  const portrait: [number, number] = [Math.min(w, h), Math.max(w, h)];
  return orientation === "landscape" ? [portrait[1], portrait[0]] : portrait;
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

function splitAxis(
  start: number,
  end: number,
  available: number,
  size: (index: number) => number,
  breaks: Set<number>,
) {
  const segments: Array<[number, number]> = [];
  let segmentStart = start;
  let used = 0;
  for (let index = start; index <= end; index++) {
    const current = size(index);
    if (index > segmentStart && used + current > available + 0.5) {
      segments.push([segmentStart, index - 1]);
      segmentStart = index;
      used = 0;
    }
    used += current;
    if (breaks.has(index) && index < end) {
      segments.push([segmentStart, index]);
      segmentStart = index + 1;
      used = 0;
    }
  }
  if (segmentStart <= end) segments.push([segmentStart, end]);
  // Drop segments that are entirely hidden.
  return segments.filter(([a, b]) => {
    for (let index = a; index <= b; index++) if (size(index) > 0) return true;
    return false;
  });
}

function paginateSheet(
  sheet: Sheet,
  workbook: Workbook,
  metrics: Metrics,
  options: ExcelOptions,
): SheetPage[] {
  const areas = sheet.printAreas?.length
    ? sheet.printAreas
    : [usedRange(sheet, workbook, metrics)].filter((r): r is Range => r !== null);
  if (!areas.length) return [];
  const [paperW, paperH] = paperSize(sheet, options);
  const m = sheet.setup.margins;
  const printW = Math.max(1, (paperW - m.left - m.right) * DPI);
  const printH = Math.max(1, (paperH - m.top - m.bottom) * DPI);
  const pages: SheetPage[] = [];
  let indexInSheet = 0;

  for (const rawArea of areas) {
    const area = {
      r1: rawArea.r1,
      c1: rawArea.c1,
      r2: Math.min(rawArea.r2, metrics.y.length - 2),
      c2: Math.min(rawArea.c2, metrics.x.length - 2),
    };
    if (area.r2 < area.r1 || area.c2 < area.c1) continue;
    const titleRows = sheet.titleRows;
    const titleCols = sheet.titleCols;
    const titleRowsHeight = titleRows ? spanY(metrics, titleRows[0], titleRows[1]) : 0;
    const titleColsWidth = titleCols ? spanX(metrics, titleCols[0], titleCols[1]) : 0;
    const totalW = spanX(metrics, area.c1, area.c2);
    const totalH = spanY(metrics, area.r1, area.r2);

    let scale: number;
    if (options.scaling === "fit-width") {
      scale = totalW > 0 ? Math.min(1, printW / totalW) : 1;
    } else if (options.scaling === "fit-page") {
      scale = Math.min(1, totalW > 0 ? printW / totalW : 1, totalH > 0 ? printH / totalH : 1);
    } else if (sheet.setup.fitToPage) {
      scale = 1;
      if (sheet.setup.fitToWidth > 0 && totalW > 0)
        scale = Math.min(scale, (sheet.setup.fitToWidth * printW) / totalW);
      if (sheet.setup.fitToHeight > 0 && totalH > 0)
        scale = Math.min(scale, (sheet.setup.fitToHeight * printH) / totalH);
    } else {
      scale = sheet.setup.scale / 100;
    }
    scale = Math.max(0.1, Math.min(4, scale));

    const availableW = printW / scale;
    const availableH = printH / scale;
    const colSegments = splitAxis(
      area.c1,
      area.c2,
      availableW - titleColsWidth,
      metrics.width,
      sheet.colBreaks,
    );
    const rowSegments = splitAxis(
      area.r1,
      area.r2,
      availableH - titleRowsHeight,
      metrics.height,
      sheet.rowBreaks,
    );
    const order: Array<[[number, number], [number, number]]> = [];
    if (sheet.setup.pageOrder === "overThenDown") {
      for (const rows of rowSegments) for (const cols of colSegments) order.push([rows, cols]);
    } else {
      for (const cols of colSegments) for (const rows of rowSegments) order.push([rows, cols]);
    }
    for (const [rows, cols] of order) {
      if (!regionHasContent(sheet, workbook, metrics, rows, cols)) continue;
      const repeatRows = titleRows && rows[0] > titleRows[1] ? titleRows : null;
      const repeatCols = titleCols && cols[0] > titleCols[1] ? titleCols : null;
      const topH = repeatRows ? spanY(metrics, repeatRows[0], repeatRows[1]) : 0;
      const leftW = repeatCols ? spanX(metrics, repeatCols[0], repeatCols[1]) : 0;
      const bodyW = spanX(metrics, cols[0], cols[1]);
      const bodyH = spanY(metrics, rows[0], rows[1]);
      const panes: Pane[] = [];
      if (repeatRows && repeatCols)
        panes.push({ rows: repeatRows, cols: repeatCols, left: 0, top: 0 });
      if (repeatRows) panes.push({ rows: repeatRows, cols, left: leftW, top: 0 });
      if (repeatCols) panes.push({ rows, cols: repeatCols, left: 0, top: topH });
      panes.push({ rows, cols, left: leftW, top: topH });
      pages.push({
        sheet,
        panes,
        widthPt: paperW * 72,
        heightPt: paperH * 72,
        scale,
        contentWidth: leftW + bodyW,
        contentHeight: topH + bodyH,
        indexInSheet: indexInSheet++,
      });
    }
  }
  return pages;
}

/** Excel skips pages of the print range that contain nothing to print. */
function regionHasContent(
  sheet: Sheet,
  workbook: Workbook,
  metrics: Metrics,
  rows: [number, number],
  cols: [number, number],
) {
  for (let row = rows[0]; row <= rows[1]; row++) {
    const cells = sheet.cells.get(row);
    if (!cells) continue;
    for (const [col, cell] of cells) {
      if (col < cols[0] || col > cols[1]) continue;
      const style = workbook.styles[cell.style];
      const b = style?.border;
      if (hasValue(cell) || style?.fill || b?.left || b?.right || b?.top || b?.bottom) return true;
    }
  }
  for (const merge of sheet.merges) {
    if (
      merge.r2 >= rows[0] &&
      merge.r1 <= rows[1] &&
      merge.c2 >= cols[0] &&
      merge.c1 <= cols[1] &&
      hasValue(sheet.cells.get(merge.r1)?.get(merge.c1))
    )
      return true;
  }
  const x1 = metrics.x[cols[0]] ?? 0;
  const x2 = metrics.x[cols[1] + 1] ?? Infinity;
  const y1 = metrics.y[rows[0]] ?? 0;
  const y2 = metrics.y[rows[1] + 1] ?? Infinity;
  return sheet.drawings.some((drawing) => {
    const box = anchorBox(drawing.anchor, metrics);
    return box.x < x2 && box.x + box.width > x1 && box.y < y2 && box.y + box.height > y1;
  });
}

/* ------------------------------------------------------------------ */
/* Cell formatting                                                     */
/* ------------------------------------------------------------------ */

const FORMAT_COLORS: Record<string, string> = {
  black: "#000000",
  blue: "#0000FF",
  cyan: "#00FFFF",
  green: "#00FF00",
  magenta: "#FF00FF",
  red: "#FF0000",
  white: "#FFFFFF",
  yellow: "#FFFF00",
};

function splitSections(format: string) {
  const sections: string[] = [];
  let current = "";
  let quoted = false;
  let bracket = false;
  for (let index = 0; index < format.length; index++) {
    const char = format[index]!;
    if (char === "\\" && !quoted) {
      current += char + (format[index + 1] ?? "");
      index++;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "[") bracket = true;
    if (!quoted && char === "]") bracket = false;
    if (char === ";" && !quoted && !bracket) {
      sections.push(current);
      current = "";
    } else current += char;
  }
  sections.push(current);
  return sections;
}

function toSerial(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return (time - Date.UTC(1899, 11, 30)) / 86400000;
}

type Formatted = {
  text: string;
  color: string | null;
  numeric: boolean;
  accounting: [string, string] | null;
};

function formatCell(cell: Cell, style: CellStyle, workbook: Workbook): Formatted {
  const format = style.numFmt || "General";
  if (cell.type === "b")
    return { text: cell.value ? "TRUE" : "FALSE", color: null, numeric: false, accounting: null };
  if (cell.type === "e")
    return { text: String(cell.value ?? ""), color: null, numeric: false, accounting: null };
  let value: CellValue = cell.value;
  if (cell.type === "d" && typeof value === "string") value = toSerial(value);
  if (typeof value === "number") {
    const sections = splitSections(format);
    const section =
      value > 0 || sections.length === 1
        ? sections[0]
        : value < 0
          ? (sections[1] ?? sections[0])
          : (sections[2] ?? sections[0]);
    const colorMatch = /\[(black|blue|cyan|green|magenta|red|white|yellow|color\s*\d+)\]/i.exec(
      section ?? "",
    );
    let color: string | null = null;
    if (colorMatch) {
      const key = colorMatch[1]!.toLowerCase();
      color = FORMAT_COLORS[key] ?? null;
    }
    let text: string;
    try {
      text = /^general$/i.test(format.trim())
        ? formatGeneral(value)
        : SSF.format(format, value, { date1904: workbook.date1904 });
    } catch {
      text = formatGeneral(value);
    }
    let accounting: [string, string] | null = null;
    if (section && /\*/.test(section)) {
      const match = /^(\s*)([^\d\s(\-.,]+?)\s+(.*\S)\s*$/.exec(text);
      if (match) accounting = [match[2]!, match[3]!];
    }
    return { text, color, numeric: true, accounting };
  }
  const text = String(value ?? "");
  const sections = splitSections(format);
  const textSection =
    sections.length >= 4 ? sections[3] : sections.find((item) => item.includes("@"));
  if (textSection && textSection.includes("@") && textSection !== "@") {
    try {
      return { text: SSF.format(textSection, text), color: null, numeric: false, accounting: null };
    } catch {
      /* fall through */
    }
  }
  return { text, color: null, numeric: false, accounting: null };
}

type CellValue = number | string | boolean | null;

/** Excel "General" formatting: up to 11 significant digits, scientific for extremes. */
function formatGeneral(value: number) {
  if (!Number.isFinite(value)) return "#NUM!";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e11 || abs < 1e-9) {
    return value
      .toExponential(5)
      .replace(/\.?0+e/, "E")
      .replace(/E\+?(-?)(\d)$/, "E+$10$2")
      .replace("E+-", "E-");
  }
  const digits = Math.max(0, 10 - Math.floor(Math.log10(abs)));
  return String(Number(value.toFixed(Math.min(digits, 10))));
}

function applyFont(style: CSSStyleDeclaration, font: Partial<CellStyle["font"]>) {
  if (font.name) style.fontFamily = officeFontStack(font.name);
  if (font.size) style.fontSize = `${font.size}pt`;
  if (font.bold !== undefined) style.fontWeight = font.bold ? "700" : "400";
  if (font.italic !== undefined) style.fontStyle = font.italic ? "italic" : "normal";
  if (font.color) style.color = font.color;
  const decorations: string[] = [];
  if (font.underline && font.underline !== "none") decorations.push("underline");
  if (font.strike) decorations.push("line-through");
  if (font.underline !== undefined || font.strike !== undefined) {
    style.textDecoration = decorations.join(" ") || "none";
    if (font.underline === "double") style.textDecorationStyle = "double";
  }
  if (font.vertAlign === "superscript") {
    style.verticalAlign = "super";
    style.fontSize = `${(font.size ?? 11) * 0.7}pt`;
  } else if (font.vertAlign === "subscript") {
    style.verticalAlign = "sub";
    style.fontSize = `${(font.size ?? 11) * 0.7}pt`;
  }
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

function borderCss(edge: BorderEdge) {
  if (!edge) return null;
  const map: Record<string, [number, string]> = {
    thin: [1, "solid"],
    hair: [1, "dotted"],
    dotted: [1, "dotted"],
    dashed: [1, "dashed"],
    dashDot: [1, "dashed"],
    dashDotDot: [1, "dashed"],
    medium: [2, "solid"],
    mediumDashed: [2, "dashed"],
    mediumDashDot: [2, "dashed"],
    mediumDashDotDot: [2, "dashed"],
    slantDashDot: [2, "dashed"],
    thick: [3, "solid"],
    double: [3, "double"],
  };
  const [width, style] = map[edge.style] ?? [1, "solid"];
  return { width, style, color: edge.color };
}

function drawSheetPage(
  page: HTMLElement,
  item: SheetPage,
  workbook: Workbook,
  metrics: Metrics,
  fileName: string,
) {
  const doc = page.ownerDocument;
  const m = item.sheet.setup.margins;
  const printW = page.offsetWidth - (m.left + m.right) * DPI;
  const printH = page.offsetHeight - (m.top + m.bottom) * DPI;
  const scaledW = item.contentWidth * item.scale;
  const scaledH = item.contentHeight * item.scale;
  const offsetX = item.sheet.setup.horizontalCentered ? Math.max(0, (printW - scaledW) / 2) : 0;
  const offsetY = item.sheet.setup.verticalCentered ? Math.max(0, (printH - scaledH) / 2) : 0;
  const frame = doc.createElement("div");
  frame.className = "xl-pane";
  Object.assign(frame.style, {
    left: `${m.left * DPI + offsetX}px`,
    top: `${m.top * DPI + offsetY}px`,
    width: `${Math.min(printW, scaledW) + 1}px`,
    height: `${Math.min(printH, scaledH) + 1}px`,
  });
  const layer = doc.createElement("div");
  layer.className = "xl-layer";
  layer.style.transform = `scale(${item.scale})`;
  layer.style.width = `${item.contentWidth}px`;
  layer.style.height = `${item.contentHeight}px`;
  if (item.sheet.rightToLeft) {
    layer.style.transform = `scale(${item.scale})`;
  }
  frame.appendChild(layer);
  page.appendChild(frame);
  const gridlines = gridlinesFor(item.sheet);
  for (const pane of item.panes) {
    const element = doc.createElement("div");
    element.className = "xl-pane";
    const width = spanX(metrics, pane.cols[0], pane.cols[1]);
    const height = spanY(metrics, pane.rows[0], pane.rows[1]);
    Object.assign(element.style, {
      left: `${pane.left}px`,
      top: `${pane.top}px`,
      width: `${width + 1}px`,
      height: `${height + 1}px`,
    });
    drawRegion(element, item.sheet, workbook, metrics, pane, gridlines);
    layer.appendChild(element);
  }
  void fileName;
}

let currentGridOption: ExcelOptions["gridlines"] = "file";

function gridlinesFor(sheet: Sheet) {
  if (currentGridOption === "on") return true;
  if (currentGridOption === "off") return false;
  return sheet.setup.gridLines;
}

export function setGridOption(option: ExcelOptions["gridlines"]) {
  currentGridOption = option;
}

function drawRegion(
  container: HTMLElement,
  sheet: Sheet,
  workbook: Workbook,
  metrics: Metrics,
  pane: Pane,
  gridlines: boolean,
) {
  const doc = container.ownerDocument;
  const [r1, r2] = pane.rows;
  const [c1, c2] = pane.cols;
  const originX = metrics.x[c1] ?? 0;
  const originY = metrics.y[r1] ?? 0;
  const X = (col: number) => (metrics.x[col] ?? metrics.x[metrics.x.length - 1]!) - originX;
  const Y = (row: number) => (metrics.y[row] ?? metrics.y[metrics.y.length - 1]!) - originY;
  const fragment = doc.createDocumentFragment();

  // Merge lookup.
  const mergeAt = new Map<string, Range>();
  const covered = new Set<string>();
  for (const merge of sheet.merges) {
    if (merge.r2 < r1 || merge.r1 > r2 || merge.c2 < c1 || merge.c1 > c2) continue;
    mergeAt.set(`${merge.r1}:${merge.c1}`, merge);
    for (let row = merge.r1; row <= merge.r2; row++) {
      for (let col = merge.c1; col <= merge.c2; col++)
        if (row !== merge.r1 || col !== merge.c1) covered.add(`${row}:${col}`);
    }
  }

  if (gridlines) {
    const color = "#C8C8C8";
    for (let col = c1; col <= c2 + 1; col++) {
      if (col <= c2 && metrics.width(col) === 0) continue;
      const line = doc.createElement("div");
      line.className = "xl-grid";
      Object.assign(line.style, {
        left: `${X(col)}px`,
        top: "0",
        width: "0",
        height: `${Y(r2 + 1)}px`,
        borderLeft: `1px solid ${color}`,
      });
      fragment.appendChild(line);
    }
    for (let row = r1; row <= r2 + 1; row++) {
      if (row <= r2 && metrics.height(row) === 0) continue;
      const line = doc.createElement("div");
      line.className = "xl-grid";
      Object.assign(line.style, {
        left: "0",
        top: `${Y(row)}px`,
        width: `${X(c2 + 1)}px`,
        height: "0",
        borderTop: `1px solid ${color}`,
      });
      fragment.appendChild(line);
    }
  }

  const fills: HTMLElement[] = [];
  const borders: HTMLElement[] = [];
  const texts: HTMLElement[] = [];

  // Merged areas that start outside this pane but overlap it.
  const visitCells: Array<{ row: number; col: number; cell: Cell | undefined }> = [];
  for (const merge of mergeAt.values()) {
    if (merge.r1 < r1 || merge.c1 < c1)
      visitCells.push({
        row: merge.r1,
        col: merge.c1,
        cell: sheet.cells.get(merge.r1)?.get(merge.c1),
      });
  }
  for (let row = r1; row <= r2; row++) {
    if (metrics.height(row) === 0) continue;
    const cells = sheet.cells.get(row);
    if (!cells) continue;
    for (const [col, cell] of cells) {
      if (col < c1 || col > c2 || metrics.width(col) === 0) continue;
      visitCells.push({ row, col, cell });
    }
  }
  // Merges whose top-left cell has no <c> element still need gridline masking.
  for (const merge of mergeAt.values()) {
    if (!sheet.cells.get(merge.r1)?.get(merge.c1) && merge.r1 >= r1 && merge.c1 >= c1)
      visitCells.push({ row: merge.r1, col: merge.c1, cell: undefined });
  }

  for (const { row, col, cell } of visitCells) {
    const key = `${row}:${col}`;
    if (covered.has(key)) {
      // Covered cells still draw their own outer borders in Excel; keep edge borders only.
      if (cell)
        drawBorders(
          borders,
          doc,
          styleOf(workbook, cell),
          X(col),
          Y(row),
          metrics.width(col),
          metrics.height(row),
        );
      continue;
    }
    const merge = mergeAt.get(key);
    const endCol = merge ? merge.c2 : col;
    const endRow = merge ? merge.r2 : row;
    const x = X(col);
    const y = Y(row);
    const width = X(endCol + 1) - x;
    const height = Y(endRow + 1) - y;
    if (width <= 0 || height <= 0) continue;
    const style = styleOf(workbook, cell);
    if (style.fill || (merge && gridlines)) {
      const fill = doc.createElement("div");
      fill.className = "xl-fill";
      Object.assign(fill.style, {
        left: `${x + (style.fill ? 0 : 1)}px`,
        top: `${y + (style.fill ? 0 : 1)}px`,
        width: `${width - (style.fill ? 0 : 1)}px`,
        height: `${height - (style.fill ? 0 : 1)}px`,
        background: style.fill ?? "#FFFFFF",
      });
      fills.push(fill);
    }
    if (cell) drawBorders(borders, doc, style, x, y, width, height);
    if (!cell || !hasValue(cell)) continue;
    const text = drawText(
      doc,
      sheet,
      workbook,
      metrics,
      cell,
      style,
      x,
      y,
      width,
      height,
      !!merge,
      c1,
      c2,
      covered,
      X,
    );
    if (text) texts.push(text);
  }
  fills.forEach((node) => fragment.appendChild(node));
  borders.forEach((node) => fragment.appendChild(node));
  texts.forEach((node) => fragment.appendChild(node));

  for (const drawing of sheet.drawings) {
    const box = anchorBox(drawing.anchor, metrics);
    const x = box.x - originX;
    const y = box.y - originY;
    if (
      x > X(c2 + 1) ||
      y > Y(r2 + 1) ||
      x + box.width < 0 ||
      y + box.height < 0 ||
      box.width <= 0 ||
      box.height <= 0
    )
      continue;
    const holder = doc.createElement("div");
    holder.className = "xl-drawing";
    Object.assign(holder.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    if (drawing.kind === "image") {
      const image = doc.createElement("img");
      image.src = drawing.src;
      image.alt = "";
      image.style.width = "100%";
      image.style.height = "100%";
      image.style.display = "block";
      holder.appendChild(image);
    } else {
      holder.innerHTML = renderChartSvg(drawing.chart, box.width, box.height);
    }
    fragment.appendChild(holder);
  }
  container.appendChild(fragment);
}

function drawBorders(
  target: HTMLElement[],
  doc: Document,
  style: CellStyle,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const edges: Array<[keyof CellStyle["border"], number, number, number, number]> = [
    ["top", x, y, width, 0],
    ["bottom", x, y + height, width, 0],
    ["left", x, y, 0, height],
    ["right", x + width, y, 0, height],
  ];
  for (const [side, left, top, w, h] of edges) {
    const css = borderCss(style.border[side]);
    if (!css) continue;
    const line = doc.createElement("div");
    line.className = "xl-border";
    const horizontal = h === 0;
    const offset = Math.floor(css.width / 2);
    Object.assign(line.style, {
      left: `${left - (horizontal ? offset : offset)}px`,
      top: `${top - (horizontal ? offset : offset)}px`,
      width: horizontal ? `${w + css.width}px` : `${css.width}px`,
      height: horizontal ? `${css.width}px` : `${h + css.width}px`,
      [horizontal ? "borderTop" : "borderLeft"]: `${css.width}px ${css.style} ${css.color}`,
    });
    target.push(line);
  }
}

function drawText(
  doc: Document,
  sheet: Sheet,
  workbook: Workbook,
  metrics: Metrics,
  cell: Cell,
  style: CellStyle,
  x: number,
  y: number,
  width: number,
  height: number,
  merged: boolean,
  c1: number,
  c2: number,
  covered: Set<string>,
  X: (col: number) => number,
) {
  const formatted = formatCell(cell, style, workbook);
  if (!formatted.text && !cell.rich) return null;
  let horizontal = style.align.horizontal;
  if (horizontal === "general")
    horizontal = formatted.numeric
      ? "right"
      : cell.type === "b" || cell.type === "e"
        ? "center"
        : "left";
  if (horizontal === "fill" || horizontal === "distributed")
    horizontal = horizontal === "fill" ? "left" : "center";
  if (horizontal === "centerContinuous") horizontal = "center";
  const wrap = style.align.wrap || horizontal === "justify" || style.align.vertical === "justify";

  // Non-wrapped text may overflow into empty neighbouring cells.
  let left = x;
  let right = x + width;
  if (!wrap && !merged && !formatted.numeric && style.align.rotation === 0) {
    const empty = (col: number) => {
      const neighbour = sheet.cells.get(cell.row)?.get(col);
      return (
        !hasValue(neighbour) &&
        !covered.has(`${cell.row}:${col}`) &&
        !sheet.merges.some(
          (m) => m.r1 <= cell.row && m.r2 >= cell.row && m.c1 <= col && m.c2 >= col,
        )
      );
    };
    if (horizontal === "left" || horizontal === "center") {
      for (let col = cell.col + 1; col <= c2 && empty(col); col++) right = X(col + 1);
    }
    if (horizontal === "right" || horizontal === "center") {
      for (let col = cell.col - 1; col >= c1 && empty(col); col--) left = X(col);
    }
    if (horizontal === "center") {
      const reach = Math.min(x - left, right - (x + width));
      left = x - reach;
      right = x + width + reach;
    }
  }

  const box = doc.createElement("div");
  box.className = `xl-text ${wrap ? "xl-wrap" : "xl-nowrap"}`;
  Object.assign(box.style, {
    left: `${left}px`,
    top: `${y}px`,
    width: `${right - left}px`,
    height: `${height}px`,
  });
  const vertical = style.align.vertical;
  box.style.alignItems =
    vertical === "top"
      ? "flex-start"
      : vertical === "center" || vertical === "distributed"
        ? "center"
        : "flex-end";
  box.style.justifyContent =
    horizontal === "right" ? "flex-end" : horizontal === "center" ? "center" : "flex-start";
  box.style.textAlign =
    horizontal === "justify"
      ? "justify"
      : horizontal === "right"
        ? "right"
        : horizontal === "center"
          ? "center"
          : "left";
  applyFont(box.style, style.font);
  if (formatted.color) box.style.color = formatted.color;
  const indent = style.align.indent * 9;
  if (indent) {
    if (horizontal === "right") box.style.paddingRight = `${indent + 2}px`;
    else box.style.paddingLeft = `${indent + 2}px`;
  }

  const span = doc.createElement("span");
  if (cell.rich && !formatted.numeric) {
    for (const run of cell.rich) {
      const part = doc.createElement("span");
      applyFont(part.style, run.font);
      part.textContent = run.text;
      span.appendChild(part);
    }
  } else if (formatted.accounting) {
    span.style.display = "flex";
    span.style.justifyContent = "space-between";
    span.style.width = "100%";
    const symbol = doc.createElement("span");
    symbol.textContent = formatted.accounting[0];
    const amount = doc.createElement("span");
    amount.textContent = formatted.accounting[1];
    span.append(symbol, amount);
  } else {
    span.textContent = formatted.text;
  }
  if (formatted.numeric) {
    box.dataset["numeric"] = "1";
    span.style.whiteSpace = "pre";
  }

  const rotation = style.align.rotation;
  if (rotation === 255) {
    span.style.writingMode = "vertical-rl";
    span.style.textOrientation = "upright";
  } else if (rotation) {
    const degrees = rotation <= 90 ? -rotation : rotation - 90;
    span.style.whiteSpace = "pre";
    span.style.transform = `rotate(${degrees}deg)`;
    box.style.justifyContent = "center";
    box.style.alignItems = "center";
    box.style.overflow = "visible";
  }

  if (cell.link) {
    const anchor = doc.createElement("a");
    anchor.href = cell.link;
    anchor.appendChild(span);
    box.appendChild(anchor);
  } else box.appendChild(span);
  void metrics;
  return box;
}

/** Numbers that do not fit their column show as #### like Excel. */
function fixNumberOverflow(page: HTMLElement) {
  page.querySelectorAll<HTMLElement>('.xl-text[data-numeric="1"]').forEach((box) => {
    const span = box.querySelector<HTMLElement>(":scope > span, :scope > a > span");
    if (!span) return;
    const available = box.clientWidth - 4;
    if (span.scrollWidth <= available + 1 || available <= 0) return;
    const hashWidth = Math.max(4, span.scrollWidth / Math.max(1, (span.textContent ?? "#").length));
    span.textContent = "#".repeat(Math.max(1, Math.floor(available / hashWidth)));
    span.style.display = "block";
  });
}

function drawChartsheet(page: HTMLElement, item: SheetPage, options: ExcelOptions) {
  const drawing = item.sheet.drawings.find((entry) => entry.kind === "chart");
  if (!drawing || drawing.kind !== "chart") return;
  const m = item.sheet.setup.margins;
  const width = page.offsetWidth - (m.left + m.right) * DPI;
  const height = page.offsetHeight - (m.top + m.bottom) * DPI;
  const holder = page.ownerDocument.createElement("div");
  holder.className = "xl-drawing";
  Object.assign(holder.style, {
    left: `${m.left * DPI}px`,
    top: `${m.top * DPI}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
  holder.innerHTML = renderChartSvg(drawing.chart, width, height);
  page.appendChild(holder);
  void options;
}

/* ------------------------------------------------------------------ */
/* Headers and footers                                                 */
/* ------------------------------------------------------------------ */

function drawHeaderFooter(
  page: HTMLElement,
  item: SheetPage,
  pageNumber: number,
  total: number,
  fileName: string,
) {
  const setup = item.sheet.setup;
  const first = item.indexInSheet === 0;
  const even = pageNumber % 2 === 0;
  const header =
    first && setup.firstHeader !== null
      ? setup.firstHeader
      : even && setup.evenHeader !== null
        ? setup.evenHeader
        : setup.header;
  const footer =
    first && setup.firstFooter !== null
      ? setup.firstFooter
      : even && setup.evenFooter !== null
        ? setup.evenFooter
        : setup.footer;
  const number = (setup.firstPageNumber ?? 1) - 1 + pageNumber;
  const m = setup.margins;
  const place = (code: string, isHeader: boolean) => {
    if (!code) return;
    const sections = parseHeaderFooter(code, {
      page: number,
      pages: total,
      file: fileName,
      sheet: item.sheet.name,
    });
    if (sections.every((section) => !section.textContent)) return;
    const element = page.ownerDocument.createElement("div");
    element.className = "xl-hf";
    Object.assign(element.style, {
      left: `${m.left * DPI}px`,
      right: `${m.right * DPI}px`,
      [isHeader ? "top" : "bottom"]: `${(isHeader ? m.header : m.footer) * DPI}px`,
      fontFamily: officeFontStack("Calibri"),
      alignItems: isHeader ? "start" : "end",
    });
    sections.forEach((section) => element.appendChild(section));
    page.appendChild(element);
  };
  place(header, true);
  place(footer, false);
}

function parseHeaderFooter(
  code: string,
  values: { page: number; pages: number; file: string; sheet: string },
) {
  const doc = document;
  const sections: Record<"L" | "C" | "R", HTMLElement> = {
    L: doc.createElement("div"),
    C: doc.createElement("div"),
    R: doc.createElement("div"),
  };
  let current: "L" | "C" | "R" = "C";
  let bold = false;
  let italic = false;
  let underline = false;
  let size: number | null = null;
  let family: string | null = null;
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    const span = doc.createElement("span");
    span.textContent = buffer;
    if (bold) span.style.fontWeight = "700";
    if (italic) span.style.fontStyle = "italic";
    if (underline) span.style.textDecoration = "underline";
    if (size) span.style.fontSize = `${size}pt`;
    if (family) span.style.fontFamily = officeFontStack(family);
    sections[current].appendChild(span);
    buffer = "";
  };
  const now = new Date();
  for (let index = 0; index < code.length; index++) {
    const char = code[index]!;
    if (char !== "&") {
      buffer += char;
      continue;
    }
    const next = code[index + 1] ?? "";
    index++;
    switch (next) {
      case "L":
      case "C":
      case "R":
        flush();
        current = next;
        break;
      case "P":
        buffer += String(values.page);
        break;
      case "N":
        buffer += String(values.pages);
        break;
      case "D":
        buffer += now.toLocaleDateString();
        break;
      case "T":
        buffer += now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        break;
      case "F":
        buffer += values.file;
        break;
      case "A":
        buffer += values.sheet;
        break;
      case "Z":
        break;
      case "&":
        buffer += "&";
        break;
      case "B":
        flush();
        bold = !bold;
        break;
      case "I":
        flush();
        italic = !italic;
        break;
      case "U":
      case "E":
        flush();
        underline = !underline;
        break;
      case "G":
      case "S":
      case "X":
      case "Y":
      case "O":
      case "H":
        break;
      case '"': {
        const end = code.indexOf('"', index + 1);
        const spec = code.slice(index + 1, end < 0 ? undefined : end);
        flush();
        const [name, fontStyle] = spec.split(",");
        if (name && name !== "-") family = name;
        bold = /bold/i.test(fontStyle ?? "");
        italic = /italic/i.test(fontStyle ?? "");
        index = end < 0 ? code.length : end;
        break;
      }
      default: {
        const digits = /^\d+/.exec(code.slice(index));
        if (digits) {
          flush();
          size = Number(digits[0]);
          index += digits[0].length - 1;
        } else if (next === "K") {
          index += 6; // &Kxxxxxx color codes are ignored.
        } else buffer += next;
      }
    }
  }
  flush();
  return [sections.L, sections.C, sections.R];
}
