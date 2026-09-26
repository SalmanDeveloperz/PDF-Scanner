import JSZip from "jszip";
import { OfficeError } from "./common";
import { parseChartXml, type ChartModel } from "./charts";
import {
  applyTint,
  attr,
  relId,
  child,
  children,
  descendants,
  parseRels,
  parseTheme,
  parseXml,
  path,
  relsPath,
  valAttr,
  DEFAULT_THEME,
  type Theme,
} from "./ooxml";

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export type BorderEdge = { style: string; color: string } | null;

export type CellStyle = {
  font: {
    name: string;
    size: number;
    bold: boolean;
    italic: boolean;
    underline: "none" | "single" | "double";
    strike: boolean;
    color: string;
    vertAlign: "baseline" | "superscript" | "subscript";
  };
  fill: string | null;
  border: { left: BorderEdge; right: BorderEdge; top: BorderEdge; bottom: BorderEdge };
  align: {
    horizontal: string;
    vertical: string;
    wrap: boolean;
    shrink: boolean;
    indent: number;
    rotation: number;
  };
  numFmt: string;
};

export type RichRun = { text: string; font: Partial<CellStyle["font"]> };

export type CellValue = number | string | boolean | null;

export type Cell = {
  row: number;
  col: number;
  type: "n" | "s" | "b" | "e" | "d";
  value: CellValue;
  rich: RichRun[] | null;
  style: number;
  link: string | null;
};

export type Anchor = {
  from: { col: number; colOff: number; row: number; rowOff: number };
  to: { col: number; colOff: number; row: number; rowOff: number } | null;
  ext: { width: number; height: number } | null;
  absolute: { x: number; y: number } | null;
};

export type Drawing =
  | { kind: "image"; anchor: Anchor; src: string }
  | { kind: "chart"; anchor: Anchor; chart: ChartModel };

export type PageSetup = {
  paperSize: number;
  orientation: "portrait" | "landscape" | "default";
  scale: number;
  fitToPage: boolean;
  fitToWidth: number;
  fitToHeight: number;
  pageOrder: "downThenOver" | "overThenDown";
  firstPageNumber: number | null;
  margins: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    header: number;
    footer: number;
  };
  horizontalCentered: boolean;
  verticalCentered: boolean;
  gridLines: boolean;
  headings: boolean;
  header: string;
  footer: string;
  firstHeader: string | null;
  firstFooter: string | null;
  evenHeader: string | null;
  evenFooter: string | null;
};

export type Range = { r1: number; c1: number; r2: number; c2: number };

export type Sheet = {
  name: string;
  kind: "worksheet" | "chartsheet";
  hidden: boolean;
  cells: Map<number, Map<number, Cell>>;
  colWidths: Map<number, { width: number; hidden: boolean; style: number | null }>;
  rows: Map<number, { height: number | null; hidden: boolean; custom: boolean }>;
  defaultColWidth: number;
  defaultRowHeight: number;
  merges: Range[];
  drawings: Drawing[];
  setup: PageSetup;
  printAreas: Range[] | null;
  titleRows: [number, number] | null;
  titleCols: [number, number] | null;
  rowBreaks: Set<number>;
  colBreaks: Set<number>;
  showGridLines: boolean;
  rightToLeft: boolean;
  emptyFormulas: boolean;
};

export type Workbook = {
  sheets: Sheet[];
  styles: CellStyle[];
  defaultStyle: CellStyle;
  date1904: boolean;
  activeTab: number;
  theme: Theme;
  maxDigitWidth: number;
};

/* ------------------------------------------------------------------ */
/* Colors                                                              */
/* ------------------------------------------------------------------ */

const INDEXED_COLORS = [
  "000000",
  "FFFFFF",
  "FF0000",
  "00FF00",
  "0000FF",
  "FFFF00",
  "FF00FF",
  "00FFFF",
  "000000",
  "FFFFFF",
  "FF0000",
  "00FF00",
  "0000FF",
  "FFFF00",
  "FF00FF",
  "00FFFF",
  "800000",
  "008000",
  "000080",
  "808000",
  "800080",
  "008080",
  "C0C0C0",
  "808080",
  "9999FF",
  "993366",
  "FFFFCC",
  "CCFFFF",
  "660066",
  "FF8080",
  "0066CC",
  "CCCCFF",
  "000080",
  "FF00FF",
  "FFFF00",
  "00FFFF",
  "800080",
  "800000",
  "008080",
  "0000FF",
  "00CCFF",
  "CCFFFF",
  "CCFFCC",
  "FFFF99",
  "99CCFF",
  "FF99CC",
  "CC99FF",
  "FFCC99",
  "3366FF",
  "33CCCC",
  "99CC00",
  "FFCC00",
  "FF9900",
  "FF6600",
  "666699",
  "969696",
  "003366",
  "339966",
  "003300",
  "333300",
  "993300",
  "993366",
  "333399",
  "333333",
];

// Excel maps theme indexes 0-3 with light/dark swapped relative to the clrScheme order.
const THEME_ORDER = [
  "lt1",
  "dk1",
  "lt2",
  "dk2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
];

function makeColorReader(theme: Theme, indexed: string[]) {
  return (node: Element | undefined, fallback: string | null): string | null => {
    if (!node) return fallback;
    if (attr(node, "auto") === "1" || attr(node, "auto") === "true") return fallback;
    let hex: string | null = null;
    const rgb = attr(node, "rgb");
    const themeIndex = attr(node, "theme");
    const index = attr(node, "indexed");
    if (rgb) hex = rgb.length === 8 ? rgb.slice(2) : rgb;
    else if (themeIndex !== null) hex = theme.colors[THEME_ORDER[Number(themeIndex)] ?? ""] ?? null;
    else if (index !== null) {
      const i = Number(index);
      if (i === 64) return fallback ?? "#000000";
      if (i === 65) return fallback;
      hex = indexed[i] ?? null;
    }
    if (!hex) return fallback;
    const tint = Number(attr(node, "tint") ?? 0);
    return `#${applyTint(hex.toUpperCase(), tint)}`;
  };
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const BUILTIN_FORMATS: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yyyy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
  5: '"$"#,##0_);\\("$"#,##0\\)',
  6: '"$"#,##0_);[Red]\\("$"#,##0\\)',
  7: '"$"#,##0.00_);\\("$"#,##0.00\\)',
  8: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)',
  42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  44: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
};

type FontStyle = CellStyle["font"];

function parseFont(
  node: Element | undefined,
  readColor: ReturnType<typeof makeColorReader>,
  base: FontStyle,
): FontStyle {
  if (!node) return base;
  const has = (name: string) => {
    const element = child(node, name);
    if (!element) return false;
    const value = valAttr(element);
    return value === null || !/^(0|false)$/i.test(value);
  };
  const underline = child(node, "u");
  const underlineValue = underline ? (valAttr(underline) ?? "single") : "none";
  const vert = valAttr(child(node, "vertAlign"));
  return {
    name: valAttr(child(node, "name")) ?? valAttr(child(node, "rFont")) ?? base.name,
    size: Number(valAttr(child(node, "sz")) ?? base.size) || base.size,
    bold: has("b"),
    italic: has("i"),
    strike: has("strike"),
    underline:
      underlineValue === "none" ? "none" : /double/.test(underlineValue) ? "double" : "single",
    color: readColor(child(node, "color"), base.color) ?? base.color,
    vertAlign:
      vert === "superscript" ? "superscript" : vert === "subscript" ? "subscript" : "baseline",
  };
}

function parseStyles(xml: XMLDocument | null, theme: Theme) {
  const root = xml?.documentElement;
  const customIndexed = descendants(path(root, "colors", "indexedColors"), "rgbColor").map((node) =>
    (attr(node, "rgb") ?? "000000").slice(-6),
  );
  const indexed = customIndexed.length ? customIndexed : INDEXED_COLORS;
  const readColor = makeColorReader(theme, indexed);
  const baseFont: FontStyle = {
    name: theme.minorFont || "Calibri",
    size: 11,
    bold: false,
    italic: false,
    underline: "none",
    strike: false,
    color: "#000000",
    vertAlign: "baseline",
  };
  const fontNodes = children(child(root, "fonts"), "font");
  const fonts = fontNodes.map((node) => parseFont(node, readColor, baseFont));
  const defaultFont = fonts[0] ?? baseFont;
  const minorName = (name: string) => name;
  fonts.forEach((font, index) => {
    const scheme = valAttr(child(fontNodes[index], "scheme"));
    if (scheme === "minor") font.name = minorName(theme.minorFont || font.name);
    if (scheme === "major") font.name = theme.majorFont || font.name;
  });

  const fills = children(child(root, "fills"), "fill").map((node) => {
    const pattern = child(node, "patternFill");
    if (pattern) {
      const type = attr(pattern, "patternType") ?? (child(pattern, "fgColor") ? "solid" : "none");
      if (type === "none") return null;
      const fg = readColor(child(pattern, "fgColor"), type === "solid" ? null : "#000000");
      const bg = readColor(child(pattern, "bgColor"), "#FFFFFF");
      if (type === "solid") return fg ?? bg;
      // Approximate pattern fills with a blend of foreground and background.
      const density: Record<string, number> = {
        gray125: 0.125,
        gray0625: 0.0625,
        lightGray: 0.25,
        mediumGray: 0.5,
        darkGray: 0.75,
      };
      return blend(fg ?? "#000000", bg ?? "#FFFFFF", density[type] ?? 0.5);
    }
    const gradient = child(node, "gradientFill");
    if (gradient) {
      const stops = children(gradient, "stop")
        .map((stop) => readColor(child(stop, "color"), null))
        .filter(Boolean) as string[];
      if (stops.length)
        return stops.length > 1 ? blend(stops[0]!, stops[stops.length - 1]!, 0.5) : stops[0]!;
    }
    return null;
  });

  const edge = (node: Element | undefined): BorderEdge => {
    const style = attr(node, "style");
    if (!node || !style || style === "none") return null;
    return { style, color: readColor(child(node, "color"), "#000000") ?? "#000000" };
  };
  const borders = children(child(root, "borders"), "border").map((node) => ({
    left: edge(child(node, "left") ?? child(node, "start")),
    right: edge(child(node, "right") ?? child(node, "end")),
    top: edge(child(node, "top")),
    bottom: edge(child(node, "bottom")),
  }));

  const numFmts = new Map<number, string>();
  for (const node of children(child(root, "numFmts"), "numFmt")) {
    numFmts.set(Number(attr(node, "numFmtId")), attr(node, "formatCode") ?? "General");
  }
  const formatFor = (id: number) => numFmts.get(id) ?? BUILTIN_FORMATS[id] ?? "General";

  const emptyBorder = { left: null, right: null, top: null, bottom: null };
  const makeStyle = (node: Element | undefined): CellStyle => {
    const alignment = child(node, "alignment");
    const fontId = Number(attr(node, "fontId") ?? 0);
    const fillId = Number(attr(node, "fillId") ?? 0);
    const borderId = Number(attr(node, "borderId") ?? 0);
    const numFmtId = Number(attr(node, "numFmtId") ?? 0);
    return {
      font: { ...(fonts[fontId] ?? defaultFont) },
      fill: fills[fillId] ?? null,
      border: borders[borderId] ?? emptyBorder,
      align: {
        horizontal: attr(alignment, "horizontal") ?? "general",
        vertical: attr(alignment, "vertical") ?? "bottom",
        wrap: attr(alignment, "wrapText") === "1" || attr(alignment, "wrapText") === "true",
        shrink: attr(alignment, "shrinkToFit") === "1" || attr(alignment, "shrinkToFit") === "true",
        indent: Number(attr(alignment, "indent") ?? 0),
        rotation: Number(attr(alignment, "textRotation") ?? 0),
      },
      numFmt: formatFor(numFmtId),
    };
  };
  const styles = children(child(root, "cellXfs"), "xf").map((node) => makeStyle(node));
  const defaultStyle = styles[0] ?? makeStyle(undefined);
  return { styles: styles.length ? styles : [defaultStyle], defaultStyle, readColor };
}

function blend(fg: string, bg: string, amount: number) {
  const parse = (hex: string) =>
    [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const a = parse(fg);
  const b = parse(bg);
  return `#${a
    .map((value, index) =>
      Math.round(value * amount + b[index]! * (1 - amount))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/* ------------------------------------------------------------------ */
/* References                                                          */
/* ------------------------------------------------------------------ */

export function colIndex(letters: string) {
  let value = 0;
  for (const char of letters.toUpperCase()) value = value * 26 + (char.charCodeAt(0) - 64);
  return value;
}

function parseRef(ref: string): { row: number; col: number } | null {
  const match = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref.trim());
  if (!match) return null;
  return { col: colIndex(match[1]!), row: Number(match[2]) };
}

export function parseRange(text: string): Range | null {
  const clean = text.replace(/^.*!/, "").replace(/'/g, "").trim();
  const [a, b] = clean.split(":");
  if (!a) return null;
  const start = parseRef(a);
  const end = b ? parseRef(b) : start;
  if (start && end) {
    return {
      r1: Math.min(start.row, end.row),
      c1: Math.min(start.col, end.col),
      r2: Math.max(start.row, end.row),
      c2: Math.max(start.col, end.col),
    };
  }
  // Whole rows ($1:$2) or whole columns ($A:$B).
  const rows = /^\$?(\d+):\$?(\d+)$/.exec(clean);
  if (rows) return { r1: Number(rows[1]), r2: Number(rows[2]), c1: 1, c2: 16384 };
  const cols = /^\$?([A-Z]{1,3}):\$?([A-Z]{1,3})$/i.exec(clean);
  if (cols) return { c1: colIndex(cols[1]!), c2: colIndex(cols[2]!), r1: 1, r2: 1048576 };
  return null;
}

/** Splits a defined-name formula on commas that are outside quotes. */
function splitAreas(formula: string) {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of formula) {
    if (char === "'") quoted = !quoted;
    if (char === "," && !quoted) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (current) parts.push(current);
  return parts;
}

/* ------------------------------------------------------------------ */
/* Workbook loading                                                    */
/* ------------------------------------------------------------------ */

const DEFAULT_SETUP: PageSetup = {
  paperSize: 1,
  orientation: "default",
  scale: 100,
  fitToPage: false,
  fitToWidth: 1,
  fitToHeight: 1,
  pageOrder: "downThenOver",
  firstPageNumber: null,
  margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  horizontalCentered: false,
  verticalCentered: false,
  gridLines: false,
  headings: false,
  header: "",
  footer: "",
  firstHeader: null,
  firstFooter: null,
  evenHeader: null,
  evenFooter: null,
};

function richRuns(
  node: Element,
  readColor: ReturnType<typeof makeColorReader>,
  base: FontStyle,
): RichRun[] | null {
  const runs = children(node, "r");
  if (!runs.length) return null;
  return runs.map((run) => {
    const rPr = child(run, "rPr");
    const font = rPr ? parseFont(rPr, readColor, base) : {};
    return { text: child(run, "t")?.textContent ?? "", font };
  });
}

function plainText(node: Element) {
  const t = child(node, "t");
  if (t) return t.textContent ?? "";
  return children(node, "r")
    .map((run) => child(run, "t")?.textContent ?? "")
    .join("");
}

export async function loadWorkbook(input: ArrayBuffer): Promise<Workbook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw new OfficeError("damaged-file");
  }
  const read = async (name: string) => {
    const file = zip.file(name);
    return file ? parseXml(await file.async("string")) : null;
  };
  const readBase64 = async (name: string) => {
    const file = zip.file(name);
    return file ? file.async("base64") : null;
  };

  const workbookXml = await read("xl/workbook.xml");
  if (!workbookXml) {
    if (zip.file("EncryptedPackage")) throw new OfficeError("encrypted");
    if (zip.file("xl/workbook.bin")) throw new OfficeError("legacy-format");
    throw new OfficeError("damaged-file");
  }
  const workbookRels = parseRels(await read("xl/_rels/workbook.xml.rels"), "xl/workbook.xml");
  let themePart: string | null = null;
  for (const rel of workbookRels.values()) if (/\/theme$/.test(rel.type)) themePart = rel.target;
  const theme = themePart ? parseTheme(await read(themePart)) : DEFAULT_THEME;
  const stylesXml = await read("xl/styles.xml");
  const { styles, defaultStyle, readColor } = parseStyles(stylesXml, theme);

  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = children(sharedXml?.documentElement, "si").map((si) => ({
    text: plainText(si),
    rich: richRuns(si, readColor, defaultStyle.font),
  }));

  const root = workbookXml.documentElement;
  const date1904 = ["1", "true"].includes(attr(child(root, "workbookPr"), "date1904") ?? "");
  const activeTab = Number(attr(path(root, "bookViews", "workbookView"), "activeTab") ?? 0);
  const sheetNodes = children(child(root, "sheets"), "sheet");
  const definedNames = children(child(root, "definedNames"), "definedName");

  const sheets: Sheet[] = [];
  for (let index = 0; index < sheetNodes.length; index++) {
    const node = sheetNodes[index]!;
    const name = attr(node, "name") ?? `Sheet${index + 1}`;
    const rel = workbookRels.get(relId(node) ?? "");
    if (!rel) continue;
    const state = attr(node, "state") ?? "visible";
    const isChartsheet = /chartsheet$/.test(rel.type);
    const sheet: Sheet = {
      name,
      kind: isChartsheet ? "chartsheet" : "worksheet",
      hidden: state !== "visible",
      cells: new Map(),
      colWidths: new Map(),
      rows: new Map(),
      defaultColWidth: 9.140625,
      defaultRowHeight: 15,
      merges: [],
      drawings: [],
      setup: structuredClone(DEFAULT_SETUP),
      printAreas: null,
      titleRows: null,
      titleCols: null,
      rowBreaks: new Set(),
      colBreaks: new Set(),
      showGridLines: true,
      rightToLeft: false,
      emptyFormulas: false,
    };
    for (const defined of definedNames) {
      const localId = attr(defined, "localSheetId");
      if (localId === null || Number(localId) !== index) continue;
      const definedName = attr(defined, "name");
      const formula = defined.textContent ?? "";
      if (definedName === "_xlnm.Print_Area") {
        sheet.printAreas = splitAreas(formula)
          .map(parseRange)
          .filter((range): range is Range => range !== null);
      } else if (definedName === "_xlnm.Print_Titles") {
        for (const part of splitAreas(formula)) {
          const range = parseRange(part);
          if (!range) continue;
          if (range.c1 === 1 && range.c2 === 16384) sheet.titleRows = [range.r1, range.r2];
          else if (range.r1 === 1 && range.r2 === 1048576) sheet.titleCols = [range.c1, range.c2];
        }
      }
    }
    const xml = await read(rel.target);
    if (!xml) continue;
    const ws = xml.documentElement;
    parsePageSettings(ws, sheet);
    if (!isChartsheet) parseWorksheet(ws, sheet, shared, styles);
    const sheetRels = parseRels(await read(relsPath(rel.target)), rel.target);
    if (!isChartsheet) {
      for (const link of children(child(ws, "hyperlinks"), "hyperlink")) {
        const target = sheetRels.get(relId(link) ?? "");
        const range = parseRange(attr(link, "ref") ?? "");
        if (!target?.external || !range) continue;
        const cell = sheet.cells.get(range.r1)?.get(range.c1);
        if (cell && /^(https?:|mailto:)/i.test(target.target)) cell.link = target.target;
      }
    }
    const drawingRef = child(ws, "drawing");
    const drawingRel = drawingRef ? sheetRels.get(relId(drawingRef) ?? "") : undefined;
    if (drawingRel) {
      sheet.drawings = await parseDrawing(drawingRel.target, read, readBase64, theme);
    }
    sheets.push(sheet);
  }
  return {
    sheets,
    styles,
    defaultStyle,
    date1904,
    activeTab,
    theme,
    maxDigitWidth: maxDigitWidth(defaultStyle.font),
  };
}

/** Approximate maximum digit width in pixels for the workbook's default font, which sets column widths. */
function maxDigitWidth(font: FontStyle) {
  const size = font.size || 11;
  const name = font.name.toLowerCase();
  const ratio = /arial|helvetica|liberation sans|arimo/.test(name)
    ? 0.556
    : /verdana|tahoma/.test(name)
      ? 0.636
      : /times|cambria|georgia|serif/.test(name)
        ? 0.5
        : /courier|consolas|mono/.test(name)
          ? 0.6
          : 0.507; // Calibri / Aptos family
  return Math.max(5, Math.round(size * (96 / 72) * ratio));
}

function parsePageSettings(ws: Element, sheet: Sheet) {
  const setup = sheet.setup;
  const pageSetup = child(ws, "pageSetup");
  if (pageSetup) {
    setup.paperSize = Number(attr(pageSetup, "paperSize") ?? 1) || 1;
    const orientation = attr(pageSetup, "orientation");
    setup.orientation =
      orientation === "landscape"
        ? "landscape"
        : orientation === "portrait"
          ? "portrait"
          : "default";
    setup.scale = Number(attr(pageSetup, "scale") ?? 100) || 100;
    setup.fitToWidth = Number(attr(pageSetup, "fitToWidth") ?? 1);
    setup.fitToHeight = Number(attr(pageSetup, "fitToHeight") ?? 1);
    setup.pageOrder =
      attr(pageSetup, "pageOrder") === "overThenDown" ? "overThenDown" : "downThenOver";
    const useFirst = attr(pageSetup, "useFirstPageNumber");
    if (useFirst === "1" || useFirst === "true")
      setup.firstPageNumber = Number(attr(pageSetup, "firstPageNumber") ?? 1);
  }
  const fit = attr(path(ws, "sheetPr", "pageSetUpPr"), "fitToPage");
  setup.fitToPage = fit === "1" || fit === "true";
  const margins = child(ws, "pageMargins");
  if (margins) {
    for (const key of ["left", "right", "top", "bottom", "header", "footer"] as const) {
      const value = Number(attr(margins, key));
      if (Number.isFinite(value) && attr(margins, key) !== null) setup.margins[key] = value;
    }
  }
  const printOptions = child(ws, "printOptions");
  const flag = (name: string) => ["1", "true"].includes(attr(printOptions, name) ?? "");
  setup.horizontalCentered = flag("horizontalCentered");
  setup.verticalCentered = flag("verticalCentered");
  setup.gridLines = flag("gridLines");
  setup.headings = flag("headings");
  const headerFooter = child(ws, "headerFooter");
  if (headerFooter) {
    setup.header = child(headerFooter, "oddHeader")?.textContent ?? "";
    setup.footer = child(headerFooter, "oddFooter")?.textContent ?? "";
    if (["1", "true"].includes(attr(headerFooter, "differentFirst") ?? "")) {
      setup.firstHeader = child(headerFooter, "firstHeader")?.textContent ?? "";
      setup.firstFooter = child(headerFooter, "firstFooter")?.textContent ?? "";
    }
    if (["1", "true"].includes(attr(headerFooter, "differentOddEven") ?? "")) {
      setup.evenHeader = child(headerFooter, "evenHeader")?.textContent ?? "";
      setup.evenFooter = child(headerFooter, "evenFooter")?.textContent ?? "";
    }
  }
  const view = path(ws, "sheetViews", "sheetView");
  if (view) {
    sheet.showGridLines = !["0", "false"].includes(attr(view, "showGridLines") ?? "1");
    sheet.rightToLeft = ["1", "true"].includes(attr(view, "rightToLeft") ?? "");
  }
  for (const brk of children(child(ws, "rowBreaks"), "brk"))
    sheet.rowBreaks.add(Number(attr(brk, "id") ?? 0));
  for (const brk of children(child(ws, "colBreaks"), "brk"))
    sheet.colBreaks.add(Number(attr(brk, "id") ?? 0));
}

function parseWorksheet(
  ws: Element,
  sheet: Sheet,
  shared: Array<{ text: string; rich: RichRun[] | null }>,
  styles: CellStyle[],
) {
  const format = child(ws, "sheetFormatPr");
  if (format) {
    const width = Number(attr(format, "defaultColWidth"));
    const baseWidth = Number(attr(format, "baseColWidth"));
    if (width > 0) sheet.defaultColWidth = width;
    else if (baseWidth > 0) sheet.defaultColWidth = baseWidth + 1.14;
    const height = Number(attr(format, "defaultRowHeight"));
    if (height > 0) sheet.defaultRowHeight = height;
  }
  for (const col of children(child(ws, "cols"), "col")) {
    const min = Number(attr(col, "min") ?? 0);
    const max = Math.min(Number(attr(col, "max") ?? min), 16384);
    const width = Number(attr(col, "width") ?? sheet.defaultColWidth);
    const hidden = ["1", "true"].includes(attr(col, "hidden") ?? "");
    const style = attr(col, "style");
    // Very wide <col> spans (whole-sheet formatting) are stored once per column up to a sane limit.
    for (let index = min; index <= Math.min(max, min + 2000); index++) {
      sheet.colWidths.set(index, { width, hidden, style: style === null ? null : Number(style) });
    }
  }
  const data = child(ws, "sheetData");
  let rowCursor = 0;
  for (const rowNode of children(data, "row")) {
    const rowIndex = Number(attr(rowNode, "r") ?? rowCursor + 1);
    rowCursor = rowIndex;
    const ht = attr(rowNode, "ht");
    const hidden = ["1", "true"].includes(attr(rowNode, "hidden") ?? "");
    const custom = ["1", "true"].includes(attr(rowNode, "customHeight") ?? "");
    if (ht !== null || hidden)
      sheet.rows.set(rowIndex, { height: ht === null ? null : Number(ht), hidden, custom });
    const rowStyle = ["1", "true"].includes(attr(rowNode, "customFormat") ?? "")
      ? Number(attr(rowNode, "s") ?? 0)
      : null;
    let colCursor = 0;
    const rowCells = new Map<number, Cell>();
    for (const c of children(rowNode, "c")) {
      const ref = attr(c, "r");
      const parsed = ref ? parseRef(ref) : null;
      const col = parsed?.col ?? colCursor + 1;
      colCursor = col;
      const type = attr(c, "t") ?? "n";
      const styleIndex = Number(attr(c, "s") ?? rowStyle ?? sheet.colWidths.get(col)?.style ?? 0);
      const v = child(c, "v")?.textContent ?? null;
      if ((v === null || v === "") && child(c, "f")) sheet.emptyFormulas = true;
      let cell: Cell = {
        row: rowIndex,
        col,
        type: "n",
        value: null,
        rich: null,
        style: styleIndex,
        link: null,
      };
      switch (type) {
        case "s": {
          const entry = shared[Number(v)];
          cell = { ...cell, type: "s", value: entry?.text ?? "", rich: entry?.rich ?? null };
          break;
        }
        case "inlineStr": {
          const is = child(c, "is");
          cell = {
            ...cell,
            type: "s",
            value: is ? plainText(is) : "",
            rich: is
              ? richRuns(is, (n, f) => f, styles[styleIndex]?.font ?? styles[0]!.font)
              : null,
          };
          break;
        }
        case "str":
          cell = { ...cell, type: "s", value: v ?? "" };
          break;
        case "b":
          cell = { ...cell, type: "b", value: v === "1" };
          break;
        case "e":
          cell = { ...cell, type: "e", value: v ?? "#N/A" };
          break;
        case "d":
          cell = { ...cell, type: "d", value: v };
          break;
        default:
          cell = { ...cell, type: "n", value: v === null || v === "" ? null : Number(v) };
      }
      rowCells.set(col, cell);
    }
    if (rowCells.size) sheet.cells.set(rowIndex, rowCells);
  }
  for (const merge of children(child(ws, "mergeCells"), "mergeCell")) {
    const range = parseRange(attr(merge, "ref") ?? "");
    if (range) sheet.merges.push(range);
  }
}

const EMU_PER_PX = 9525;

function parseMarker(node: Element | undefined) {
  const num = (name: string) => Number(child(node, name)?.textContent ?? 0);
  return {
    col: num("col") + 1,
    colOff: num("colOff") / EMU_PER_PX,
    row: num("row") + 1,
    rowOff: num("rowOff") / EMU_PER_PX,
  };
}

async function parseDrawing(
  part: string,
  read: (name: string) => Promise<XMLDocument | null>,
  readBase64: (name: string) => Promise<string | null>,
  theme: Theme,
): Promise<Drawing[]> {
  const xml = await read(part);
  if (!xml) return [];
  const rels = parseRels(await read(relsPath(part)), part);
  const drawings: Drawing[] = [];
  for (const anchorNode of children(xml.documentElement)) {
    if (!/Anchor$/.test(anchorNode.localName)) continue;
    const ext = child(anchorNode, "ext");
    const pos = child(anchorNode, "pos");
    const anchor: Anchor = {
      from: parseMarker(child(anchorNode, "from")),
      to: child(anchorNode, "to") ? parseMarker(child(anchorNode, "to")) : null,
      ext: ext
        ? {
            width: Number(attr(ext, "cx") ?? 0) / EMU_PER_PX,
            height: Number(attr(ext, "cy") ?? 0) / EMU_PER_PX,
          }
        : null,
      absolute: pos
        ? {
            x: Number(attr(pos, "x") ?? 0) / EMU_PER_PX,
            y: Number(attr(pos, "y") ?? 0) / EMU_PER_PX,
          }
        : null,
    };
    // Pictures (possibly inside groups are ignored for simplicity).
    const blip = descendants(child(anchorNode, "pic"), "blip")[0];
    if (blip) {
      const rel = rels.get(relId(blip, "embed") ?? "");
      if (rel && !rel.external) {
        const data = await readBase64(rel.target);
        if (data)
          drawings.push({
            kind: "image",
            anchor,
            src: `data:${mimeFor(rel.target)};base64,${data}`,
          });
      }
      continue;
    }
    const chartRef = descendants(child(anchorNode, "graphicFrame"), "chart")[0];
    if (chartRef) {
      const rel = rels.get(relId(chartRef) ?? "");
      const chartXml = rel ? await read(rel.target) : null;
      const chart = chartXml ? parseChartXml(chartXml, theme, { border: true }) : null;
      if (chart) drawings.push({ kind: "chart", anchor, chart });
    }
  }
  return drawings;
}

export function mimeFor(name: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      bmp: "image/bmp",
      svg: "image/svg+xml",
      webp: "image/webp",
      tif: "image/tiff",
      tiff: "image/tiff",
      emf: "image/emf",
      wmf: "image/wmf",
    }[ext] ?? "application/octet-stream"
  );
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

export function parseCsv(text: string) {
  const rows: string[][] = [];
  const sample = text.slice(0, 5000);
  const delimiter = [",", ";", "\t", "|"]
    .map((candidate) => ({ candidate, count: sample.split(candidate).length }))
    .sort((a, b) => b.count - a.count)[0]!.candidate;
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvWorkbook(text: string, name: string, baseStyle: CellStyle): Workbook {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const sheet: Sheet = {
    name,
    kind: "worksheet",
    hidden: false,
    cells: new Map(),
    colWidths: new Map(),
    rows: new Map(),
    defaultColWidth: 9.140625,
    defaultRowHeight: 15,
    merges: [],
    drawings: [],
    setup: { ...structuredClone(DEFAULT_SETUP), gridLines: true },
    printAreas: null,
    titleRows: null,
    titleCols: null,
    rowBreaks: new Set(),
    colBreaks: new Set(),
    showGridLines: true,
    rightToLeft: false,
    emptyFormulas: false,
  };
  const widths = new Map<number, number>();
  rows.forEach((values, rowIndex) => {
    const rowCells = new Map<number, Cell>();
    values.forEach((raw, colIndexValue) => {
      if (raw === "") return;
      const col = colIndexValue + 1;
      const numeric =
        /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(raw.trim()) && raw.trim().length < 16;
      rowCells.set(col, {
        row: rowIndex + 1,
        col,
        type: numeric ? "n" : "s",
        value: numeric ? Number(raw) : raw,
        rich: null,
        style: 0,
        link: null,
      });
      const longest = Math.max(...raw.split(/\r?\n/).map((line) => line.length));
      widths.set(col, Math.max(widths.get(col) ?? 0, longest));
    });
    if (rowCells.size) sheet.cells.set(rowIndex + 1, rowCells);
  });
  widths.forEach((chars, col) =>
    sheet.colWidths.set(col, {
      width: Math.min(60, Math.max(9.14, chars * 1.1 + 1.8)),
      hidden: false,
      style: null,
    }),
  );
  return {
    sheets: [sheet],
    styles: [baseStyle],
    defaultStyle: baseStyle,
    date1904: false,
    activeTab: 0,
    theme: DEFAULT_THEME,
    maxDigitWidth: 7,
  };
}

export function defaultCellStyle(): CellStyle {
  return {
    font: {
      name: "Calibri",
      size: 11,
      bold: false,
      italic: false,
      underline: "none",
      strike: false,
      color: "#000000",
      vertAlign: "baseline",
    },
    fill: null,
    border: { left: null, right: null, top: null, bottom: null },
    align: {
      horizontal: "general",
      vertical: "bottom",
      wrap: false,
      shrink: false,
      indent: 0,
      rotation: 0,
    },
    numFmt: "General",
  };
}
