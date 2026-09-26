/** Small namespace-agnostic helpers for reading Office Open XML parts. */

export function parseXml(text: string) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.getElementsByTagName("parsererror").length) return null;
  return xml;
}

export function children(element: Element | null | undefined, name?: string): Element[] {
  if (!element) return [];
  return [...element.children].filter((child) => !name || child.localName === name);
}

export function child(element: Element | null | undefined, name: string): Element | undefined {
  if (!element) return undefined;
  for (const item of element.children) if (item.localName === name) return item;
  return undefined;
}

/** Follows a path of local names, e.g. path(chart, "plotArea", "barChart"). */
export function path(element: Element | null | undefined, ...names: string[]) {
  let current: Element | undefined = element ?? undefined;
  for (const name of names) {
    current = child(current, name);
    if (!current) return undefined;
  }
  return current;
}

export function descendants(
  element: Element | Document | null | undefined,
  name: string,
): Element[] {
  if (!element) return [];
  return [...element.getElementsByTagName("*")].filter((item) => item.localName === name);
}

export function attr(element: Element | null | undefined, name: string) {
  if (!element) return null;
  if (element.hasAttribute(name)) return element.getAttribute(name);
  for (const attribute of element.attributes)
    if (attribute.localName === name) return attribute.value;
  return null;
}

const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Reads a relationship id attribute (r:id / r:embed), which may coexist with a plain "id". */
export function relId(element: Element | null | undefined, name = "id") {
  if (!element) return null;
  return (
    element.getAttributeNS(R_NS, name) ?? element.getAttribute(`r:${name}`) ?? attr(element, name)
  );
}

export function valAttr(element: Element | null | undefined) {
  return attr(element, "val");
}

/** Resolves a relationship target relative to the part that owns the .rels file. */
export function resolveTarget(basePart: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = basePart.split("/");
  parts.pop();
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment && segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

export function relsPath(part: string) {
  const parts = part.split("/");
  const file = parts.pop();
  return [...parts, "_rels", `${file}.rels`].join("/");
}

export function parseRels(xml: XMLDocument | null, basePart: string) {
  const map = new Map<string, { target: string; type: string; external: boolean }>();
  if (!xml) return map;
  for (const rel of descendants(xml, "Relationship")) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    if (!id || !target) continue;
    const external = attr(rel, "TargetMode") === "External";
    map.set(id, {
      target: external ? target : resolveTarget(basePart, target),
      type: attr(rel, "Type") ?? "",
      external,
    });
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Colors                                                              */
/* ------------------------------------------------------------------ */

export type Theme = {
  colors: Record<string, string>;
  majorFont: string;
  minorFont: string;
};

export const DEFAULT_THEME: Theme = {
  colors: {
    dk1: "000000",
    lt1: "FFFFFF",
    dk2: "44546A",
    lt2: "E7E6E6",
    accent1: "4472C4",
    accent2: "ED7D31",
    accent3: "A5A5A5",
    accent4: "FFC000",
    accent5: "5B9BD5",
    accent6: "70AD47",
    hlink: "0563C1",
    folHlink: "954F72",
  },
  majorFont: "Calibri Light",
  minorFont: "Calibri",
};

export function parseTheme(xml: XMLDocument | null): Theme {
  if (!xml) return DEFAULT_THEME;
  const colors: Record<string, string> = { ...DEFAULT_THEME.colors };
  const scheme = descendants(xml, "clrScheme")[0];
  for (const entry of children(scheme)) {
    const value = child(entry, "srgbClr");
    const system = child(entry, "sysClr");
    const hex = attr(value, "val") ?? attr(system, "lastClr");
    if (hex) colors[entry.localName] = hex.toUpperCase();
  }
  const fontScheme = descendants(xml, "fontScheme")[0];
  const majorFont =
    attr(path(fontScheme, "majorFont", "latin"), "typeface") || DEFAULT_THEME.majorFont;
  const minorFont =
    attr(path(fontScheme, "minorFont", "latin"), "typeface") || DEFAULT_THEME.minorFont;
  return { colors, majorFont, minorFont };
}

function hexToRgb(hex: string) {
  const clean = hex.replace(/^#/, "").slice(-6).padStart(6, "0");
  return [0, 2, 4].map((offset) => Number.parseInt(clean.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function rgbToHex([r, g, b]: [number, number, number]) {
  return [r, g, b]
    .map((value) =>
      Math.round(Math.max(0, Math.min(1, value)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();
}

export function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l, l, l];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
}

/** Excel's tint: -1 darkens to black, +1 lightens to white (applied to luminance). */
export function applyTint(hex: string, tint: number) {
  if (!tint) return hex;
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const next = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  return rgbToHex(hslToRgb([h, s, next]));
}

function toLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toGamma(c: number) {
  const value = Math.max(0, Math.min(1, c));
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

/** Applies DrawingML color transforms (lumMod, lumOff, tint, shade, alpha is ignored). */
export function applyColorTransforms(hex: string, node: Element | undefined) {
  if (!node) return hex;
  let rgb = hexToRgb(hex);
  for (const transform of children(node)) {
    const value = Number(valAttr(transform) ?? "0") / 100000;
    switch (transform.localName) {
      case "lumMod": {
        const [h, s, l] = rgbToHsl(rgb);
        rgb = hslToRgb([h, s, Math.min(1, l * value)]);
        break;
      }
      case "lumOff": {
        const [h, s, l] = rgbToHsl(rgb);
        rgb = hslToRgb([h, s, Math.min(1, Math.max(0, l + value))]);
        break;
      }
      case "tint":
        // DrawingML tint/shade operate on linear (gamma-expanded) RGB.
        rgb = rgb.map((c) => toGamma(toLinear(c) * value + (1 - value))) as [
          number,
          number,
          number,
        ];
        break;
      case "shade":
        rgb = rgb.map((c) => toGamma(toLinear(c) * value)) as [number, number, number];
        break;
      default:
        break;
    }
  }
  return rgbToHex(rgb);
}

/** Reads a DrawingML color choice element (solidFill, fgClr...) into "#RRGGBB". */
export function drawingColor(container: Element | undefined, theme: Theme): string | null {
  if (!container) return null;
  for (const choice of children(container)) {
    let base: string | null = null;
    switch (choice.localName) {
      case "srgbClr":
        base = valAttr(choice);
        break;
      case "schemeClr": {
        const key = valAttr(choice) ?? "";
        const mapped =
          key === "tx1"
            ? "dk1"
            : key === "bg1"
              ? "lt1"
              : key === "tx2"
                ? "dk2"
                : key === "bg2"
                  ? "lt2"
                  : key;
        base = theme.colors[mapped] ?? null;
        break;
      }
      case "sysClr":
        base = attr(choice, "lastClr") ?? (valAttr(choice) === "window" ? "FFFFFF" : "000000");
        break;
      case "prstClr":
        base = PRESET_COLORS[valAttr(choice) ?? ""] ?? null;
        break;
      case "scrgbClr":
        base = rgbToHex([
          Number(attr(choice, "r") ?? 0) / 100000,
          Number(attr(choice, "g") ?? 0) / 100000,
          Number(attr(choice, "b") ?? 0) / 100000,
        ]);
        break;
      default:
        continue;
    }
    if (base) return `#${applyColorTransforms(base, choice)}`;
  }
  return null;
}

const PRESET_COLORS: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  gray: "808080",
  grey: "808080",
  orange: "FFA500",
  purple: "800080",
  darkBlue: "00008B",
  darkRed: "8B0000",
  darkGreen: "006400",
  lightGray: "D3D3D3",
  navy: "000080",
};

export function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
