import {
  beginText,
  clip,
  endPath,
  endText,
  fill,
  PDFDocument,
  PDFName,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  StandardFonts,
  TextRenderingMode,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import dejaVuUrl from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url";
import {
  OFFICE_LIMITS,
  OfficeError,
  nextFrame,
  throwIfCancelled,
  type RenderContext,
} from "./common";
import { PT_PER_PX } from "./host";
import { PageSnapshotter } from "./snapshot";
import { planPageText, VectorFonts, type VectorItem } from "./vector-text";

export type PdfBuildOptions = {
  dpi: number;
  title: string;
  context: RenderContext;
  /** Adds an invisible, selectable and searchable text layer. */
  textLayer?: boolean;
  /** Writes text as real vector text when an identical-metric font is available. */
  vectorText?: boolean;
  jpegQuality?: number;
};

export type PdfBuildResult = {
  bytes: Uint8Array;
  pageCount: number;
  thumbnails: string[];
};

type TextItem = { text: string; x: number; y: number; width: number; height: number };
type LinkItem = { href: string; x: number; y: number; width: number; height: number };

const THUMBNAIL_COUNT = 6;
const THUMBNAIL_WIDTH = 220;

/**
 * Converts laid-out page elements into a PDF. Every page is rasterized by the
 * browser's own layout engine (so the result matches what the browser renders),
 * then an invisible text layer and link annotations are added so the PDF stays
 * searchable, selectable, and clickable.
 */
export async function pagesToPdf(
  pages: HTMLElement[],
  options: PdfBuildOptions,
): Promise<PdfBuildResult> {
  const { context } = options;
  if (!pages.length) throw new OfficeError("empty-document");
  if (pages.length > OFFICE_LIMITS.pages) throw new OfficeError("too-many-pages");

  const pdf = await PDFDocument.create();
  pdf.setTitle(options.title);
  pdf.setCreator("PDF Scanner");
  pdf.setProducer("PDF Scanner office converter");
  const fonts = new TextFonts(pdf, await pdf.embedFont(StandardFonts.Helvetica));
  const thumbnails: string[] = [];
  const scale = options.dpi / 96;
  const snapshotter = new PageSnapshotter(pages[0]!.ownerDocument);
  const vectorFonts = new VectorFonts(pdf);
  let fastPath = true;
  let totalBytes = 0;

  for (let index = 0; index < pages.length; index++) {
    throwIfCancelled(context);
    const element = pages[index]!;
    if (index % 2 === 0 || pages.length < 20) {
      context.progress(`Creating PDF page ${index + 1} of ${pages.length}…`);
      await nextFrame();
    }

    const widthPx = element.offsetWidth;
    const heightPx = element.offsetHeight;
    const widthPt = Number(element.dataset["widthPt"]) || widthPx * PT_PER_PX;
    const heightPt = Number(element.dataset["heightPt"]) || heightPx * PT_PER_PX;
    const pixels = Math.ceil(widthPx * scale) * Math.ceil(heightPx * scale);
    if (!Number.isFinite(pixels) || pixels < 1 || pixels > OFFICE_LIMITS.pagePixels) {
      throw new OfficeError("page-too-large");
    }

    let canvas: HTMLCanvasElement | null = null;
    const hidden: Array<{ element: HTMLElement; value: string; priority: string }> = [];
    try {
      const plan = await planPageText(element, vectorFonts, options.vectorText !== false);
      if (thumbnails.length < THUMBNAIL_COUNT) {
        thumbnails.push(await makeThumbnail(element, snapshotter, fastPath));
      }
      // Text written as vector text is hidden from the page image (decorations stay).
      for (const target of plan.hide) {
        hidden.push({
          element: target,
          value: target.style.getPropertyValue("-webkit-text-fill-color"),
          priority: target.style.getPropertyPriority("-webkit-text-fill-color"),
        });
        target.style.setProperty("-webkit-text-fill-color", "transparent", "important");
      }
      canvas = await rasterize(element, snapshotter, scale, fastPath).catch(async (cause) => {
        console.warn("Fast page snapshot unavailable, using compatibility renderer.", cause);
        fastPath = false;
        return rasterize(element, snapshotter, scale, false);
      });
      restore(hidden);
      throwIfCancelled(context);
      const jpeg = await canvasToJpeg(canvas, options.jpegQuality ?? 0.9);
      totalBytes += jpeg.byteLength;
      if (totalBytes > OFFICE_LIMITS.outputBytes) throw new OfficeError("output-too-large");

      const image = await pdf.embedJpg(jpeg);
      const page = pdf.addPage([widthPt, heightPt]);
      page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
      const ratioX = widthPt / widthPx;
      const ratioY = heightPt / heightPx;
      drawVectorText(
        page,
        plan.vector,
        await resolveFonts(plan.vector, vectorFonts),
        ratioX,
        ratioY,
        heightPt,
      );
      if (options.textLayer !== false) {
        await drawTextLayer(page, plan.plain, fonts, ratioX, ratioY, heightPt);
      }
      addLinks(pdf, page, collectLinks(element), ratioX, ratioY, heightPt);
    } catch (cause) {
      if (cause instanceof OfficeError) throw cause;
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/memory|allocation|too large|canvas/i.test(message)) throw new OfficeError("memory");
      throw cause;
    } finally {
      restore(hidden);
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  }

  context.progress("Saving PDF…");
  await nextFrame();
  const bytes = await pdf.save({ useObjectStreams: true });
  if (bytes.byteLength > OFFICE_LIMITS.outputBytes) throw new OfficeError("output-too-large");
  return { bytes, pageCount: pages.length, thumbnails };
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Uint8Array>((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new OfficeError("memory"));
          return;
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      "image/jpeg",
      quality,
    ),
  );
}

function restore(hidden: Array<{ element: HTMLElement; value: string; priority: string }>) {
  for (const { element, value, priority } of hidden.splice(0)) {
    if (value) element.style.setProperty("-webkit-text-fill-color", value, priority);
    else element.style.removeProperty("-webkit-text-fill-color");
  }
}

async function rasterize(
  element: HTMLElement,
  snapshotter: PageSnapshotter,
  scale: number,
  fast: boolean,
) {
  if (fast) return snapshotter.render(element, scale);
  // Compatibility path for browsers that refuse SVG snapshots: clone styles node by node.
  const { domToCanvas } = await import("modern-screenshot");
  return domToCanvas(element, {
    scale,
    width: element.offsetWidth,
    height: element.offsetHeight,
    backgroundColor: "#ffffff",
    timeout: 30_000,
    drawImageInterval: 40,
    style: { margin: "0", boxShadow: "none" },
    features: { removeControlCharacter: false },
  });
}

async function makeThumbnail(element: HTMLElement, snapshotter: PageSnapshotter, fast: boolean) {
  try {
    const canvas = await rasterize(
      element,
      snapshotter,
      THUMBNAIL_WIDTH / Math.max(1, element.offsetWidth),
      fast,
    );
    const url = canvas.toDataURL("image/jpeg", 0.82);
    canvas.width = 0;
    canvas.height = 0;
    return url;
  } catch {
    return "";
  }
}

async function resolveFonts(items: VectorItem[], fonts: VectorFonts) {
  const map = new Map<VectorItem["variant"], PDFFont>();
  for (const item of items) {
    if (map.has(item.variant)) continue;
    const font = await fonts.font(item.variant);
    if (font) map.set(item.variant, font);
  }
  return map;
}

function drawVectorText(
  page: PDFPage,
  items: VectorItem[],
  fonts: Map<VectorItem["variant"], PDFFont>,
  ratioX: number,
  ratioY: number,
  pageHeightPt: number,
) {
  if (!items.length) return;
  const operators = [];
  for (const item of items) {
    const font = fonts.get(item.variant);
    if (!font) continue;
    const size = Math.max(0.5, item.size * ratioY);
    let natural = 0;
    try {
      natural = font.widthOfTextAtSize(item.text.trimEnd(), size);
    } catch {
      continue;
    }
    if (natural <= 0) continue;
    const squeeze = Math.max(40, Math.min(250, ((item.width * ratioX) / natural) * 100));
    const key = page.node.newFontDictionary(font.name, font.ref);
    if (item.clip) {
      operators.push(
        pushGraphicsState(),
        rectangle(
          item.clip.x * ratioX,
          pageHeightPt - (item.clip.y + item.clip.height) * ratioY,
          item.clip.width * ratioX,
          item.clip.height * ratioY,
        ),
        clip(),
        endPath(),
      );
    }
    operators.push(
      beginText(),
      setFillingRgbColor(item.color[0], item.color[1], item.color[2]),
      setFontAndSize(key, size),
      setCharacterSqueeze(squeeze),
      setTextMatrix(1, 0, 0, 1, item.x * ratioX, pageHeightPt - item.baseline * ratioY),
      showText(font.encodeText(item.text)),
      endText(),
    );
    for (const decoration of item.decorations) {
      const thickness = Math.max(0.4, size / 15);
      const baseline = pageHeightPt - item.baseline * ratioY;
      const offset =
        decoration.kind === "underline"
          ? -size * 0.12
          : decoration.kind === "line-through"
            ? size * 0.28
            : size * 0.72;
      const x1 = item.x * ratioX;
      const x2 = item.decorationEnd * ratioX;
      if (x2 <= x1) continue;
      operators.push(
        setFillingRgbColor(decoration.color[0], decoration.color[1], decoration.color[2]),
      );
      operators.push(rectangle(x1, baseline + offset - thickness / 2, x2 - x1, thickness), fill());
      if (decoration.double)
        operators.push(
          rectangle(x1, baseline + offset - thickness * 2.5, x2 - x1, thickness),
          fill(),
        );
    }
    if (item.clip) operators.push(popGraphicsState());
  }
  page.pushOperators(...operators);
}

function collectLinks(page: HTMLElement): LinkItem[] {
  const pageRect = page.getBoundingClientRect();
  const links: LinkItem[] = [];
  page.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href") ?? "";
    if (!/^(https?:|mailto:)/i.test(href)) return;
    for (const rect of anchor.getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      links.push({
        href,
        x: rect.left - pageRect.left,
        y: rect.top - pageRect.top,
        width: rect.width,
        height: rect.height,
      });
    }
  });
  return links;
}

class TextFonts {
  private unicode: PDFFont | null | undefined;
  private unicodeSet: Set<number> | null = null;
  private readonly winAnsi: Set<number>;

  constructor(
    private readonly pdf: PDFDocument,
    readonly helvetica: PDFFont,
  ) {
    this.winAnsi = new Set(helvetica.getCharacterSet());
  }

  supportsWinAnsi(text: string) {
    for (const char of text) if (!this.winAnsi.has(char.codePointAt(0) ?? 0)) return false;
    return true;
  }

  /** Lazily embeds a broad-coverage Unicode font (subset) for non-Latin text. */
  async unicodeFont() {
    if (this.unicode !== undefined) return this.unicode;
    try {
      const [{ default: fontkit }, response] = await Promise.all([
        import("@pdf-lib/fontkit"),
        fetch(dejaVuUrl),
      ]);
      if (!response.ok) throw new Error("font");
      this.pdf.registerFontkit(fontkit);
      this.unicode = await this.pdf.embedFont(await response.arrayBuffer(), { subset: true });
      this.unicodeSet = new Set(this.unicode.getCharacterSet());
    } catch {
      this.unicode = null;
    }
    return this.unicode;
  }

  filterUnicode(text: string) {
    if (!this.unicodeSet) return "";
    let out = "";
    for (const char of text) if (this.unicodeSet.has(char.codePointAt(0) ?? 0)) out += char;
    return out;
  }
}

async function drawTextLayer(
  page: PDFPage,
  items: TextItem[],
  fonts: TextFonts,
  ratioX: number,
  ratioY: number,
  pageHeightPt: number,
) {
  if (!items.length) return;
  const operators = [
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
  ];
  let currentFont: PDFFont | null = null;
  let currentSize = -1;
  for (const item of items) {
    let font: PDFFont = fonts.helvetica;
    let text = item.text;
    if (!fonts.supportsWinAnsi(text)) {
      const unicode = await fonts.unicodeFont();
      if (!unicode) continue;
      text = fonts.filterUnicode(text);
      if (!text) continue;
      font = unicode;
    }
    const heightPt = item.height * ratioY;
    const size = Math.max(1, Math.round((heightPt / 1.16) * 100) / 100);
    let natural = 0;
    try {
      natural = font.widthOfTextAtSize(text.trimEnd() || text, size);
    } catch {
      continue;
    }
    if (natural <= 0) continue;
    const squeeze = Math.max(1, Math.min(1000, ((item.width * ratioX) / natural) * 100));
    const x = item.x * ratioX;
    const baseline = pageHeightPt - (item.y + item.height) * ratioY + heightPt * 0.2;
    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    if (font !== currentFont || size !== currentSize) {
      operators.push(setFontAndSize(fontKey, size));
      currentFont = font;
      currentSize = size;
    }
    operators.push(setCharacterSqueeze(squeeze), setTextMatrix(1, 0, 0, 1, x, baseline));
    operators.push(showText(font.encodeText(text)));
  }
  operators.push(endText(), popGraphicsState());
  page.pushOperators(...operators);
}

function addLinks(
  pdf: PDFDocument,
  page: PDFPage,
  links: LinkItem[],
  ratioX: number,
  ratioY: number,
  pageHeightPt: number,
) {
  if (!links.length) return;
  const context = pdf.context;
  const annotations = links.map((link) => {
    const x1 = link.x * ratioX;
    const y1 = pageHeightPt - (link.y + link.height) * ratioY;
    const x2 = x1 + link.width * ratioX;
    const y2 = y1 + link.height * ratioY;
    return context.register(
      context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [x1, y1, x2, y2],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(link.href) },
      }),
    );
  });
  const existing = page.node.Annots();
  if (existing) annotations.forEach((ref) => existing.push(ref));
  else page.node.set(PDFName.of("Annots"), context.obj(annotations));
}
