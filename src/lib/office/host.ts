import { officeFontCss } from "./fonts";

export type RenderHost = {
  frame: HTMLIFrameElement;
  doc: Document;
  root: HTMLElement;
  destroy: () => void;
};

const BASE_CSS = `
html, body { margin: 0; padding: 0; background: #ffffff; }
body { font-family: "Calibri", "Carlito", Arial, sans-serif; color: #000; -webkit-font-smoothing: antialiased; }
#office-root { display: flex; flex-direction: column; align-items: flex-start; gap: 24px; padding: 0; }
.office-page { position: relative; overflow: hidden; background: #ffffff; box-sizing: border-box; flex: none; }
@media print {
  html, body { background: #ffffff; }
  #office-root { display: block; gap: 0; }
  .office-page { break-after: page; page-break-after: always; margin: 0 !important; box-shadow: none !important; }
  .office-page:last-child { break-after: auto; page-break-after: auto; }
}
`;

/**
 * Creates an off-screen, same-origin iframe. Rendering inside it keeps the site's
 * global styles (Tailwind preflight, dark theme, fonts) away from document markup,
 * while still allowing layout measurement and rasterization.
 */
export async function createRenderHost(extraCss = ""): Promise<RenderHost> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.title = "Document renderer";
  Object.assign(frame.style, {
    position: "fixed",
    left: "-30000px",
    top: "0",
    width: "2400px",
    height: "2400px",
    border: "0",
    visibility: "visible",
    pointerEvents: "none",
    opacity: "1",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    throw new Error("engine-unavailable");
  }
  doc.open();
  doc.write(
    '<!doctype html><html><head><meta charset="utf-8"><title>render</title></head><body><div id="office-root"></div></body></html>',
  );
  doc.close();
  const fonts = doc.createElement("style");
  fonts.dataset["officeFonts"] = "true";
  fonts.textContent = officeFontCss();
  doc.head.appendChild(fonts);
  const style = doc.createElement("style");
  style.dataset["office"] = "true";
  style.textContent = `${BASE_CSS}\n${extraCss}`;
  doc.head.appendChild(style);
  const root = doc.getElementById("office-root");
  if (!root) {
    frame.remove();
    throw new Error("engine-unavailable");
  }
  return {
    frame,
    doc,
    root,
    destroy: () => {
      frame.remove();
    },
  };
}

/** Adds an @page rule per page so the browser print dialog keeps each page size. */
export function preparePrintPages(host: RenderHost, pages: HTMLElement[]) {
  const rules: string[] = [];
  pages.forEach((page, index) => {
    const width = page.dataset["widthPt"];
    const height = page.dataset["heightPt"];
    if (!width || !height) return;
    const name = `office-page-${index + 1}`;
    page.style.setProperty("page", name);
    rules.push(`@page ${name} { size: ${width}pt ${height}pt; margin: 0; }`);
  });
  const style = host.doc.createElement("style");
  style.textContent = `@media print { ${rules.join("\n")} }`;
  host.doc.head.appendChild(style);
}

/** Waits for fonts and images inside the render document to finish loading. */
export async function waitForAssets(doc: Document, timeoutMs = 20_000) {
  const images = [...doc.images].filter((image) => !image.complete);
  const imageLoads = images.map(
    (image) =>
      new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      }),
  );
  const fonts = (async () => {
    try {
      // Trigger loading of every face in use, then wait for completion.
      const families = new Set<string>();
      doc.querySelectorAll<HTMLElement>("*").forEach((element) => {
        const family = doc.defaultView?.getComputedStyle(element).fontFamily;
        if (family) families.add(family);
      });
      await Promise.all(
        [...families]
          .slice(0, 200)
          .flatMap((family) =>
            ["400", "700"].flatMap((weight) =>
              ["normal", "italic"].map((style) =>
                doc.fonts.load(`${style} ${weight} 16px ${family}`, "AaЖα").catch(() => []),
              ),
            ),
          ),
      );
      await doc.fonts.ready;
    } catch {
      /* fonts are best-effort */
    }
  })();
  await Promise.race([
    Promise.all([...imageLoads, fonts]),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export const PX_PER_PT = 96 / 72;
export const PT_PER_PX = 72 / 96;

export function createPage(doc: Document, widthPt: number, heightPt: number) {
  const page = doc.createElement("div");
  page.className = "office-page";
  page.dataset["widthPt"] = String(widthPt);
  page.dataset["heightPt"] = String(heightPt);
  page.style.width = `${widthPt * PX_PER_PT}px`;
  page.style.height = `${heightPt * PX_PER_PT}px`;
  return page;
}
