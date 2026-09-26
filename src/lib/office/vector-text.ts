import type { PDFDocument, PDFFont } from "pdf-lib";
import carlitoRegular from "@/assets/fonts/office/Carlito-Regular.ttf?url";
import carlitoBold from "@/assets/fonts/office/Carlito-Bold.ttf?url";
import carlitoItalic from "@/assets/fonts/office/Carlito-Italic.ttf?url";
import carlitoBoldItalic from "@/assets/fonts/office/Carlito-BoldItalic.ttf?url";
import caladeaRegular from "@/assets/fonts/office/Caladea-Regular.ttf?url";
import caladeaBold from "@/assets/fonts/office/Caladea-Bold.ttf?url";
import caladeaItalic from "@/assets/fonts/office/Caladea-Italic.ttf?url";
import caladeaBoldItalic from "@/assets/fonts/office/Caladea-BoldItalic.ttf?url";
import sansRegular from "@/assets/fonts/office/LiberationSans-Regular.ttf?url";
import sansBold from "@/assets/fonts/office/LiberationSans-Bold.ttf?url";
import sansItalic from "@/assets/fonts/office/LiberationSans-Italic.ttf?url";
import sansBoldItalic from "@/assets/fonts/office/LiberationSans-BoldItalic.ttf?url";
import serifRegular from "@/assets/fonts/office/LiberationSerif-Regular.ttf?url";
import serifBold from "@/assets/fonts/office/LiberationSerif-Bold.ttf?url";
import serifItalic from "@/assets/fonts/office/LiberationSerif-Italic.ttf?url";
import serifBoldItalic from "@/assets/fonts/office/LiberationSerif-BoldItalic.ttf?url";
import monoRegular from "@/assets/fonts/office/LiberationMono-Regular.ttf?url";
import monoBold from "@/assets/fonts/office/LiberationMono-Bold.ttf?url";
import monoItalic from "@/assets/fonts/office/LiberationMono-Italic.ttf?url";
import monoBoldItalic from "@/assets/fonts/office/LiberationMono-BoldItalic.ttf?url";

/**
 * Decides which text can be written into the PDF as real vector text.
 *
 * Text is vectorized only when the browser rendered it with a font we can embed
 * with identical metrics (Calibri/Carlito, Cambria/Caladea, Arial, Times New
 * Roman, Courier New and their open equivalents). Everything else - other
 * installed fonts, complex scripts, rotated or effect-styled text - stays in the
 * page image, so the output always matches what the browser drew.
 */

type Family = "carlito" | "caladea" | "sans" | "serif" | "mono";
export type FontVariant = `${Family}-${0 | 1 | 2 | 3}`;

const FONT_URLS: Record<Family, [string, string, string, string]> = {
  carlito: [carlitoRegular, carlitoBold, carlitoItalic, carlitoBoldItalic],
  caladea: [caladeaRegular, caladeaBold, caladeaItalic, caladeaBoldItalic],
  sans: [sansRegular, sansBold, sansItalic, sansBoldItalic],
  serif: [serifRegular, serifBold, serifItalic, serifBoldItalic],
  mono: [monoRegular, monoBold, monoItalic, monoBoldItalic],
};

/** Fonts that our @font-face rules alias to Carlito/Caladea when not installed. */
const WEB_ALIASES: Record<string, Family> = {
  calibri: "carlito",
  carlito: "carlito",
  "calibri light": "carlito",
  aptos: "carlito",
  "aptos display": "carlito",
  "aptos narrow": "carlito",
  "aptos light": "carlito",
  "segoe ui": "carlito",
  candara: "carlito",
  corbel: "carlito",
  cambria: "caladea",
  caladea: "caladea",
  constantia: "caladea",
  "aptos serif": "caladea",
};

/** Installed fonts that are metric-compatible with a bundled font. */
const METRIC_COMPATIBLE: Record<string, Family> = {
  calibri: "carlito",
  cambria: "caladea",
  arial: "sans",
  helvetica: "sans",
  arimo: "sans",
  "liberation sans": "sans",
  "times new roman": "serif",
  times: "serif",
  tinos: "serif",
  "liberation serif": "serif",
  "courier new": "mono",
  cousine: "mono",
  "liberation mono": "mono",
};

const GENERIC = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "math",
  "emoji",
]);

// Scripts that need shaping or bidi layout are never vectorized.
const COMPLEX_SCRIPT =
  /[\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0EFF\u0F00-\u0FFF\u1000-\u109F\u1780-\u18AF\u200C-\u200F\u202A-\u202E\u2066-\u2069\uFB1D-\uFDFF\uFE70-\uFEFF]/;

const localCache = new Map<string, boolean>();
let measureContext: CanvasRenderingContext2D | null = null;

/** Detects fonts installed on this device (web fonts in the render frame don't count). */
function isInstalled(name: string) {
  const key = name.toLowerCase();
  const cached = localCache.get(key);
  if (cached !== undefined) return cached;
  measureContext ??= document.createElement("canvas").getContext("2d");
  let result = false;
  if (measureContext) {
    const sample = "mmmmmmmmmmlliiWWWQQ@#0123456789";
    for (const base of ["monospace", "serif", "sans-serif"]) {
      measureContext.font = `72px ${base}`;
      const baseline = measureContext.measureText(sample).width;
      measureContext.font = `72px "${name.replace(/"/g, "")}", ${base}`;
      if (Math.abs(measureContext.measureText(sample).width - baseline) > 0.5) {
        result = true;
        break;
      }
    }
  }
  localCache.set(key, result);
  return result;
}

/** The bundled family matching the font the browser actually used for a CSS font stack. */
export function resolveFamily(stack: string): Family | null {
  const names = stack.split(",").map((name) => name.trim().replace(/^['"]|['"]$/g, ""));
  for (const name of names) {
    const lower = name.toLowerCase();
    if (!lower) continue;
    if (GENERIC.has(lower)) return null;
    const alias = WEB_ALIASES[lower];
    const compatible = METRIC_COMPATIBLE[lower];
    if (alias) {
      // A real installed font wins over the alias; only metric-compatible ones are safe.
      if (isInstalled(name)) return compatible ?? null;
      return alias;
    }
    if (isInstalled(name)) return compatible ?? null;
  }
  return null;
}

export type VectorItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number;
  size: number;
  color: [number, number, number];
  variant: FontVariant;
  clip: { x: number; y: number; width: number; height: number } | null;
  /** Underline/strike-through lines, drawn from x to decorationEnd. */
  decorations: Decoration[];
  decorationEnd: number;
};

export type Decoration = {
  kind: "underline" | "line-through" | "overline";
  color: [number, number, number];
  double: boolean;
};

export type PlainItem = { text: string; x: number; y: number; width: number; height: number };

export class VectorFonts {
  private readonly fonts = new Map<FontVariant, Promise<PDFFont | null>>();
  private readonly charsets = new Map<FontVariant, Set<number>>();
  private readonly bytes = new Map<string, Promise<ArrayBuffer | null>>();
  private fontkitReady: Promise<void> | null = null;
  private readonly ratios = new Map<FontVariant, number>();

  constructor(private readonly pdf: PDFDocument) {}

  private async ensureFontkit() {
    this.fontkitReady ??= import("@pdf-lib/fontkit").then(({ default: fontkit }) => {
      this.pdf.registerFontkit(fontkit);
    });
    return this.fontkitReady;
  }

  private load(url: string) {
    let pending = this.bytes.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .catch(() => null);
      this.bytes.set(url, pending);
    }
    return pending;
  }

  font(variant: FontVariant) {
    let pending = this.fonts.get(variant);
    if (!pending) {
      const [family, index] = variant.split("-") as [Family, string];
      const url = FONT_URLS[family][Number(index)]!;
      pending = (async () => {
        await this.ensureFontkit();
        const data = await this.load(url);
        if (!data) return null;
        try {
          // Full embedding: fontkit's subsetter drops glyphs from some of these fonts.
          const font = await this.pdf.embedFont(data, { subset: false });
          this.charsets.set(variant, new Set(font.getCharacterSet()));
          const metrics = (
            font as unknown as { embedder?: { font?: { ascent: number; descent: number } } }
          ).embedder?.font;
          if (metrics && metrics.ascent - metrics.descent > 0) {
            this.ratios.set(variant, metrics.ascent / (metrics.ascent - metrics.descent));
          }
          return font;
        } catch {
          return null;
        }
      })();
      this.fonts.set(variant, pending);
    }
    return pending;
  }

  /** Ascent / (ascent + descent), the baseline position within a text box. */
  ascentRatio(variant: FontVariant) {
    return this.ratios.get(variant) ?? 0.78;
  }

  async supports(variant: FontVariant, text: string) {
    const font = await this.font(variant);
    const set = this.charsets.get(variant);
    if (!font || !set) return false;
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      if (code <= 32) continue;
      if (!set.has(code)) return false;
    }
    return true;
  }
}

type ParentInfo = {
  variant: FontVariant | null;
  size: number;
  color: [number, number, number];
  transform: string | null;
};

function parseColor(value: string): [number, number, number, number] | null {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(
    value,
  );
  if (!match) return null;
  let alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
  if (match[4]?.endsWith("%")) alpha /= 100;
  return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255, alpha];
}

export type TextPlan = { vector: VectorItem[]; plain: PlainItem[]; hide: HTMLElement[] };

/**
 * Walks a page and splits its text into vector items (drawn as real text) and
 * plain items (kept in the image, with an invisible searchable copy).
 */
export async function planPageText(
  page: HTMLElement,
  fonts: VectorFonts,
  enabled: boolean,
): Promise<TextPlan> {
  const doc = page.ownerDocument;
  const view = doc.defaultView!;
  // Scroll the page into the frame's viewport so hit-testing works for occlusion checks.
  const before = page.getBoundingClientRect();
  view.scrollTo(before.left + view.scrollX, before.top + view.scrollY);
  const pageRect = page.getBoundingClientRect();
  const plan: TextPlan = { vector: [], plain: [], hide: [] };
  const scaleCache = new Map<Element, number | null>();
  const clipCache = new Map<Element, DOMRect | null>();

  // Accumulated scale from ancestor transforms, or null when rotated/skewed.
  const scaleOf = (element: Element): number | null => {
    if (element === page || !element.parentElement) return 1;
    const cached = scaleCache.get(element);
    if (cached !== undefined) return cached;
    const parentScale = scaleOf(element.parentElement);
    let result: number | null = parentScale;
    const transform = view.getComputedStyle(element).transform;
    if (result !== null && transform && transform !== "none") {
      const values = /matrix\(([^)]+)\)/.exec(transform)?.[1]?.split(",").map(Number);
      if (
        !values ||
        values.length < 4 ||
        Math.abs(values[1]!) > 1e-4 ||
        Math.abs(values[2]!) > 1e-4 ||
        values[0]! < 0 ||
        values[3]! < 0 ||
        Math.abs(values[0]! - values[3]!) > 1e-4
      ) {
        result = null;
      } else result = result * values[0]!;
    }
    scaleCache.set(element, result);
    return result;
  };

  const clipOf = (element: Element): DOMRect | null => {
    if (element === page) return page.getBoundingClientRect();
    const cached = clipCache.get(element);
    if (cached !== undefined) return cached;
    const parentClip = element.parentElement ? clipOf(element.parentElement) : null;
    let result = parentClip;
    const style = view.getComputedStyle(element);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") {
      const rect = element.getBoundingClientRect();
      if (!result) result = rect;
      else {
        const left = Math.max(result.left, rect.left);
        const top = Math.max(result.top, rect.top);
        const right = Math.min(result.right, rect.right);
        const bottom = Math.min(result.bottom, rect.bottom);
        result = new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
      }
    }
    clipCache.set(element, result);
    return result;
  };

  const parents = new Map<HTMLElement, Text[]>();
  const walker = doc.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!(node.nodeValue ?? "").trim()) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest("svg")) continue;
    const list = parents.get(parent);
    if (list) list.push(node);
    else parents.set(parent, [node]);
  }

  const range = doc.createRange();
  for (const [parent, nodes] of parents) {
    const style = view.getComputedStyle(parent);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const color = parseColor(style.color);
    const fill = parseColor(style.getPropertyValue("-webkit-text-fill-color") || style.color);
    const scale = scaleOf(parent);
    const family = enabled ? resolveFamily(style.fontFamily) : null;
    const weight = Number.parseInt(style.fontWeight, 10) || 400;
    const italic = /italic|oblique/.test(style.fontStyle);
    const variant = family
      ? (`${family}-${(weight >= 600 ? 1 : 0) + (italic ? 2 : 0)}` as FontVariant)
      : null;
    const text = nodes.map((node) => node.nodeValue ?? "").join("");
    let vector =
      !!variant &&
      scale !== null &&
      !!color &&
      !!fill &&
      color[3] > 0.99 &&
      Math.abs(color[0] - fill[0]) + Math.abs(color[1] - fill[1]) + Math.abs(color[2] - fill[2]) <
        0.01 &&
      style.textShadow === "none" &&
      style.getPropertyValue("-webkit-background-clip") !== "text" &&
      style.backgroundClip !== "text" &&
      (Number.parseFloat(style.getPropertyValue("-webkit-text-stroke-width")) || 0) === 0 &&
      style.textTransform === "none" &&
      !/small-caps/.test(style.fontVariant) &&
      style.writingMode === "horizontal-tb" &&
      Number(style.opacity) > 0.99 &&
      !COMPLEX_SCRIPT.test(text);
    if (vector && variant) vector = await fonts.supports(variant, text);
    if (vector) vector = !isCovered(parent, nodes, doc, range);
    if (vector) {
      // Hidden elements further up would hide our drawing too; check ancestors' opacity cheaply.
      for (
        let ancestor = parent.parentElement;
        ancestor && ancestor !== page;
        ancestor = ancestor.parentElement
      ) {
        if (Number(view.getComputedStyle(ancestor).opacity) < 0.99) {
          vector = false;
          break;
        }
      }
    }

    const size = (Number.parseFloat(style.fontSize) || 16) * (scale ?? 1);
    const decorations = vector ? decorationsOf(parent, page, view) : [];
    const firstIndex = plan.vector.length;
    const clipRect = vector ? clipOf(parent) : null;
    for (const node of nodes) {
      const value = node.nodeValue ?? "";
      let baselineOffset: number | null = null;
      const pattern = /\S+/g;
      for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rects = [...range.getClientRects()].filter(
          (rect) => rect.width > 0.3 && rect.height > 0.3,
        );
        if (!rects.length) continue;
        const followedBySpace = match.index + match[0].length < value.length;
        const segments: Array<{ text: string; rect: DOMRect }> = [];
        if (rects.length === 1) segments.push({ text: match[0], rect: rects[0]! });
        else {
          // Words wrapped across lines: split into per-line character runs.
          let current: { text: string; rect: DOMRect } | null = null;
          for (let offset = 0; offset < match[0].length; offset++) {
            range.setStart(node, match.index + offset);
            range.setEnd(node, match.index + offset + 1);
            const rect = range.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            const char = match[0][offset] ?? "";
            if (current && Math.abs(current.rect.top - rect.top) < 1) {
              current.text += char;
              current.rect = new DOMRect(
                current.rect.left,
                current.rect.top,
                rect.right - current.rect.left,
                current.rect.height,
              );
            } else {
              current = { text: char, rect };
              segments.push(current);
            }
          }
        }
        segments.forEach((segment, index) => {
          const rect = segment.rect;
          const item = {
            text: segment.text + (followedBySpace && index === segments.length - 1 ? " " : ""),
            x: rect.left - pageRect.left,
            y: rect.top - pageRect.top,
            width: rect.width,
            height: rect.height,
          };
          if (
            item.x + item.width <= 0 ||
            item.y + item.height <= 0 ||
            item.x >= page.offsetWidth ||
            item.y >= page.offsetHeight
          )
            return;
          if (!vector || !variant || !color) {
            plan.plain.push(item);
            return;
          }
          if (baselineOffset === null && index === 0)
            baselineOffset = measureBaseline(node, match!.index, rect);
          let clip: VectorItem["clip"] = null;
          if (clipRect) {
            const inside =
              rect.left >= clipRect.left - 0.5 &&
              rect.right <= clipRect.right + 0.5 &&
              rect.top >= clipRect.top - 0.5 &&
              rect.bottom <= clipRect.bottom + 0.5;
            if (!inside) {
              clip = {
                x: clipRect.left - pageRect.left,
                y: clipRect.top - pageRect.top,
                width: clipRect.width,
                height: clipRect.height,
              };
            }
          }
          plan.vector.push({
            ...item,
            baseline: item.y + (baselineOffset ?? rect.height * fonts.ascentRatio(variant)),
            size,
            color: [color[0], color[1], color[2]],
            variant,
            clip,
            decorations,
            decorationEnd: item.x + item.width,
          });
        });
      }
    }
    if (vector) {
      plan.hide.push(parent);
      // Decorations continue under the spaces between words on the same line.
      for (let index = firstIndex; index < plan.vector.length - 1; index++) {
        const current = plan.vector[index]!;
        const next = plan.vector[index + 1]!;
        if (
          Math.abs(current.baseline - next.baseline) < 1 &&
          next.x > current.x &&
          /\s$/.test(current.text)
        ) {
          current.decorationEnd = next.x;
        }
      }
    }
  }
  range.detach();
  return plan;
}

/** True when another element (an image, chart or shape) is painted over this text. */
function isCovered(parent: HTMLElement, nodes: Text[], doc: Document, range: Range) {
  const samples: DOMRect[] = [];
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  for (const [node, fromEnd] of [
    [first, false],
    [last, true],
  ] as const) {
    const value = node.nodeValue ?? "";
    const match = fromEnd ? /\S+\s*$/.exec(value) : /\S+/.exec(value);
    if (!match) continue;
    const length = match[0].trimEnd().length;
    range.setStart(node, match.index);
    range.setEnd(node, match.index + length);
    const rects = range.getClientRects();
    const rect = fromEnd ? rects[rects.length - 1] : rects[0];
    if (rect) samples.push(rect);
  }
  for (const rect of samples) {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const view = doc.defaultView!;
    if (x < 0 || y < 0 || x > view.innerWidth || y > view.innerHeight) continue;
    const hit = doc.elementFromPoint(x, y);
    if (!hit) continue;
    if (hit === parent || parent.contains(hit) || hit.contains(parent)) continue;
    return true;
  }
  return false;
}

/** Text decorations that apply to an element, including ones propagated from ancestors. */
function decorationsOf(element: HTMLElement, page: HTMLElement, view: Window): Decoration[] {
  const result: Decoration[] = [];
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current);
    const lines = style.textDecorationLine || "none";
    if (lines !== "none") {
      const color = parseColor(style.textDecorationColor) ?? parseColor(style.color);
      if (color && color[3] > 0.01) {
        for (const kind of ["underline", "line-through", "overline"] as const) {
          if (lines.includes(kind) && !result.some((item) => item.kind === kind)) {
            result.push({
              kind,
              color: [color[0], color[1], color[2]],
              double: style.textDecorationStyle === "double",
            });
          }
        }
      }
    }
    if (current === page) break;
    // Decorations do not propagate into atomic inlines or out-of-flow boxes.
    if (
      /^inline-(block|flex|grid|table)$/.test(style.display) ||
      style.position === "absolute" ||
      style.position === "fixed" ||
      style.cssFloat !== "none"
    )
      break;
  }
  return result;
}

/** Distance from a word's box top to its baseline, measured with a zero-size inline probe. */
function measureBaseline(node: Text, offset: number, wordRect: DOMRect) {
  const doc = node.ownerDocument;
  const parent = node.parentNode;
  if (!parent) return null;
  const probe = doc.createElement("span");
  probe.style.cssText =
    "display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline;line-height:0";
  let rest: Text | null = null;
  if (offset > 0) {
    rest = node.splitText(offset);
    parent.insertBefore(probe, rest);
  } else parent.insertBefore(probe, node);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  if (rest) {
    node.appendData(rest.nodeValue ?? "");
    rest.remove();
  }
  const baseline = rect.bottom;
  // The probe must sit on the word's own line; otherwise use font metrics instead.
  if (!Number.isFinite(baseline) || baseline < wordRect.top || baseline > wordRect.bottom + 0.5)
    return null;
  if (Math.abs(rect.left - wordRect.left) > wordRect.height * 2) return null;
  return baseline - wordRect.top;
}
