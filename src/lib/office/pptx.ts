import JSZip from "jszip";
import { OfficeError, nextFrame, throwIfCancelled, type RenderContext } from "./common";
import { parseChartXml, renderChartSvg, type ChartModel } from "./charts";
import type { PowerPointOptions } from "./convert";
import { officeFontStack } from "./fonts";
import { PX_PER_PT, createPage, waitForAssets, type RenderHost } from "./host";
import {
  attr,
  relId,
  child,
  children,
  descendants,
  drawingColor,
  parseRels,
  parseTheme,
  parseXml,
  path,
  relsPath,
  valAttr,
  DEFAULT_THEME,
  type Theme,
} from "./ooxml";

type PptxModule = typeof import("pptxtojson");
type ParsedPresentation = Awaited<ReturnType<PptxModule["parse"]>>;
type Slide = ParsedPresentation["slides"][number];
type Element = Slide["elements"][number];
type Fill = NonNullable<Extract<Element, { type: "shape" }>["fill"]>;

export const PPTX_EXTRA_CSS = `
.pp-el { position: absolute; box-sizing: border-box; }
.pp-el > svg { position: absolute; left: 0; top: 0; overflow: visible; }
.pp-text { position: absolute; display: flex; flex-direction: column; box-sizing: border-box; overflow: visible; }
.pp-text p { margin: 0; padding: 0; line-height: 1.2; overflow-wrap: break-word; white-space: pre-wrap; }
.pp-nowrap p { white-space: pre; }
.pp-text ul, .pp-text ol { margin: 0; padding-left: 1.2em; }
.pp-text a { color: inherit; }
.pp-bullet { display: inline-block; text-indent: 0; white-space: pre; }
.pp-table { position: absolute; border-collapse: collapse; table-layout: fixed; }
.pp-table td { box-sizing: border-box; padding: 3.6pt 7.2pt; overflow: hidden; vertical-align: top; }
.pp-table td p { margin: 0; line-height: 1.2; white-space: pre-wrap; overflow-wrap: break-word; }
.pp-notes { position: absolute; font-size: 12pt; line-height: 1.35; white-space: pre-wrap; color: #000; }
.pp-notes p { margin: 0 0 6pt; }
`;

const EMU_PER_PT = 12700;
const BULLET_START = "\uE010";
const BULLET_END = "\uE011";
const PCT_BASE = 0xe100;

/* ------------------------------------------------------------------ */
/* Pre-processing                                                      */
/* ------------------------------------------------------------------ */

type SlideInfo = {
  part: string;
  hidden: boolean;
  background: string | null;
  charts: Array<{ x: number; y: number; width: number; height: number; model: ChartModel }>;
};

const DEFAULT_TABLE_STYLE_ID = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";
// PowerPoint's built-in "Medium Style 2 - Accent 1", used when a file references it without a definition.
const DEFAULT_TABLE_STYLE = `<a:tblStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" styleId="${DEFAULT_TABLE_STYLE_ID}" styleName="Medium Style 2 - Accent 1"><a:wholeTbl><a:tcTxStyle><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr><a:left><a:ln w="12700" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:left><a:right><a:ln w="12700" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:right><a:top><a:ln w="12700" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:top><a:bottom><a:ln w="12700" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:bottom><a:insideH><a:ln w="12700" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:insideH><a:insideV><a:ln w="12700" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:insideV></a:tcBdr><a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="20000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:wholeTbl><a:band1H><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="40000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:band1H><a:band2H><a:tcStyle><a:tcBdr/></a:tcStyle></a:band2H><a:band1V><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="40000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:band1V><a:band2V><a:tcStyle><a:tcBdr/></a:tcStyle></a:band2V><a:lastCol><a:tcTxStyle b="on"><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:lastCol><a:firstCol><a:tcTxStyle b="on"><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:firstCol><a:lastRow><a:tcTxStyle b="on"><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr><a:top><a:ln w="38100" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:top></a:tcBdr><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:lastRow><a:firstRow><a:tcTxStyle b="on"><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr><a:bottom><a:ln w="38100" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:bottom></a:tcBdr><a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle></a:firstRow></a:tblStyle>`;

const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

const SYMBOL_MAP: Record<number, string> = {
  0xf0b7: "•",
  0xf0a7: "▪",
  0xf0d8: "➢",
  0xf076: "❖",
  0xf0fc: "✓",
  0xf06e: "■",
  0xf071: "❑",
  0xf075: "◆",
  0xf06c: "●",
  0xf0a8: "◻",
  0xf09f: "•",
  0xf0e8: "➔",
  0xf0f0: "⇨",
  0xf02d: "–",
  0xf0d7: "➢",
};

function mapBulletChar(char: string, font: string | null) {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0xf000 && code <= 0xf0ff) return SYMBOL_MAP[code] ?? "•";
  if (font && /wingdings/i.test(font)) {
    const wingdings: Record<string, string> = {
      "§": "▪",
      Ø: "➢",
      v: "❖",
      ü: "✓",
      n: "■",
      q: "❑",
      u: "◆",
      l: "●",
      è: "➔",
      ð: "⇨",
    };
    return wingdings[char] ?? "•";
  }
  if (font && /symbol/i.test(font) && char === "·") return "•";
  return char;
}

type BulletProps = {
  kind?: "none" | "char" | "auto";
  char?: string;
  autoType?: string;
  startAt?: number;
  font?: string | null;
  color?: Element_ | null;
  sizePct?: number;
};
type Element_ = globalThis.Element;

function readBullet(pPr: Element_ | undefined, target: BulletProps) {
  if (!pPr) return;
  if (target.kind === undefined) {
    if (child(pPr, "buNone")) target.kind = "none";
    else if (child(pPr, "buChar")) {
      target.kind = "char";
      target.char = attr(child(pPr, "buChar"), "char") ?? "•";
    } else if (child(pPr, "buAutoNum")) {
      target.kind = "auto";
      target.autoType = attr(child(pPr, "buAutoNum"), "type") ?? "arabicPeriod";
      target.startAt = Number(attr(child(pPr, "buAutoNum"), "startAt") ?? 1);
    } else if (child(pPr, "buBlip")) {
      target.kind = "char";
      target.char = "•";
    }
  }
  if (target.font === undefined) {
    if (child(pPr, "buFontTx")) target.font = null;
    else if (child(pPr, "buFont")) target.font = attr(child(pPr, "buFont"), "typeface");
  }
  if (target.color === undefined) {
    if (child(pPr, "buClrTx")) target.color = null;
    else if (child(pPr, "buClr")) target.color = child(pPr, "buClr")!;
  }
  if (target.sizePct === undefined) {
    const pct = child(pPr, "buSzPct");
    if (pct) target.sizePct = Number(valAttr(pct) ?? 100000) / 1000;
    else if (child(pPr, "buSzTx")) target.sizePct = 100;
  }
}

function levelNode(lstStyle: Element_ | undefined, level: number) {
  return child(lstStyle, `lvl${level + 1}pPr`);
}

function placeholderOf(sp: Element_) {
  const ph = path(sp, "nvSpPr", "nvPr", "ph");
  if (!ph) return null;
  return { type: attr(ph, "type") ?? "obj", idx: attr(ph, "idx") };
}

function findPlaceholder(doc: XMLDocument | null, ph: { type: string; idx: string | null }) {
  if (!doc) return undefined;
  const shapes = descendants(doc, "sp");
  const normalize = (type: string) =>
    type === "ctrTitle" ? "title" : type === "subTitle" || type === "obj" ? "body" : type;
  if (ph.idx !== null) {
    const byIdx = shapes.find(
      (shape) => attr(path(shape, "nvSpPr", "nvPr", "ph"), "idx") === ph.idx,
    );
    if (byIdx) return byIdx;
  }
  return (
    shapes.find((shape) => {
      const other = path(shape, "nvSpPr", "nvPr", "ph");
      return other && (attr(other, "type") ?? "obj") === ph.type;
    }) ??
    shapes.find((shape) => {
      const other = path(shape, "nvSpPr", "nvPr", "ph");
      return other && normalize(attr(other, "type") ?? "obj") === normalize(ph.type);
    })
  );
}

/**
 * Subtitles inherit text size/colour from the master's body style, but pptxtojson
 * reads the title style first. Writing the resolved defaults onto the slide's own
 * list style keeps subtitles at their real size.
 */
function flattenSubtitleStyle(
  slide: XMLDocument,
  txBody: Element_,
  layoutShape: Element_ | undefined,
  masterShape: Element_ | undefined,
  masterStyles: Element_ | undefined,
) {
  let lstStyle = child(txBody, "lstStyle");
  const sources = [
    lstStyle,
    child(child(layoutShape, "txBody"), "lstStyle"),
    child(child(masterShape, "txBody"), "lstStyle"),
    child(masterStyles, "bodyStyle"),
  ];
  let changed = false;
  for (let level = 0; level < 9; level++) {
    const name = `lvl${level + 1}pPr`;
    const resolved = slide.createElementNS(A_NS, "a:defRPr");
    let hasFill = false;
    let hasLatin = false;
    for (const source of [...sources].reverse()) {
      const defRPr = child(child(source, name), "defRPr");
      if (!defRPr) continue;
      for (const attribute of [...defRPr.attributes])
        resolved.setAttribute(attribute.name, attribute.value);
    }
    for (const source of sources) {
      const defRPr = child(child(source, name), "defRPr");
      if (!defRPr) continue;
      const fill = children(defRPr).find((node) => /Fill$/.test(node.localName));
      if (fill && !hasFill) {
        resolved.appendChild(fill.cloneNode(true));
        hasFill = true;
      }
      const latin = child(defRPr, "latin");
      if (latin && !hasLatin) {
        resolved.appendChild(latin.cloneNode(true));
        hasLatin = true;
      }
    }
    if (!resolved.attributes.length && !resolved.childNodes.length) continue;
    if (!lstStyle) {
      lstStyle = slide.createElementNS(A_NS, "a:lstStyle");
      const bodyPr = child(txBody, "bodyPr");
      txBody.insertBefore(lstStyle, bodyPr ? bodyPr.nextSibling : txBody.firstChild);
    }
    let levelProps = child(lstStyle, name);
    if (!levelProps) {
      levelProps = slide.createElementNS(A_NS, `a:${name}`);
      lstStyle.appendChild(levelProps);
    }
    child(levelProps, "defRPr")?.remove();
    levelProps.appendChild(resolved);
    changed = true;
  }
  return changed;
}

/**
 * DrawingML applies tint/shade in linear RGB; pptxtojson applies them in sRGB,
 * which makes tinted theme colours too dark. Pre-compute those colours.
 */
function resolveTintedColors(xml: XMLDocument, theme: Theme) {
  let changed = false;
  for (const node of [...descendants(xml, "schemeClr"), ...descendants(xml, "srgbClr")]) {
    if (!children(node).some((item) => item.localName === "tint" || item.localName === "shade"))
      continue;
    if (node.localName === "schemeClr" && valAttr(node) === "phClr") continue;
    const holder = xml.createElementNS(A_NS, "a:solidFill");
    holder.appendChild(node.cloneNode(true));
    const color = drawingColor(holder, theme);
    if (!color) continue;
    const replacement = xml.createElementNS(A_NS, "a:srgbClr");
    replacement.setAttribute("val", color.slice(1));
    children(node)
      .filter((item) => item.localName === "alpha")
      .forEach((item) => replacement.appendChild(item.cloneNode(true)));
    node.parentNode?.replaceChild(replacement, node);
    changed = true;
  }
  return changed;
}

/** Background from the slide, else its layout, else its master (solid, gradient or style reference). */
function resolveBackground(sources: Array<XMLDocument | null>, theme: Theme): string | null {
  for (const source of sources) {
    const bg = path(source?.documentElement, "cSld", "bg");
    if (!bg) continue;
    const bgPr = child(bg, "bgPr");
    if (bgPr) {
      if (child(bgPr, "solidFill")) return drawingColor(child(bgPr, "solidFill"), theme);
      const gradient = child(bgPr, "gradFill");
      if (gradient) {
        const stops = children(child(gradient, "gsLst"), "gs")
          .map((stop) => ({
            pos: Number(attr(stop, "pos") ?? 0) / 1000,
            color: drawingColor(stop, theme),
          }))
          .filter((stop) => stop.color)
          .sort((a, b) => a.pos - b.pos)
          .map((stop) => `${stop.color} ${stop.pos}%`)
          .join(", ");
        if (!stops) return null;
        if (child(gradient, "path")) return `radial-gradient(circle, ${stops})`;
        const angle = Number(attr(child(gradient, "lin"), "ang") ?? 0) / 60000;
        return `linear-gradient(${angle + 90}deg, ${stops})`;
      }
      return null; // image and pattern backgrounds are handled by pptxtojson
    }
    const bgRef = child(bg, "bgRef");
    if (bgRef) return drawingColor(bgRef, theme);
  }
  return null;
}

function formatAutoNumber(type: string, value: number) {
  const roman = (n: number) => {
    const table: Array<[number, string]> = [
      [1000, "m"],
      [900, "cm"],
      [500, "d"],
      [400, "cd"],
      [100, "c"],
      [90, "xc"],
      [50, "l"],
      [40, "xl"],
      [10, "x"],
      [9, "ix"],
      [5, "v"],
      [4, "iv"],
      [1, "i"],
    ];
    let out = "";
    for (const [amount, numeral] of table)
      while (n >= amount) {
        out += numeral;
        n -= amount;
      }
    return out;
  };
  const alpha = (n: number) => {
    let out = "";
    while (n > 0) {
      n--;
      out = String.fromCharCode(97 + (n % 26)) + out;
      n = Math.floor(n / 26);
    }
    return out;
  };
  let core = String(value);
  if (/^alphaLc/.test(type)) core = alpha(value);
  else if (/^alphaUc/.test(type)) core = alpha(value).toUpperCase();
  else if (/^romanLc/.test(type)) core = roman(value);
  else if (/^romanUc/.test(type)) core = roman(value).toUpperCase();
  if (/ParenBoth$/.test(type)) return `(${core})`;
  if (/ParenR$/.test(type)) return `${core})`;
  if (/Plain$/.test(type)) return core;
  if (/Minus$/.test(type)) return `- ${core} -`;
  return `${core}.`;
}

/**
 * Makes inherited bullets explicit. pptxtojson only renders bullets written on
 * the paragraph itself, but most slides inherit them from the layout/master, so
 * the bullet glyph (or auto number) is inserted as a marked text run.
 */
function materializeBullets(
  slide: XMLDocument,
  layout: XMLDocument | null,
  master: XMLDocument | null,
) {
  const masterStyles = path(master?.documentElement, "txStyles");
  let changed = false;
  for (const sp of descendants(slide, "sp")) {
    const txBody = child(sp, "txBody");
    if (!txBody) continue;
    const ph = placeholderOf(sp);
    const layoutShape = ph ? findPlaceholder(layout, ph) : undefined;
    const masterShape = ph ? findPlaceholder(master, ph) : undefined;
    const styleKey = !ph
      ? "otherStyle"
      : /title/i.test(ph.type)
        ? "titleStyle"
        : ["body", "obj", "subTitle"].includes(ph.type) || (ph.idx !== null && ph.type === "obj")
          ? "bodyStyle"
          : "otherStyle";
    if (
      ph?.type === "subTitle" &&
      flattenSubtitleStyle(slide, txBody, layoutShape, masterShape, masterStyles)
    )
      changed = true;
    const counters: number[] = [];
    for (const p of children(txBody, "p")) {
      const pPr = child(p, "pPr");
      const level = Math.min(8, Number(attr(pPr, "lvl") ?? 0));
      const runs = children(p).filter((node) => node.localName === "r" || node.localName === "fld");
      const hasText = runs.some((run) => (child(run, "t")?.textContent ?? "").length > 0);
      const bullet: BulletProps = {};
      readBullet(pPr, bullet);
      readBullet(levelNode(child(txBody, "lstStyle"), level), bullet);
      readBullet(levelNode(path(layoutShape, "txBody", "lstStyle"), level), bullet);
      readBullet(levelNode(path(masterShape, "txBody", "lstStyle"), level), bullet);
      if (ph && (ph.type === "subTitle" || ph.type === "ctrTitle" || ph.type === "title")) {
        // Titles and subtitles never inherit body bullets.
        bullet.kind ??= "none";
      }
      readBullet(levelNode(child(masterStyles, styleKey), level), bullet);
      counters.length = Math.min(counters.length, level + 1);
      if (!hasText || !bullet.kind || bullet.kind === "none") {
        if (bullet.kind !== "auto") counters[level] = 0;
        continue;
      }
      let marker: string;
      if (bullet.kind === "auto") {
        const next = counters[level] ? counters[level]! + 1 : (bullet.startAt ?? 1);
        counters[level] = next;
        marker = formatAutoNumber(bullet.autoType ?? "arabicPeriod", next);
      } else {
        counters[level] = 0;
        marker = [...(bullet.char ?? "•")]
          .map((char) => mapBulletChar(char, bullet.font ?? null))
          .join("");
      }
      const firstRun = runs[0];
      const run = slide.createElementNS(A_NS, "a:r");
      const baseRPr = child(firstRun, "rPr");
      const rPr = baseRPr
        ? (baseRPr.cloneNode(true) as Element_)
        : slide.createElementNS(A_NS, "a:rPr");
      ["u", "strike"].forEach((name) => rPr.removeAttribute(name));
      children(rPr, "hlinkClick").forEach((node) => node.remove());
      if (bullet.color) {
        children(rPr)
          .filter((node) => /Fill$/.test(node.localName))
          .forEach((node) => node.remove());
        const fill = slide.createElementNS(A_NS, "a:solidFill");
        children(bullet.color).forEach((node) => fill.appendChild(node.cloneNode(true)));
        rPr.insertBefore(fill, rPr.firstChild);
      }
      if (bullet.font && !/wingdings|symbol|webdings/i.test(bullet.font)) {
        children(rPr, "latin").forEach((node) => node.remove());
        const latin = slide.createElementNS(A_NS, "a:latin");
        latin.setAttribute("typeface", bullet.font);
        rPr.appendChild(latin);
      }
      run.appendChild(rPr);
      const t = slide.createElementNS(A_NS, "a:t");
      const pct = Math.max(25, Math.min(400, Math.round(bullet.sizePct ?? 100)));
      t.textContent = `${BULLET_START}${marker}${BULLET_END}${String.fromCharCode(PCT_BASE + pct)}`;
      run.appendChild(t);
      p.insertBefore(run, firstRun ?? null);
      // Stop pptxtojson from wrapping the paragraph in a list; indents still apply.
      let paragraphProps = pPr;
      if (!paragraphProps) {
        paragraphProps = slide.createElementNS(A_NS, "a:pPr");
        p.insertBefore(paragraphProps, p.firstChild);
      }
      children(paragraphProps)
        .filter((node) => /^bu/.test(node.localName))
        .forEach((node) => node.remove());
      paragraphProps.appendChild(slide.createElementNS(A_NS, "a:buNone"));
      changed = true;
    }
  }
  return changed;
}

async function preparePresentation(input: ArrayBuffer) {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw new OfficeError("damaged-file");
  }
  const presentation = zip.file("ppt/presentation.xml");
  if (!presentation) {
    if (zip.file("EncryptedPackage")) throw new OfficeError("encrypted");
    throw new OfficeError("damaged-file");
  }
  const xmlCache = new Map<string, XMLDocument | null>();
  const read = async (name: string) => {
    if (xmlCache.has(name)) return xmlCache.get(name)!;
    const file = zip.file(name);
    const xml = file ? parseXml(await file.async("string")) : null;
    xmlCache.set(name, xml);
    return xml;
  };
  const presentationXml = await read("ppt/presentation.xml");
  const presentationRels = parseRels(
    await read("ppt/_rels/presentation.xml.rels"),
    "ppt/presentation.xml",
  );
  const order = children(child(presentationXml?.documentElement, "sldIdLst"), "sldId")
    .map((node) => presentationRels.get(relId(node) ?? "")?.target)
    .filter((target): target is string => !!target && !!zip.file(target));

  // Supply the default table style when a table references it without a definition.
  const tableStyles = await read("ppt/tableStyles.xml");
  if (tableStyles) {
    const defined = new Set(
      descendants(tableStyles, "tblStyle").map((node) => attr(node, "styleId")),
    );
    let referencesDefault = false;
    for (const name of order) {
      const text = await zip.file(name)!.async("string");
      if (text.includes(DEFAULT_TABLE_STYLE_ID)) referencesDefault = true;
    }
    if (referencesDefault && !defined.has(DEFAULT_TABLE_STYLE_ID)) {
      const text = await zip.file("ppt/tableStyles.xml")!.async("string");
      const patched = text.includes("</a:tblStyleLst>")
        ? text.replace("</a:tblStyleLst>", `${DEFAULT_TABLE_STYLE}</a:tblStyleLst>`)
        : text.replace(
            /<a:tblStyleLst([^>]*)\/>/,
            `<a:tblStyleLst$1>${DEFAULT_TABLE_STYLE}</a:tblStyleLst>`,
          );
      zip.file("ppt/tableStyles.xml", patched);
    }
  }

  const serializer = new XMLSerializer();
  const infos = new Map<string, SlideInfo>();
  const colorFixed = new Set<string>();
  for (const part of order) {
    const slide = await read(part);
    if (!slide) continue;
    const rels = parseRels(await read(relsPath(part)), part);
    let layoutPart: string | null = null;
    for (const rel of rels.values()) if (/slideLayout$/.test(rel.type)) layoutPart = rel.target;
    const layout = layoutPart ? await read(layoutPart) : null;
    let masterPart: string | null = null;
    if (layoutPart) {
      for (const rel of parseRels(await read(relsPath(layoutPart)), layoutPart).values())
        if (/slideMaster$/.test(rel.type)) masterPart = rel.target;
    }
    const master = masterPart ? await read(masterPart) : null;
    let themePart: string | null = null;
    if (masterPart) {
      for (const rel of parseRels(await read(relsPath(masterPart)), masterPart).values())
        if (/theme$/.test(rel.type)) themePart = rel.target;
    }
    const theme: Theme = themePart ? parseTheme(await read(themePart)) : DEFAULT_THEME;

    let slideChanged = materializeBullets(slide, layout, master);
    if (resolveTintedColors(slide, theme)) slideChanged = true;
    if (slideChanged) zip.file(part, serializer.serializeToString(slide));
    for (const [shared, sharedPart] of [
      [layout, layoutPart],
      [master, masterPart],
    ] as const) {
      if (!shared || !sharedPart || colorFixed.has(sharedPart)) continue;
      colorFixed.add(sharedPart);
      if (resolveTintedColors(shared, theme))
        zip.file(sharedPart, serializer.serializeToString(shared));
    }
    if (!colorFixed.has("ppt/tableStyles.xml")) {
      colorFixed.add("ppt/tableStyles.xml");
      const styles = zip.file("ppt/tableStyles.xml");
      const stylesXml = styles ? parseXml(await styles.async("string")) : null;
      if (stylesXml && resolveTintedColors(stylesXml, theme))
        zip.file("ppt/tableStyles.xml", serializer.serializeToString(stylesXml));
    }

    const charts: SlideInfo["charts"] = [];
    const spTree = path(slide.documentElement, "cSld", "spTree");
    for (const frame of children(spTree, "graphicFrame")) {
      const chartRef = descendants(frame, "chart")[0];
      if (!chartRef) continue;
      const rel = rels.get(relId(chartRef) ?? "");
      const chartXml = rel ? await read(rel.target) : null;
      const model = chartXml
        ? parseChartXml(chartXml, theme, { border: false, fontSize: 18 })
        : null;
      const off = path(frame, "xfrm", "off");
      const ext = path(frame, "xfrm", "ext");
      if (!model || !off || !ext) continue;
      charts.push({
        x: Number(attr(off, "x") ?? 0) / EMU_PER_PT,
        y: Number(attr(off, "y") ?? 0) / EMU_PER_PT,
        width: Number(attr(ext, "cx") ?? 0) / EMU_PER_PT,
        height: Number(attr(ext, "cy") ?? 0) / EMU_PER_PT,
        model,
      });
    }
    const hidden = ["0", "false"].includes(attr(slide.documentElement, "show") ?? "1");
    infos.set(part, {
      part,
      hidden,
      charts,
      background: resolveBackground([slide, layout, master], theme),
    });
  }

  // pptxtojson returns slides sorted by part number; remember that order so they can be re-sorted.
  const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
  const parsedOrder = [
    ...(contentTypes ?? "").matchAll(
      /PartName="\/(ppt\/slides\/slide\d+\.xml)"[^>]*presentationml\.slide\+xml/g,
    ),
  ]
    .map((match) => match[1]!)
    .sort(
      (a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0),
    );
  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  return { buffer, order, parsedOrder, infos };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

const ALLOWED_TAGS = new Set([
  "P",
  "SPAN",
  "A",
  "BR",
  "SUB",
  "SUP",
  "STRONG",
  "EM",
  "B",
  "I",
  "U",
  "S",
  "OL",
  "UL",
  "LI",
  "DIV",
]);

/** Parses generated rich-text HTML inertly and keeps only formatting markup. */
function sanitizeHtml(doc: Document, html: string) {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const fragment = doc.createDocumentFragment();
  const copy = (source: Node, target: Node) => {
    for (const node of [...source.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) {
        target.appendChild(doc.createTextNode(node.nodeValue ?? ""));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const element = node as HTMLElement;
      if (!ALLOWED_TAGS.has(element.tagName)) {
        copy(element, target);
        continue;
      }
      const clone = doc.createElement(element.tagName.toLowerCase());
      const style = element.getAttribute("style");
      if (style && !/url\s*\(|expression\s*\(|@import/i.test(style)) {
        clone.setAttribute("style", style);
        if (clone.style.fontFamily)
          clone.style.fontFamily = officeFontStack(clone.style.fontFamily);
      }
      if (element.tagName === "A") {
        const href = element.getAttribute("href") ?? "";
        if (/^(https?:|mailto:)/i.test(href)) clone.setAttribute("href", href);
      }
      copy(element, clone);
      target.appendChild(clone);
    }
  };
  copy(parsed.body, fragment);
  return fragment;
}

/** pptxtojson turns every space into &nbsp;, which prevents normal word wrapping. */
function restoreSpaces(html: string) {
  return html.replace(/(&nbsp;|\u00a0)/g, " ");
}

function fixParagraphSpacing(html: string) {
  // pptxtojson writes percentage spacing (e.g. 20%) as "20em"; convert to a fraction of a line.
  return html.replace(
    /margin-(top|bottom):\s*([\d.]+)em/g,
    (_m, side: string, value: string) =>
      `margin-${side}: ${((Number(value) / 100) * 1.2).toFixed(3)}em`,
  );
}

function scaleFontSizes(html: string, factor: number) {
  if (!factor || factor === 1) return html;
  return html.replace(
    /font-size:\s*([\d.]+)pt/g,
    (_m, value: string) => `font-size: ${(Number(value) * factor).toFixed(2)}pt`,
  );
}

function px(value: number) {
  return value * PX_PER_PT;
}

function fillCss(fill: Fill | null | undefined): string | null {
  if (!fill) return null;
  if (fill.type === "color") return fill.value || null;
  if (fill.type === "image")
    return fill.value.base64 ? `center / cover no-repeat url("${fill.value.base64}")` : null;
  if (fill.type === "gradient") {
    const stops = [...fill.value.colors]
      .sort((a, b) => Number.parseFloat(a.pos) - Number.parseFloat(b.pos))
      .map((stop) => `${stop.color} ${stop.pos}`)
      .join(", ");
    if (!stops) return null;
    if (fill.value.path === "circle" || fill.value.path === "rect" || fill.value.path === "shape")
      return `radial-gradient(circle, ${stops})`;
    return `linear-gradient(${(fill.value.rot ?? 0) + 90}deg, ${stops})`;
  }
  if (fill.type === "pattern")
    return fill.value.foregroundColor || fill.value.backgroundColor || null;
  return null;
}

let gradientCounter = 0;

function svgFill(fill: Fill | null | undefined, defs: string[]): string {
  if (!fill) return "none";
  if (fill.type === "color") return fill.value || "none";
  if (fill.type === "gradient") {
    const id = `pp-grad-${++gradientCounter}`;
    const stops = [...fill.value.colors]
      .sort((a, b) => Number.parseFloat(a.pos) - Number.parseFloat(b.pos))
      .map(
        (stop) => `<stop offset="${escapeAttr(stop.pos)}" stop-color="${escapeAttr(stop.color)}"/>`,
      )
      .join("");
    if (fill.value.path === "circle" || fill.value.path === "rect" || fill.value.path === "shape") {
      defs.push(`<radialGradient id="${id}">${stops}</radialGradient>`);
    } else {
      const angle = ((fill.value.rot ?? 0) * Math.PI) / 180;
      const x2 = 0.5 + Math.cos(angle) * 0.5;
      const y2 = 0.5 + Math.sin(angle) * 0.5;
      defs.push(
        `<linearGradient id="${id}" x1="${1 - x2}" y1="${1 - y2}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`,
      );
    }
    return `url(#${id})`;
  }
  if (fill.type === "image" && fill.value.base64) {
    const id = `pp-img-${++gradientCounter}`;
    defs.push(
      `<pattern id="${id}" patternContentUnits="objectBoundingBox" width="1" height="1"><image href="${escapeAttr(fill.value.base64)}" width="1" height="1" preserveAspectRatio="xMidYMid slice"/></pattern>`,
    );
    return `url(#${id})`;
  }
  if (fill.type === "pattern") return fill.value.foregroundColor || "none";
  return "none";
}

function escapeAttr(value: string) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function transformCss(element: { rotate?: number; isFlipH?: boolean; isFlipV?: boolean }) {
  const parts: string[] = [];
  if (element.rotate) parts.push(`rotate(${element.rotate}deg)`);
  if (element.isFlipH) parts.push("scaleX(-1)");
  if (element.isFlipV) parts.push("scaleY(-1)");
  return parts.join(" ");
}

function shadowCss(shadow: { h: number; v: number; blur: number; color: string } | undefined) {
  if (!shadow) return "";
  return `drop-shadow(${px(shadow.h)}px ${px(shadow.v)}px ${px(shadow.blur) / 2}px ${shadow.color})`;
}

function markerDefs(id: string, color: string, type: string) {
  if (type === "oval")
    return `<marker id="${id}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4"><circle cx="5" cy="5" r="4" fill="${color}"/></marker>`;
  if (type === "diamond")
    return `<marker id="${id}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M5 0 L10 5 L5 10 L0 5 Z" fill="${color}"/></marker>`;
  return `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${color}"/></marker>`;
}

type RenderEnv = {
  doc: Document;
  charts: SlideInfo["charts"];
  palette: string[];
};

function renderText(
  env: RenderEnv,
  container: HTMLElement,
  element: Extract<Element, { type: "text" | "shape" }>,
  width: number,
  height: number,
) {
  if (
    !element.content ||
    !element.content
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim()
  )
    return;
  const inset = element.textInset ?? { l: 7.2, t: 3.6, r: 7.2, b: 3.6 };
  const box = env.doc.createElement("div");
  box.className = "pp-text";
  Object.assign(box.style, {
    left: `${px(inset.l)}px`,
    top: `${px(inset.t)}px`,
    width: `${Math.max(1, width - px(inset.l + inset.r))}px`,
    height: `${Math.max(1, height - px(inset.t + inset.b))}px`,
    justifyContent:
      element.vAlign === "mid" ? "center" : element.vAlign === "down" ? "flex-end" : "flex-start",
  });
  if (!element.wrap) box.classList.add("pp-nowrap");
  if (element.autoFit?.type === "text") box.dataset["autofit"] = "1";
  if ("isVertical" in element && element.isVertical) box.style.writingMode = "vertical-rl";
  const scale =
    element.autoFit?.type === "text" && element.autoFit.fontScale
      ? element.autoFit.fontScale / 100
      : 1;
  const html = scaleFontSizes(fixParagraphSpacing(restoreSpaces(element.content)), scale);
  const inner = env.doc.createElement("div");
  inner.appendChild(sanitizeHtml(env.doc, html));
  box.appendChild(inner);
  container.appendChild(box);
}

function renderElement(
  env: RenderEnv,
  parent: HTMLElement,
  element: Element,
  offset = { x: 0, y: 0 },
) {
  const doc = env.doc;
  const left = px(element.left + offset.x);
  const top = px(element.top + offset.y);
  const width = px(element.width);
  const height = px(element.height);
  const wrapper = doc.createElement("div");
  wrapper.className = "pp-el";
  Object.assign(wrapper.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
  if ("rotate" in element || "isFlipH" in element) {
    const transform = transformCss(
      element as { rotate?: number; isFlipH?: boolean; isFlipV?: boolean },
    );
    if (transform) wrapper.style.transform = transform;
  }

  switch (element.type) {
    case "group": {
      wrapper.style.overflow = "visible";
      for (const childElement of element.elements) renderElement(env, wrapper, childElement);
      break;
    }
    case "shape":
    case "text": {
      const shadow = "shadow" in element ? shadowCss(element.shadow) : "";
      if (shadow) wrapper.style.filter = shadow;
      // Paths pptxtojson could not evaluate contain NaN; fall back to the shape's bounding box.
      const hasPath =
        element.type === "shape" &&
        element.path &&
        element.pathViewBox &&
        !/NaN|Infinity/.test(element.path);
      const isLine = element.type === "shape" && /line|connector|arc/i.test(element.shapType ?? "");
      // Connectors take their line from the shape style; theme line width 1 is 0.75pt.
      const lineWidth = element.borderWidth > 0 ? element.borderWidth : isLine ? 0.75 : 0;
      const stroke = lineWidth > 0 && element.borderColor ? element.borderColor : null;
      if (hasPath && element.type === "shape") {
        const defs: string[] = [];
        const fill = element.strokeOnly || isLine ? "none" : svgFill(element.fill, defs);
        const vb = element.pathViewBox!;
        const markerStart =
          element.headEnd && element.headEnd.type !== "none" && stroke
            ? `pp-m-${++gradientCounter}`
            : null;
        const markerEnd =
          element.tailEnd && element.tailEnd.type !== "none" && stroke
            ? `pp-m-${++gradientCounter}`
            : null;
        if (markerStart && stroke)
          defs.push(markerDefs(markerStart, stroke, element.headEnd!.type));
        if (markerEnd && stroke) defs.push(markerDefs(markerEnd, stroke, element.tailEnd!.type));
        const dash =
          element.borderStrokeDasharray && element.borderStrokeDasharray !== "0"
            ? ` stroke-dasharray="${escapeAttr(element.borderStrokeDasharray)}"`
            : "";
        const svgWidth = Math.max(width, 1);
        const svgHeight = Math.max(height, 1);
        wrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="${vb.x} ${vb.y} ${Math.max(vb.width, 0.01)} ${Math.max(vb.height, 0.01)}" preserveAspectRatio="none"><defs>${defs.join("")}</defs><path d="${escapeAttr(element.path!)}" fill="${fill}" stroke="${stroke ?? "none"}" stroke-width="${lineWidth}" vector-effect="non-scaling-stroke"${dash}${markerStart ? ` marker-start="url(#${markerStart})"` : ""}${markerEnd ? ` marker-end="url(#${markerEnd})"` : ""}/></svg>`;
        // Keep stroke widths in points even though the path uses its own units.
        const pathNode = wrapper.querySelector("path");
        if (pathNode) pathNode.setAttribute("stroke-width", String(px(lineWidth)));
      } else {
        const background = fillCss(element.fill);
        if (background) wrapper.style.background = background;
        if (stroke)
          wrapper.style.border = `${px(element.borderWidth)}px ${element.borderType || "solid"} ${stroke}`;
      }
      renderText(env, wrapper, element, width, height);
      if (element.link && /^(https?:|mailto:)/i.test(element.link)) {
        const anchor = doc.createElement("a");
        anchor.href = element.link;
        Object.assign(anchor.style, { position: "absolute", inset: "0" });
        wrapper.appendChild(anchor);
      }
      break;
    }
    case "image": {
      if (!element.base64) break;
      const frame = doc.createElement("div");
      Object.assign(frame.style, { position: "absolute", inset: "0", overflow: "hidden" });
      if (element.geom === "ellipse") frame.style.borderRadius = "50%";
      else if (element.geom === "roundRect") frame.style.borderRadius = "8%";
      const image = doc.createElement("img");
      image.src = element.base64;
      image.alt = "";
      const crop = element.rect ?? {};
      const l = (crop.l ?? 0) / 100;
      const r = (crop.r ?? 0) / 100;
      const t = (crop.t ?? 0) / 100;
      const b = (crop.b ?? 0) / 100;
      const visibleW = Math.max(0.01, 1 - l - r);
      const visibleH = Math.max(0.01, 1 - t - b);
      Object.assign(image.style, {
        position: "absolute",
        left: `${(-l / visibleW) * 100}%`,
        top: `${(-t / visibleH) * 100}%`,
        width: `${100 / visibleW}%`,
        height: `${100 / visibleH}%`,
        maxWidth: "none",
      });
      const filters: string[] = [];
      if (element.filters?.brightness)
        filters.push(`brightness(${1 + element.filters.brightness / 100})`);
      if (element.filters?.contrast)
        filters.push(`contrast(${1 + element.filters.contrast / 100})`);
      if (element.filters?.saturation !== undefined)
        filters.push(`saturate(${element.filters.saturation / 100})`);
      if (filters.length) image.style.filter = filters.join(" ");
      frame.appendChild(image);
      wrapper.appendChild(frame);
      if (element.borderWidth > 0 && element.borderColor) {
        frame.style.border = `${px(element.borderWidth)}px solid ${element.borderColor}`;
        frame.style.boxSizing = "border-box";
      }
      break;
    }
    case "table": {
      const table = doc.createElement("table");
      table.className = "pp-table";
      const colgroup = doc.createElement("colgroup");
      element.colWidths.forEach((colWidth) => {
        const col = doc.createElement("col");
        col.style.width = `${px(colWidth)}px`;
        colgroup.appendChild(col);
      });
      table.appendChild(colgroup);
      table.style.width = `${px(element.colWidths.reduce((sum, value) => sum + value, 0)) || width}px`;
      const edge = (
        border: { borderColor: string; borderWidth: number; borderType: string } | undefined,
      ) =>
        border && border.borderWidth > 0
          ? `${Math.max(0.75, px(border.borderWidth))}px ${border.borderType || "solid"} ${border.borderColor}`
          : "";
      element.data.forEach((row, rowIndex) => {
        const tr = doc.createElement("tr");
        const rowHeight = element.rowHeights[rowIndex];
        if (rowHeight) tr.style.height = `${px(rowHeight)}px`;
        row.forEach((cell) => {
          if (cell.hMerge || cell.vMerge) return;
          const td = doc.createElement("td");
          if (cell.colSpan && cell.colSpan > 1) td.colSpan = cell.colSpan;
          if (cell.rowSpan && cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
          if (cell.fillColor) td.style.background = cell.fillColor;
          if (cell.fontColor) td.style.color = cell.fontColor;
          if (cell.fontBold) td.style.fontWeight = "700";
          td.style.verticalAlign =
            cell.vAlign === "mid" ? "middle" : cell.vAlign === "down" ? "bottom" : "top";
          const borders = { ...element.borders, ...cell.borders };
          td.style.borderTop = edge(borders.top);
          td.style.borderBottom = edge(borders.bottom);
          td.style.borderLeft = edge(borders.left);
          td.style.borderRight = edge(borders.right);
          td.appendChild(sanitizeHtml(doc, fixParagraphSpacing(restoreSpaces(cell.text ?? ""))));
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
      wrapper.appendChild(table);
      break;
    }
    case "chart": {
      const match = env.charts.find(
        (chart) =>
          Math.abs(chart.x - (element.left + offset.x)) < 2 &&
          Math.abs(chart.y - (element.top + offset.y)) < 2,
      );
      const model = match?.model ?? chartFromParsed(element, env.palette);
      if (model) wrapper.innerHTML = renderChartSvg(model, width, height);
      break;
    }
    case "diagram": {
      for (const childElement of element.elements) renderElement(env, wrapper, childElement);
      break;
    }
    case "math": {
      if (element.picBase64) {
        const image = doc.createElement("img");
        image.src = element.picBase64;
        Object.assign(image.style, { width: "100%", height: "100%", display: "block" });
        wrapper.appendChild(image);
      } else if (element.text) {
        wrapper.textContent = element.text;
      }
      break;
    }
    default:
      // Audio and video have no printable representation.
      return;
  }
  parent.appendChild(wrapper);
}

function chartFromParsed(
  element: Extract<Element, { type: "chart" }>,
  palette: string[],
): ChartModel | null {
  const kindMap: Record<string, ChartModel["groups"][number]["kind"]> = {
    barChart: "bar",
    bar3DChart: "bar",
    lineChart: "line",
    line3DChart: "line",
    areaChart: "area",
    area3DChart: "area",
    pieChart: "pie",
    pie3DChart: "pie",
    doughnutChart: "doughnut",
    scatterChart: "scatter",
    bubbleChart: "scatter",
    radarChart: "radar",
  };
  const kind = kindMap[element.chartType] ?? "bar";
  if (element.chartType === "scatterChart" || element.chartType === "bubbleChart") return null;
  const data = (
    element as {
      data: Array<{
        key: string;
        values: Array<{ x: string; y: number }>;
        xlabels: Record<string, string>;
      }>;
    }
  ).data;
  if (!data.length) return null;
  const first = data[0]!;
  const categories = first.values.map((value) => first.xlabels[value.x] ?? value.x);
  return {
    title: null,
    legend: data.length > 1 || kind === "pie" || kind === "doughnut" ? "b" : null,
    background: null,
    border: null,
    valueFormat: null,
    palette,
    fontFamily: "Calibri",
    fontSize: 12,
    titleSize: 16,
    groups: [
      {
        kind,
        barDir: (element as { barDir?: "bar" | "col" }).barDir === "bar" ? "bar" : "col",
        grouping: ((element as { grouping?: string }).grouping ??
          (kind === "bar" ? "clustered" : "standard")) as ChartModel["groups"][number]["grouping"],
        gapWidth: 150,
        holeSize: Number.parseInt((element as { holeSize?: string }).holeSize ?? "50", 10),
        firstSliceAngle: 0,
        varyColors: kind === "pie" || kind === "doughnut",
        showValues: false,
        showPercent: false,
        categories,
        series: data.map((series, index) => ({
          name: series.key,
          values: series.values.map((value) => (Number.isFinite(value.y) ? value.y : null)),
          color: element.colors[index] || palette[index % palette.length] || null,
          marker: kind === "line",
        })),
      },
    ],
  };
}

/** Turns bullet marker runs into aligned inline boxes, sized like PowerPoint's hanging indent. */
function finishBullets(page: HTMLElement) {
  const doc = page.ownerDocument;
  const view = doc.defaultView!;
  const walker = doc.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if ((node.nodeValue ?? "").includes(BULLET_START)) targets.push(node as Text);
  for (const node of targets) {
    const value = node.nodeValue ?? "";
    const match = new RegExp(`${BULLET_START}([^${BULLET_END}]*)${BULLET_END}(.)?`).exec(value);
    if (!match) continue;
    const pct = match[2] ? match[2].charCodeAt(0) - PCT_BASE : 100;
    const before = value.slice(0, match.index);
    const after = value.slice(match.index + match[0].length);
    const span = doc.createElement("span");
    span.className = "pp-bullet";
    span.textContent = match[1] ?? "";
    const parent = node.parentNode!;
    if (before) parent.insertBefore(doc.createTextNode(before), node);
    parent.insertBefore(span, node);
    node.nodeValue = after;
    const paragraph = span.closest("p");
    const fontSize = Number.parseFloat(view.getComputedStyle(span).fontSize) || 16;
    if (pct && pct !== 100) span.style.fontSize = `${(fontSize * pct) / 100}px`;
    const hanging = paragraph
      ? -Number.parseFloat(view.getComputedStyle(paragraph).textIndent || "0")
      : 0;
    const natural = span.getBoundingClientRect().width;
    span.style.minWidth = `${Math.max(hanging > 0 ? hanging : 0, natural + fontSize * 0.35)}px`;
  }
}

function renderNotesPage(
  doc: Document,
  slidePage: HTMLElement,
  slideSize: { width: number; height: number },
  note: string,
) {
  // Portrait notes page (7.5in × 10in), slide image on top, notes below — like PowerPoint's Notes Pages.
  const page = createPage(doc, 540, 720);
  const scale = Math.min((540 - 108) / slideSize.width, (720 * 0.45) / slideSize.height);
  const thumb = slidePage.cloneNode(true) as HTMLElement;
  thumb.classList.remove("office-page");
  Object.assign(thumb.style, {
    position: "absolute",
    left: `${px((540 - slideSize.width * scale) / 2)}px`,
    top: `${px(54)}px`,
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
    border: "1px solid #999",
    overflow: "hidden",
  });
  page.appendChild(thumb);
  const notes = doc.createElement("div");
  notes.className = "pp-notes";
  Object.assign(notes.style, {
    left: `${px(54)}px`,
    right: `${px(54)}px`,
    top: `${px(54 + slideSize.height * scale + 36)}px`,
    bottom: `${px(54)}px`,
    fontFamily: '"Calibri", "Carlito", Arial, sans-serif',
  });
  notes.appendChild(sanitizeHtml(doc, note));
  page.appendChild(notes);
  return page;
}

export async function renderPresentation(
  input: ArrayBuffer,
  host: RenderHost,
  context: RenderContext,
  options: PowerPointOptions,
  warnings: string[],
): Promise<HTMLElement[]> {
  context.progress("Reading presentation…");
  const prepared = await preparePresentation(input);
  throwIfCancelled(context);
  const { parse } = await import("pptxtojson");
  let parsed: ParsedPresentation;
  try {
    parsed = await parse(prepared.buffer, {
      imageMode: "base64",
      videoMode: "none",
      audioMode: "none",
    });
  } catch (cause) {
    console.error(cause);
    throw new OfficeError("damaged-file");
  }
  throwIfCancelled(context);

  // Put slides in presentation order and drop hidden ones.
  const byPart = new Map<string, Slide>();
  prepared.parsedOrder.forEach((part, index) => {
    const slide = parsed.slides[index];
    if (slide) byPart.set(part, slide);
  });
  const ordered: Array<{ slide: Slide; info: SlideInfo | undefined }> = [];
  for (const part of prepared.order) {
    const slide = byPart.get(part);
    const info = prepared.infos.get(part);
    if (!slide || info?.hidden) continue;
    ordered.push({ slide, info });
  }
  if (!ordered.length && parsed.slides.length) {
    parsed.slides.forEach((slide) => ordered.push({ slide, info: undefined }));
  }
  if (!ordered.length) throw new OfficeError("empty-document");
  const hiddenCount = [...prepared.infos.values()].filter((info) => info.hidden).length;
  if (hiddenCount)
    warnings.push(
      `${hiddenCount} hidden ${hiddenCount === 1 ? "slide was" : "slides were"} skipped, as in PowerPoint’s PDF export.`,
    );
  if (
    parsed.slides.some((slide) =>
      slide.elements.some((element) => element.type === "video" || element.type === "audio"),
    )
  ) {
    warnings.push("Audio and video can’t play in a PDF and were left out.");
  }

  const size = parsed.size;
  const palette = (parsed.themeColors ?? []).length
    ? parsed.themeColors
    : ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"];
  const pages: HTMLElement[] = [];
  for (let index = 0; index < ordered.length; index++) {
    throwIfCancelled(context);
    context.progress(`Laying out slide ${index + 1} of ${ordered.length}…`);
    const { slide, info } = ordered[index]!;
    const page = createPage(host.doc, size.width, size.height);
    const parsedBackground = fillCss(slide.fill as Fill);
    page.style.background = parsedBackground ?? info?.background ?? "#FFFFFF";
    const env: RenderEnv = { doc: host.doc, charts: info?.charts ?? [], palette };
    for (const element of slide.layoutElements ?? []) renderElement(env, page, element);
    for (const element of slide.elements) renderElement(env, page, element);
    host.root.appendChild(page);
    finishBullets(page);
    pages.push(page);
    if (options.notes && slide.note && slide.note.replace(/<[^>]*>/g, "").trim()) {
      const notesPage = renderNotesPage(host.doc, page, size, slide.note);
      host.root.appendChild(notesPage);
      pages.push(notesPage);
    }
    if (index % 4 === 3) await nextFrame();
  }
  await waitForAssets(host.doc);
  return pages;
}
