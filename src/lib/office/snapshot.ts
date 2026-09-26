/**
 * Fast page rasterizer. The render iframe already holds every style the pages
 * need, so a page is serialized as-is into an SVG <foreignObject> together with
 * the document's CSS (web fonts inlined as data URLs) and drawn onto a canvas.
 * This avoids copying computed styles node by node and keeps large documents fast.
 */

type FontFace = {
  families: string[];
  css: string;
  ranges: Array<[number, number]>;
  url: string | null;
};

const XHTML = "http://www.w3.org/1999/xhtml";

function parseRanges(value: string | undefined): Array<[number, number]> {
  if (!value) return [[0, 0x10ffff]];
  return value.split(",").map((part) => {
    const [start, end] = part.trim().replace(/^U\+/i, "").split("-");
    const a = Number.parseInt(start ?? "0", 16);
    const b = end ? Number.parseInt(end, 16) : a;
    return [a, b] as [number, number];
  });
}

export class PageSnapshotter {
  private readonly faces: FontFace[] = [];
  private readonly dataUrls = new Map<string, Promise<string | null>>();
  private readonly baseCss: string;

  constructor(private readonly doc: Document) {
    const cssParts: string[] = [];
    doc.querySelectorAll("style").forEach((style) => {
      const text = style.textContent ?? "";
      if (style.dataset["officeFonts"]) {
        for (const block of text.match(/@font-face\s*{[^}]*}/g) ?? []) {
          const family = /font-family:\s*['"]?([^;'"]+)['"]?/.exec(block)?.[1]?.trim() ?? "";
          const url = /url\(([^)]+\.woff2[^)]*)\)/.exec(block)?.[1]?.replace(/['"]/g, "") ?? null;
          this.faces.push({
            families: [family.toLowerCase()],
            css: block,
            ranges: parseRanges(/unicode-range:\s*([^;}]+)/.exec(block)?.[1]),
            url,
          });
        }
      } else {
        cssParts.push(text);
      }
    });
    this.baseCss = cssParts.join("\n").replace(/@media print\s*{[\s\S]*?}\s*}/g, "");
  }

  private fontData(url: string) {
    let pending = this.dataUrls.get(url);
    if (!pending) {
      pending = fetch(new URL(url, this.doc.baseURI || location.href).href)
        .then((response) => (response.ok ? response.blob() : null))
        .then(
          (blob) =>
            blob &&
            new Promise<string | null>((resolve) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve(typeof reader.result === "string" ? reader.result : null);
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(blob);
            }),
        )
        .catch(() => null);
      this.dataUrls.set(url, pending);
    }
    return pending;
  }

  /** @font-face rules (with inlined data) for the families and characters used on a page. */
  private async fontCss(page: HTMLElement) {
    const view = this.doc.defaultView!;
    const families = new Set<string>();
    const seen = new Set<string>();
    const elements = [page, ...page.querySelectorAll<HTMLElement>("*")];
    for (const element of elements) {
      const stack = view.getComputedStyle(element).fontFamily;
      if (seen.has(stack)) continue;
      seen.add(stack);
      stack.split(",").forEach((name) =>
        families.add(
          name
            .trim()
            .replace(/^['"]|['"]$/g, "")
            .toLowerCase(),
        ),
      );
    }
    const codes = new Set<number>();
    for (const char of page.textContent ?? "") codes.add(char.codePointAt(0) ?? 0);
    const needed = this.faces.filter(
      (face) =>
        face.url &&
        face.families.some((family) => families.has(family)) &&
        [...codes].some((code) => face.ranges.some(([a, b]) => code >= a && code <= b)),
    );
    const rules = await Promise.all(
      needed.map(async (face) => {
        const data = await this.fontData(face.url!);
        if (!data) return "";
        return face.css.replace(/src:[^;]+;/, (src) => {
          const locals = (src.match(/local\([^)]*\)/g) ?? []).join(", ");
          return `src: ${locals ? `${locals}, ` : ""}url(${data}) format("woff2");`;
        });
      }),
    );
    return rules.join("\n");
  }

  async render(page: HTMLElement, scale: number): Promise<HTMLCanvasElement> {
    const width = page.offsetWidth;
    const height = page.offsetHeight;
    const fonts = await this.fontCss(page);
    const markup = new XMLSerializer().serializeToString(page);
    const css = `${fonts}\n${this.baseCss}\n.office-snapshot{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;font-family:"Calibri","Carlito",Arial,sans-serif;color:#000;background:#fff}`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width * scale)}" height="${Math.ceil(height * scale)}" viewBox="0 0 ${width} ${height}">` +
      `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
      `<div xmlns="${XHTML}" class="office-snapshot"><style><![CDATA[${css.replace(/]]>/g, "]]]]><![CDATA[>")}]]></style>${markup}</div>` +
      `</foreignObject></svg>`;
    const image = new Image();
    image.decoding = "sync";
    // A data: URL keeps the canvas origin-clean (blob: SVGs with foreignObject taint it).
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("snapshot-failed"));
        image.src = url;
      });
      try {
        await image.decode();
      } catch {
        /* already decoded */
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(width * scale);
      canvas.height = Math.ceil(height * scale);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("snapshot-failed");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      // Reading one pixel throws if the canvas is tainted, so fall back early.
      context.getImageData(0, 0, 1, 1);
      return canvas;
    } finally {
      image.src = "";
    }
  }
}
