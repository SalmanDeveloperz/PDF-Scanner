import JSZip from "jszip";
import { OfficeError, nextFrame, throwIfCancelled, type RenderContext } from "./common";
import { withFontFallbacks } from "./fonts";
import { PT_PER_PX, waitForAssets, type RenderHost } from "./host";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PAGE_MARK = "\uE000";
const PAGES_MARK = "\uE001";
const CLASS = "docx";

export const DOCX_EXTRA_CSS = `
section.${CLASS} { flex: none; margin: 0 !important; background: #ffffff; }
section.${CLASS} img { max-width: none; }
section.${CLASS}, section.${CLASS} * { hyphens: manual !important; -webkit-hyphens: manual !important; }
section.${CLASS} > footer { display: flex; flex-direction: column; justify-content: flex-end; }
section.${CLASS} table { border-spacing: 0; }
`;

/**
 * Renders a DOCX file into page-sized sections inside the render host, then
 * paginates each section by measured layout so long content flows onto new
 * pages with the section's header and footer, like Word does.
 */
export async function renderDocx(
  input: ArrayBuffer,
  host: RenderHost,
  context: RenderContext,
): Promise<HTMLElement[]> {
  context.progress("Reading document…");
  const { blob: prepared, tables } = await prepareDocx(input);
  throwIfCancelled(context);

  const { renderAsync } = await import("docx-preview");
  context.progress("Laying out pages…");
  const body = host.doc.createElement("div");
  body.className = "docx-body";
  host.root.appendChild(body);
  try {
    await renderAsync(prepared, body, host.doc.head, {
      className: CLASS,
      inWrapper: false,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      experimental: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderChanges: false,
      renderComments: false,
      renderAltChunks: true,
      useBase64URL: true,
      trimXmlDeclaration: true,
      debug: false,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (/encrypt|password/i.test(message)) throw new OfficeError("encrypted");
    throw new OfficeError("damaged-file");
  }
  throwIfCancelled(context);

  applyFontFallbacks(host.doc);
  await waitForAssets(host.doc);
  // docx-preview positions tab stops after a short delay; let it finish first.
  await new Promise((resolve) => setTimeout(resolve, 650));
  await nextFrame();
  throwIfCancelled(context);

  const sections = [...body.querySelectorAll<HTMLElement>(`:scope > section.${CLASS}`)];
  if (!sections.length) throw new OfficeError("empty-document");
  annotateTables(body, tables);
  applyTableBands(body);
  freezeListMarkers(host.doc, body);
  await nextFrame();

  const pages: HTMLElement[] = [];
  for (let index = 0; index < sections.length; index++) {
    throwIfCancelled(context);
    context.progress(`Paginating section ${index + 1} of ${sections.length}…`);
    pages.push(...paginateSection(sections[index]!));
    if (pages.length > 2_000) throw new OfficeError("too-many-pages");
    if (index % 5 === 4) await nextFrame();
  }

  const total = pages.length;
  pages.forEach((page, index) => {
    replaceMarkers(page, String(index + 1), String(total));
    const heightPx = pageHeightPx(page);
    page.style.height = `${heightPx}px`;
    page.style.minHeight = `${heightPx}px`;
    page.style.overflow = "hidden";
    page.classList.add("office-page");
    page.dataset["widthPt"] = String(Math.round(page.offsetWidth * PT_PER_PX * 100) / 100);
    page.dataset["heightPt"] = String(Math.round(heightPx * PT_PER_PX * 100) / 100);
  });
  return pages;
}

/* ------------------------------------------------------------------ */
/* DOCX pre-processing                                                 */
/* ------------------------------------------------------------------ */

/**
 * Rewrites PAGE/NUMPAGES fields into markers that are filled in after
 * pagination, and unwraps other simple fields so their cached results show.
 */
async function prepareDocx(input: ArrayBuffer) {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw new OfficeError("damaged-file");
  }
  if (!zip.file("word/document.xml")) {
    if (zip.file("EncryptedPackage")) throw new OfficeError("encrypted");
    throw new OfficeError("damaged-file");
  }
  const parts = Object.keys(zip.files).filter((name) =>
    /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name),
  );
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const readXml = async (name: string) => {
    const file = zip.file(name);
    if (!file) return null;
    const xml = parser.parseFromString(await file.async("string"), "application/xml");
    return xml.getElementsByTagName("parsererror").length ? null : xml;
  };

  const numbering = await readXml("word/numbering.xml");
  if (numbering && mapSymbolBullets(numbering)) {
    zip.file("word/numbering.xml", serializer.serializeToString(numbering));
  }
  const styles = await readXml("word/styles.xml");
  const documentXml = await readXml("word/document.xml");
  let tables: TableRowInfo[][] = [];
  if (documentXml) {
    tables = [...documentXml.getElementsByTagNameNS(W_NS, "tbl")].map((table) =>
      [...table.children]
        .filter((child) => child.localName === "tr")
        .map((row) => {
          const trPr = directChild(row, "trPr");
          return {
            header: onOff(directChild(trPr, "tblHeader")) === true,
            cantSplit: onOff(directChild(trPr, "cantSplit")) === true,
          };
        }),
    );
    inheritHeadersAndFooters(documentXml);
    if (styles) applyContextualSpacing(documentXml, styles);
    rewriteFields(documentXml);
    zip.file("word/document.xml", serializer.serializeToString(documentXml));
  }
  for (const name of parts) {
    if (name === "word/document.xml") continue;
    const text = await zip.file(name)!.async("string");
    if (!/fldSimple|fldChar|lastRenderedPageBreak/.test(text)) continue;
    const xml = parser.parseFromString(text, "application/xml");
    if (xml.getElementsByTagName("parsererror").length) continue;
    rewriteFields(xml);
    zip.file(name, serializer.serializeToString(xml));
  }
  return { blob: await zip.generateAsync({ type: "blob" }), tables };
}

type TableRowInfo = { header: boolean; cantSplit: boolean };

/** Carries repeat-header-row and can't-split row settings onto rendered rows. */
function annotateTables(root: HTMLElement, tables: TableRowInfo[][]) {
  const rendered = [...root.querySelectorAll<HTMLTableElement>(`section.${CLASS} > article table`)];
  if (rendered.length !== tables.length) return;
  rendered.forEach((table, index) => {
    const info = tables[index]!;
    const rows = [...table.rows].filter((row) => row.parentElement?.closest("table") === table);
    if (rows.length !== info.length) return;
    rows.forEach((row, rowIndex) => {
      const rowInfo = info[rowIndex]!;
      if (rowInfo.header && rows.slice(0, rowIndex).every((_, i) => info[i]?.header))
        row.dataset["header"] = "true";
      if (rowInfo.cantSplit) row.dataset["cantSplit"] = "true";
    });
  });
}

/** Word lets a section reuse the previous section's headers and footers when it has none. */
function inheritHeadersAndFooters(xml: XMLDocument) {
  const inherited = new Map<string, Element>();
  for (const sectPr of [...xml.getElementsByTagNameNS(W_NS, "sectPr")]) {
    if (sectPr.parentElement?.localName === "sectPrChange") continue;
    for (const kind of ["headerReference", "footerReference"]) {
      const own = [...sectPr.getElementsByTagNameNS(W_NS, kind)];
      const ownTypes = new Set(own.map((ref) => ref.getAttributeNS(W_NS, "type") ?? "default"));
      for (const type of ["default", "first", "even"]) {
        const key = `${kind}:${type}`;
        const source = inherited.get(key);
        if (!ownTypes.has(type) && source)
          sectPr.insertBefore(source.cloneNode(true), sectPr.firstChild);
      }
      own.forEach((ref) =>
        inherited.set(`${kind}:${ref.getAttributeNS(W_NS, "type") ?? "default"}`, ref),
      );
    }
  }
}

function wAttr(element: Element | undefined | null, name: string) {
  return element?.getAttributeNS(W_NS, name) ?? element?.getAttribute(`w:${name}`) ?? null;
}

function onOff(element: Element | undefined | null) {
  if (!element) return undefined;
  const value = wAttr(element, "val");
  return value === null || !/^(0|false|off)$/i.test(value);
}

function directChild(parent: Element | null | undefined, name: string) {
  if (!parent) return undefined;
  for (const child of parent.children)
    if (child.namespaceURI === W_NS && child.localName === name) return child;
  return undefined;
}

/** Emulates "Don't add space between paragraphs of the same style" (w:contextualSpacing). */
function applyContextualSpacing(xml: XMLDocument, styles: XMLDocument) {
  const info = new Map<string, { contextual: boolean | undefined; basedOn: string | null }>();
  let defaultStyle = "";
  for (const style of [...styles.getElementsByTagNameNS(W_NS, "style")]) {
    if (wAttr(style, "type") !== "paragraph") continue;
    const id = wAttr(style, "styleId") ?? "";
    if (wAttr(style, "default") === "1" || wAttr(style, "default") === "true") defaultStyle = id;
    info.set(id, {
      contextual: onOff(directChild(directChild(style, "pPr"), "contextualSpacing")),
      basedOn: wAttr(directChild(style, "basedOn"), "val"),
    });
  }
  const resolve = (id: string) => {
    for (let current: string | null = id, depth = 0; current && depth < 20; depth++) {
      const entry = info.get(current);
      if (!entry) return false;
      if (entry.contextual !== undefined) return entry.contextual;
      current = entry.basedOn;
    }
    return false;
  };
  const styleOf = (p: Element) =>
    wAttr(directChild(directChild(p, "pPr"), "pStyle"), "val") ?? defaultStyle;
  const contextual = (p: Element) => {
    const direct = onOff(directChild(directChild(p, "pPr"), "contextualSpacing"));
    return direct ?? resolve(styleOf(p));
  };
  const setSpacing = (p: Element, attribute: "before" | "after") => {
    let pPr = directChild(p, "pPr");
    if (!pPr) {
      pPr = xml.createElementNS(W_NS, "w:pPr");
      p.insertBefore(pPr, p.firstChild);
    }
    let spacing = directChild(pPr, "spacing");
    if (!spacing) {
      spacing = xml.createElementNS(W_NS, "w:spacing");
      pPr.appendChild(spacing);
    }
    spacing.setAttributeNS(W_NS, `w:${attribute}`, "0");
    spacing.removeAttributeNS(W_NS, `${attribute}Autospacing`);
  };
  for (const p of [...xml.getElementsByTagNameNS(W_NS, "p")]) {
    const next = p.nextElementSibling;
    if (!next || next.namespaceURI !== W_NS || next.localName !== "p") continue;
    if (styleOf(p) !== styleOf(next) || !contextual(p) || !contextual(next)) continue;
    setSpacing(p, "after");
    setSpacing(next, "before");
  }
}

const SYMBOL_BULLETS: Record<number, string> = {
  0xf0b7: "\u2022",
  0xf02d: "\u2212",
  0xf0a7: "\u25aa",
  0xf0d8: "\u27a2",
  0xf076: "\u2756",
  0xf0fc: "\u2713",
  0xf06e: "\u25a0",
  0xf071: "\u2751",
  0xf075: "\u25c6",
  0xf06c: "\u25cf",
  0xf0a8: "\u25fb",
  0xf09f: "\u2022",
  0xf0e8: "\u2794",
  0xf0f0: "\u21e8",
};

/** Symbol/Wingdings bullets use private-use code points; map them to real Unicode glyphs. */
function mapSymbolBullets(xml: XMLDocument) {
  let changed = false;
  for (const level of [...xml.getElementsByTagNameNS(W_NS, "lvl")]) {
    const text = directChild(level, "lvlText");
    const value = wAttr(text, "val");
    const fonts = directChild(directChild(level, "rPr"), "rFonts");
    const fontName = wAttr(fonts, "ascii") ?? wAttr(fonts, "hAnsi") ?? "";
    if (!text || value === null) continue;
    const symbolFont = /symbol|wingdings|webdings/i.test(fontName);
    let mapped = "";
    let usedPua = false;
    for (const char of value) {
      const code = char.codePointAt(0) ?? 0;
      if (code >= 0xf000 && code <= 0xf0ff) {
        usedPua = true;
        mapped += SYMBOL_BULLETS[code] ?? "\u2022";
      } else if (symbolFont && code === 0xb7) {
        mapped += "\u2022";
      } else mapped += char;
    }
    if (!usedPua && !symbolFont) continue;
    text.setAttributeNS(W_NS, "w:val", mapped);
    if (fonts && symbolFont) {
      for (const attribute of ["ascii", "hAnsi", "cs", "eastAsia"]) {
        if (wAttr(fonts, attribute)) fonts.setAttributeNS(W_NS, `w:${attribute}`, "Arial");
      }
    }
    changed = true;
  }
  return changed;
}

function fieldMarker(instruction: string) {
  const code = instruction.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  if (code === "PAGE") return PAGE_MARK;
  if (code === "NUMPAGES" || code === "SECTIONPAGES") return PAGES_MARK;
  return null;
}

function markerRun(xml: XMLDocument, template: Element | null, marker: string) {
  const run = xml.createElementNS(W_NS, "w:r");
  const rPr = template?.getElementsByTagNameNS(W_NS, "rPr")[0];
  if (rPr) run.appendChild(rPr.cloneNode(true));
  const t = xml.createElementNS(W_NS, "w:t");
  t.textContent = marker;
  run.appendChild(t);
  return run;
}

function rewriteFields(xml: XMLDocument) {
  // Word's cached page break hints are ignored; pagination is recomputed.
  [...xml.getElementsByTagNameNS(W_NS, "lastRenderedPageBreak")].forEach((node) => node.remove());

  for (const field of [...xml.getElementsByTagNameNS(W_NS, "fldSimple")]) {
    const marker = fieldMarker(
      field.getAttributeNS(W_NS, "instr") ?? field.getAttribute("w:instr") ?? "",
    );
    const parent = field.parentNode;
    if (!parent) continue;
    if (marker) {
      const template = field.getElementsByTagNameNS(W_NS, "r")[0] ?? null;
      parent.replaceChild(markerRun(xml, template, marker), field);
    } else {
      while (field.firstChild) parent.insertBefore(field.firstChild, field);
      parent.removeChild(field);
    }
  }

  for (const paragraph of [...xml.getElementsByTagNameNS(W_NS, "p")]) {
    const runs = [...paragraph.getElementsByTagNameNS(W_NS, "r")];
    if (!runs.some((run) => run.getElementsByTagNameNS(W_NS, "fldChar").length)) continue;
    type Field = { instruction: string; separated: boolean; results: Element[]; begin: Element };
    const stack: Field[] = [];
    for (const run of runs) {
      const fldChar = run.getElementsByTagNameNS(W_NS, "fldChar")[0];
      const type =
        fldChar?.getAttributeNS(W_NS, "fldCharType") ?? fldChar?.getAttribute("w:fldCharType");
      if (type === "begin") {
        stack.push({ instruction: "", separated: false, results: [], begin: run });
        continue;
      }
      const top = stack[stack.length - 1];
      if (!top) continue;
      if (type === "separate") {
        top.separated = true;
        continue;
      }
      if (type === "end") {
        stack.pop();
        const marker = fieldMarker(top.instruction);
        if (!marker || stack.length) continue;
        const withText = top.results.filter(
          (item) => item.getElementsByTagNameNS(W_NS, "t").length,
        );
        const first = withText[0];
        if (first) {
          const texts = [...first.getElementsByTagNameNS(W_NS, "t")];
          texts.forEach((t, index) => {
            if (index === 0) t.textContent = marker;
            else t.remove();
          });
          withText
            .slice(1)
            .forEach((item) =>
              [...item.getElementsByTagNameNS(W_NS, "t")].forEach((t) => t.remove()),
            );
        } else {
          run.parentNode?.insertBefore(markerRun(xml, top.begin, marker), run);
        }
        continue;
      }
      const instr = run.getElementsByTagNameNS(W_NS, "instrText")[0];
      if (instr && !top.separated) top.instruction += instr.textContent ?? "";
      else if (top.separated && stack.length === 1) top.results.push(run);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rendered DOM post-processing                                        */
/* ------------------------------------------------------------------ */

/** Word's "at least" line spacing: the larger of single spacing and the given height. */
function fixCss(css: string) {
  return withFontFallbacks(css).replace(
    /line-height\s*:\s*calc\(100% \+ ([\d.]+)pt\)/g,
    (_match, value: string) => `line-height: max(1.2em, ${value}pt)`,
  );
}

function applyFontFallbacks(doc: Document) {
  doc.querySelectorAll("style").forEach((style) => {
    if (
      style.textContent &&
      !style.dataset["office"] &&
      !style.dataset["officeFonts"] &&
      /font-family|line-height/i.test(style.textContent)
    ) {
      style.textContent = fixCss(style.textContent);
    }
  });
  doc
    .querySelectorAll<HTMLElement>(
      `section.${CLASS} [style*="font-family"], section.${CLASS} [style*="line-height"]`,
    )
    .forEach((element) =>
      element.setAttribute("style", fixCss(element.getAttribute("style") ?? "")),
    );
}

/** Adds conditional-format classes (header row, banding) when the file lacks w:cnfStyle hints. */
function applyTableBands(root: HTMLElement) {
  root.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    const rows = [...table.rows].filter((row) => row.parentElement?.closest("table") === table);
    if (!rows.length || rows.some((row) => /(first|last|odd|even)-row/.test(row.className))) return;
    const has = (name: string) => table.classList.contains(name);
    const headerRows = has("first-row") ? 1 : 0;
    rows.forEach((row, index) => {
      if (index === 0 && has("first-row")) row.classList.add("first-row");
      if (index === rows.length - 1 && has("last-row")) row.classList.add("last-row");
      const band = index - headerRows;
      if (band >= 0 && !(index === rows.length - 1 && has("last-row"))) {
        row.classList.add(band % 2 === 0 ? "odd-row" : "even-row");
      }
      const cells = [...row.cells];
      if (cells.some((cell) => /(first|last|odd|even)-col/.test(cell.className))) return;
      const headerCols = has("first-col") ? 1 : 0;
      cells.forEach((cell, cellIndex) => {
        if (cellIndex === 0 && has("first-col")) cell.classList.add("first-col");
        if (cellIndex === cells.length - 1 && has("last-col")) cell.classList.add("last-col");
        const colBand = cellIndex - headerCols;
        if (colBand >= 0) cell.classList.add(colBand % 2 === 0 ? "odd-col" : "even-col");
      });
    });
  });
}

type CounterTemplate = Array<{ text: string } | { counter: string; style: string }>;

function parseCssContent(value: string): CounterTemplate | null {
  const tokens: CounterTemplate = [];
  let index = 0;
  while (index < value.length) {
    const char = value[index]!;
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (char === '"' || char === "'") {
      let text = "";
      index++;
      while (index < value.length && value[index] !== char) {
        if (value[index] === "\\") {
          const hex = /^[0-9a-fA-F]{1,6} ?/.exec(value.slice(index + 1));
          if (hex) {
            text += String.fromCodePoint(Number.parseInt(hex[0].trim(), 16));
            index += 1 + hex[0].length;
          } else {
            text += value[index + 1] ?? "";
            index += 2;
          }
          continue;
        }
        text += value[index];
        index++;
      }
      index++;
      tokens.push({ text });
      continue;
    }
    const match = /^counter\(\s*([\w-]+)\s*(?:,\s*([\w-]+)\s*)?\)/.exec(value.slice(index));
    if (match) {
      tokens.push({ counter: match[1]!, style: match[2] ?? "decimal" });
      index += match[0].length;
      continue;
    }
    return null;
  }
  return tokens;
}

function toRoman(value: number) {
  if (value <= 0 || value >= 4000) return String(value);
  const numerals: Array<[number, string]> = [
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
  for (const [amount, numeral] of numerals)
    while (value >= amount) {
      out += numeral;
      value -= amount;
    }
  return out;
}

function toAlpha(value: number) {
  if (value <= 0) return String(value);
  let out = "";
  while (value > 0) {
    value--;
    out = String.fromCharCode(97 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return out;
}

function formatCounter(value: number, style: string) {
  switch (style) {
    case "lower-roman":
      return toRoman(value);
    case "upper-roman":
      return toRoman(value).toUpperCase();
    case "lower-alpha":
    case "lower-latin":
      return toAlpha(value);
    case "upper-alpha":
    case "upper-latin":
      return toAlpha(value).toUpperCase();
    case "decimal-leading-zero":
      return value < 10 && value >= 0 ? `0${value}` : String(value);
    case "none":
      return "";
    case "disc":
      return "\u2022";
    default:
      return String(value);
  }
}

function parseCounterList(value: string) {
  const out: Array<[string, number]> = [];
  const pattern = /([\w-]+)(?:\s+(-?\d+))?/g;
  if (!value || value === "none") return out;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    out.push([match[1]!, Number(match[2] ?? 0)]);
  }
  return out;
}

/**
 * Replaces list numbering generated with CSS counters by real text. Counters in
 * pseudo-elements do not survive rasterization, and real text also keeps
 * numbering correct when paragraphs move to later pages.
 */
function freezeListMarkers(doc: Document, root: HTMLElement) {
  const before = new Map<string, { content: string; increment: string }>();
  const sets = new Map<string, string>();
  const counters = new Map<string, number>();
  for (const sheet of [...doc.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of [...rules]) {
      if (!(rule instanceof (doc.defaultView as unknown as typeof globalThis).CSSStyleRule))
        continue;
      const styleRule = rule as CSSStyleRule;
      for (const selector of styleRule.selectorText.split(",")) {
        const trimmed = selector.trim();
        const pseudo = /^p\.([\w-]+-num-\d+-\d+)::?before$/.exec(trimmed);
        if (pseudo) {
          before.set(pseudo[1]!, {
            content: styleRule.style.getPropertyValue("content"),
            increment: styleRule.style.getPropertyValue("counter-increment"),
          });
          continue;
        }
        const plain = /^p\.([\w-]+-num-\d+-\d+)$/.exec(trimmed);
        const counterSet = styleRule.style.getPropertyValue("counter-set");
        if (plain && counterSet) sets.set(plain[1]!, `${sets.get(plain[1]!) ?? ""} ${counterSet}`);
        if (trimmed === ":root" || trimmed === "html") {
          parseCounterList(styleRule.style.getPropertyValue("counter-reset")).forEach(
            ([name, value]) => counters.set(name, value),
          );
        }
      }
    }
  }
  if (!before.size) return;
  const view = doc.defaultView!;
  const frozen = doc.createElement("style");
  frozen.dataset["office"] = "true";
  frozen.textContent =
    "p.docx-marker-frozen::before, p.docx-marker-frozen:before { content: none !important; display: none !important; }";
  doc.head.appendChild(frozen);
  const paragraphs = [...root.querySelectorAll<HTMLElement>("p")].filter((p) =>
    [...p.classList].some((name) => /-num-\d+-\d+$/.test(name)),
  );
  const pending: Array<{ p: HTMLElement; span: HTMLElement }> = [];
  for (const p of paragraphs) {
    const numClass = [...p.classList].find((name) => /-num-\d+-\d+$/.test(name))!;
    parseCounterList(sets.get(numClass) ?? "").forEach(([name, value]) =>
      counters.set(name, value),
    );
    const rule = before.get(numClass);
    if (!rule) continue;
    parseCounterList(rule.increment).forEach(([name, value]) =>
      counters.set(name, (counters.get(name) ?? 0) + (/\d/.test(rule.increment) ? value : 1)),
    );
    const template = parseCssContent(rule.content);
    if (!template) continue;
    let text = template
      .map((token) =>
        "text" in token ? token.text : formatCounter(counters.get(token.counter) ?? 0, token.style),
      )
      .join("");
    const pseudo = view.getComputedStyle(p, "::before");
    const endsWithTab = /\t$/.test(text);
    text = text.replace(/\t$/, "");
    text = [...text]
      .map((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code >= 0xf000 && code <= 0xf0ff ? (SYMBOL_BULLETS[code] ?? "\u2022") : char;
      })
      .join("");
    const span = doc.createElement("span");
    span.className = "docx-list-marker";
    span.textContent = text;
    span.style.whiteSpace = "pre";
    span.style.display = "inline-block";
    span.style.textIndent = "0";
    span.style.fontFamily = pseudo.fontFamily;
    span.style.fontSize = pseudo.fontSize;
    span.style.fontWeight = pseudo.fontWeight;
    span.style.fontStyle = pseudo.fontStyle;
    span.style.color = pseudo.color;
    span.dataset["tab"] = endsWithTab ? "1" : "0";
    pending.push({ p, span });
  }
  for (const { p, span } of pending) {
    p.insertBefore(span, p.firstChild);
    p.classList.add("docx-marker-frozen");
  }
  // Size markers so text starts at the hanging indent, like a Word tab after the number.
  for (const { p, span } of pending) {
    if (span.dataset["tab"] !== "1") continue;
    const hanging = -Number.parseFloat(view.getComputedStyle(p).textIndent || "0");
    const natural = span.getBoundingClientRect().width;
    const tab = 48; // Word's default 0.5in tab stop in CSS pixels.
    let width = hanging > 0 ? hanging : 48;
    while (width < natural + 2) width += tab;
    span.style.minWidth = `${width}px`;
  }
}

function replaceMarkers(page: HTMLElement, pageNumber: string, total: string) {
  const walker = page.ownerDocument.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? "";
    if (value.includes(PAGE_MARK) || value.includes(PAGES_MARK)) {
      node.nodeValue = value.split(PAGE_MARK).join(pageNumber).split(PAGES_MARK).join(total);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

function px(value: string | null | undefined) {
  const number = Number.parseFloat(value ?? "");
  return Number.isFinite(number) ? number : 0;
}

function pageHeightPx(section: HTMLElement) {
  const stored = Number(section.dataset["pageHeightPx"]);
  if (stored > 0) return stored;
  const style = section.ownerDocument.defaultView!.getComputedStyle(section);
  const height = px(style.minHeight) || 1056;
  section.dataset["pageHeightPx"] = String(height);
  return height;
}

/** Bottom limit (relative to the section's top edge) available to body text. */
function contentLimit(section: HTMLElement) {
  const view = section.ownerDocument.defaultView!;
  const style = view.getComputedStyle(section);
  let reserved = px(style.paddingBottom);
  for (const child of section.children) {
    if (
      child.tagName === "FOOTER" ||
      (child.tagName === "OL" && child !== section.firstElementChild && isNotes(child))
    ) {
      const childStyle = view.getComputedStyle(child);
      reserved +=
        (child as HTMLElement).offsetHeight +
        px(childStyle.marginTop) +
        px(childStyle.marginBottom);
    }
  }
  return pageHeightPx(section) - reserved;
}

function isNotes(element: Element) {
  return /footnote|endnote/i.test(element.className) || element.tagName === "OL";
}

function articlesOf(section: HTMLElement) {
  return [...section.children].filter((child): child is HTMLElement => child.tagName === "ARTICLE");
}

function overflows(section: HTMLElement) {
  return (
    section.scrollHeight > pageHeightPx(section) + 1 ||
    section.offsetHeight > pageHeightPx(section) + 1
  );
}

function cloneShell(section: HTMLElement) {
  const clone = section.cloneNode(false) as HTMLElement;
  for (const child of section.children) {
    if (child.tagName === "HEADER" || child.tagName === "FOOTER") {
      clone.appendChild(child.cloneNode(true));
    } else if (child.tagName === "ARTICLE" && !clone.querySelector(":scope > article")) {
      clone.appendChild(child.cloneNode(false));
    }
  }
  // Keep header before article and footer last.
  const article = clone.querySelector(":scope > article");
  const footer = clone.querySelector(":scope > footer");
  if (article && footer) clone.insertBefore(article, footer);
  return clone;
}

function isHeading(element: Element | null) {
  if (!element || element.tagName !== "P") return false;
  return (
    /(heading|title|subtitle|caption)/i.test(element.className) || /^H[1-6]$/.test(element.tagName)
  );
}

function paginateSection(section: HTMLElement): HTMLElement[] {
  const pages = [section];
  pageHeightPx(section);
  let current = section;
  for (let guard = 0; guard < 1_000 && overflows(current); guard++) {
    const next = splitPage(current);
    if (!next) break;
    current.after(next);
    // The shell copies data attributes, including the page height.
    pages.push(next);
    current = next;
  }
  // Footnotes/endnotes that were rendered at the end of the original section
  // stay with the section's last page.
  const notes = [...section.children].filter((child) => child.tagName === "OL");
  if (pages.length > 1 && notes.length) {
    const last = pages[pages.length - 1]!;
    const footer = last.querySelector(":scope > footer");
    notes.forEach((note) => last.insertBefore(note, footer));
  }
  return pages;
}

/** Moves the overflowing tail of `section` to a new page. Returns the new page. */
function splitPage(section: HTMLElement): HTMLElement | null {
  const top = section.getBoundingClientRect().top;
  const limit = top + contentLimit(section);
  const articles = articlesOf(section);
  for (let articleIndex = 0; articleIndex < articles.length; articleIndex++) {
    const article = articles[articleIndex]!;
    const blocks = [...article.children] as HTMLElement[];
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index]!;
      const rect = block.getBoundingClientRect();
      if (rect.height === 0 && rect.width === 0) continue;
      if (rect.bottom <= limit + 0.5) continue;

      const next = cloneShell(section);
      const nextArticle = next.querySelector<HTMLElement>(":scope > article")!;
      // Try to split this block so part of it stays on the current page.
      const isFirstOnPage = articleIndex === 0 && index === 0;
      const remainder = splitBlock(block, limit, isFirstOnPage);
      let moveFrom = index;
      if (remainder) {
        nextArticle.appendChild(remainder);
        moveFrom = index + 1;
      } else if (isFirstOnPage) {
        // A single unsplittable block taller than the page: keep it (clipped) and move on.
        moveFrom = index + 1;
      } else {
        // Keep headings with the paragraph that follows them.
        while (moveFrom > 0 && isHeading(blocks[moveFrom - 1] ?? null) && moveFrom - 1 > 0)
          moveFrom--;
      }
      const moving = blocks.slice(moveFrom);
      if (!moving.length && !remainder && articles.length === articleIndex + 1) return null;
      moving.forEach((child) => nextArticle.appendChild(child));
      // Later articles on the same page (continuous section breaks) move too.
      articles.slice(articleIndex + 1).forEach((later) => {
        const footer = next.querySelector(":scope > footer");
        next.insertBefore(later, footer);
      });
      if (!nextArticle.children.length && articles.length === articleIndex + 1) return null;
      return next;
    }
  }
  return null;
}

/** Splits a block at the page limit. Returns the part that must move, or null. */
function splitBlock(block: HTMLElement, limit: number, isFirstOnPage: boolean): HTMLElement | null {
  if (block.tagName === "TABLE") return splitTable(block as HTMLTableElement, limit, isFirstOnPage);
  if (block.tagName === "P") return splitParagraph(block, limit, isFirstOnPage);
  if (/^(DIV|SECTION|UL|OL|BLOCKQUOTE)$/.test(block.tagName) && block.children.length > 1) {
    const moved = splitChildren(block, limit, isFirstOnPage);
    if (!moved.length) return null;
    const clone = block.cloneNode(false) as HTMLElement;
    moved.forEach((node) => clone.appendChild(node));
    return clone;
  }
  return null;
}

/**
 * Splits the children of a container (a table cell or generic block) at the
 * limit. Returns nodes to move to the continuation container, in order.
 */
function splitChildren(container: HTMLElement, limit: number, allowFirst: boolean): HTMLElement[] {
  const children = [...container.children] as HTMLElement[];
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    const rect = child.getBoundingClientRect();
    if ((rect.width === 0 && rect.height === 0) || rect.bottom <= limit + 0.5) continue;
    const first = index === 0;
    const remainder = splitBlock(child, limit, first && allowFirst);
    if (remainder) return [remainder, ...children.slice(index + 1)];
    if (first) return children.slice(1);
    return children.slice(index);
  }
  return [];
}

/** Lets a table row break across pages (Word's default) by splitting each cell. */
function splitRow(row: HTMLTableRowElement, limit: number): HTMLTableRowElement | null {
  const rect = row.getBoundingClientRect();
  if (rect.top > limit - 12) return null;
  const continuation = row.cloneNode(false) as HTMLTableRowElement;
  let movedAny = false;
  for (const cell of [...row.cells]) {
    const clone = cell.cloneNode(false) as HTMLTableCellElement;
    clone.removeAttribute("rowspan");
    const moved = splitChildren(cell, limit, true);
    if (moved.length) movedAny = true;
    moved.forEach((node) => clone.appendChild(node));
    continuation.appendChild(clone);
  }
  return movedAny ? continuation : null;
}

function splitTable(table: HTMLTableElement, limit: number, isFirstOnPage: boolean) {
  const rows = [...table.rows].filter((row) => row.parentElement?.closest("table") === table);
  if (!rows.length) return null;
  const headerRows: HTMLTableRowElement[] = [];
  for (const row of rows) {
    if (row.parentElement?.tagName === "THEAD" || row.dataset["header"] === "true")
      headerRows.push(row);
    else break;
  }
  let splitIndex = rows.findIndex((row) => row.getBoundingClientRect().bottom > limit + 0.5);
  if (splitIndex < 0) return null;
  // Rows may break across pages unless marked "can't split".
  const overflowing = rows[splitIndex]!;
  const partial = overflowing.dataset["cantSplit"] === "true" ? null : splitRow(overflowing, limit);
  if (partial && splitIndex >= headerRows.length) {
    const clone = table.cloneNode(false) as HTMLTableElement;
    table
      .querySelectorAll(":scope > colgroup")
      .forEach((group) => clone.appendChild(group.cloneNode(true)));
    if (headerRows.length) {
      const head = table.ownerDocument.createElement("thead");
      headerRows.forEach((row) => head.appendChild(row.cloneNode(true)));
      clone.appendChild(head);
    }
    const body = table.ownerDocument.createElement("tbody");
    body.appendChild(partial);
    rows.slice(splitIndex + 1).forEach((row) => body.appendChild(row));
    clone.appendChild(body);
    return clone;
  }
  if (splitIndex <= headerRows.length) {
    if (!isFirstOnPage) return null;
    splitIndex = Math.max(headerRows.length + 1, 1);
    if (splitIndex >= rows.length) return null;
  }
  const clone = table.cloneNode(false) as HTMLTableElement;
  table
    .querySelectorAll(":scope > colgroup")
    .forEach((group) => clone.appendChild(group.cloneNode(true)));
  if (headerRows.length) {
    const head = table.ownerDocument.createElement("thead");
    headerRows.forEach((row) => head.appendChild(row.cloneNode(true)));
    clone.appendChild(head);
  }
  const body = table.ownerDocument.createElement("tbody");
  rows.slice(splitIndex).forEach((row) => body.appendChild(row));
  clone.appendChild(body);
  return clone;
}

function splitParagraph(paragraph: HTMLElement, limit: number, isFirstOnPage: boolean) {
  const doc = paragraph.ownerDocument;
  const range = doc.createRange();
  const lineTops: number[] = [];
  let split: { node: Text; offset: number } | null = null;
  const walker = doc.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  outer: for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    const text = node.nodeValue ?? "";
    if (!text.length) continue;
    range.selectNodeContents(node);
    const whole = range.getBoundingClientRect();
    if (whole.height === 0) continue;
    if (whole.bottom <= limit + 0.5) {
      for (const rect of range.getClientRects())
        if (!lineTops.some((t) => Math.abs(t - rect.top) < 2)) lineTops.push(rect.top);
      continue;
    }
    for (let offset = 0; offset < text.length; offset++) {
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect();
      if (rect.height === 0) continue;
      if (rect.bottom > limit + 0.5) {
        split = { node, offset };
        break outer;
      }
      if (!lineTops.some((t) => Math.abs(t - rect.top) < 2)) lineTops.push(rect.top);
    }
  }
  // Widow/orphan control: keep at least two lines together unless the paragraph starts the page.
  const minimumLines = isFirstOnPage ? 1 : 2;
  if (!split || lineTops.length < minimumLines) {
    range.detach();
    return null;
  }
  // Avoid splitting in the middle of a word.
  const { node } = split;
  let { offset } = split;
  const value = node.nodeValue ?? "";
  while (offset > 0 && !/\s/.test(value[offset - 1] ?? " ")) offset--;
  if (offset === 0 && node === firstTextNode(paragraph)) {
    range.detach();
    return null;
  }
  range.setStart(node, offset);
  range.setEndAfter(paragraph.lastChild!);
  const fragment = range.extractContents();
  range.detach();
  const continuation = paragraph.cloneNode(false) as HTMLElement;
  continuation.appendChild(fragment);
  continuation.style.textIndent = "0";
  continuation.style.marginTop = "0";
  continuation.style.paddingTop = "0";
  [...continuation.classList].forEach((name) => {
    if (/-num-/.test(name)) continuation.classList.remove(name);
  });
  paragraph.style.marginBottom = "0";
  paragraph.style.paddingBottom = "0";
  // Trim trailing whitespace-only text that could create an empty last line.
  if (!continuation.textContent?.trim() && !continuation.querySelector("img,svg")) return null;
  return continuation;
}

function firstTextNode(root: HTMLElement) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node.nodeValue) return node;
  return null;
}
