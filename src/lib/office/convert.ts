import {
  OFFICE_LIMITS,
  OfficeError,
  QUALITY_DPI,
  QUALITY_JPEG,
  sniffOfficeBytes,
  throwIfCancelled,
  type OfficeKind,
  type OfficeQuality,
  type RenderContext,
} from "./common";
import { createRenderHost, preparePrintPages, type RenderHost } from "./host";
import { pagesToPdf } from "./rasterize";

export type ExcelOptions = {
  scope: "all" | "active";
  scaling: "fit-width" | "file" | "fit-page";
  gridlines: "file" | "on" | "off";
  orientation: "file" | "portrait" | "landscape";
};

export type PowerPointOptions = {
  notes: boolean;
};

export type OfficeConvertOptions = {
  quality: OfficeQuality;
  excel?: ExcelOptions;
  powerpoint?: PowerPointOptions;
};

export type OfficeConvertResult = {
  bytes: Uint8Array;
  pageCount: number;
  thumbnails: string[];
  warnings: string[];
  /** Kept alive so the rendered pages can be sent to the browser's print dialog. */
  host: RenderHost;
};

export async function convertOfficeFile(
  kind: OfficeKind,
  file: File,
  options: OfficeConvertOptions,
  context: RenderContext,
): Promise<OfficeConvertResult> {
  if (file.size > OFFICE_LIMITS.inputBytes) throw new OfficeError("input-too-large");
  context.progress("Reading file…");
  const input = await file.arrayBuffer();
  sniffOfficeBytes(kind, file.name, new Uint8Array(input, 0, Math.min(input.byteLength, 65536)));
  throwIfCancelled(context);

  const warnings: string[] = [];
  let host: RenderHost | null = null;
  try {
    let pages: HTMLElement[];
    if (kind === "word") {
      const { renderDocx, DOCX_EXTRA_CSS } = await import("./docx");
      host = await createRenderHost(DOCX_EXTRA_CSS);
      pages = await renderDocx(input, host, context);
    } else if (kind === "excel") {
      const { renderWorkbook, XLSX_EXTRA_CSS } = await import("./xlsx");
      host = await createRenderHost(XLSX_EXTRA_CSS);
      pages = await renderWorkbook(
        input,
        file.name,
        host,
        context,
        options.excel ?? defaultExcelOptions,
        warnings,
      );
    } else {
      const { renderPresentation, PPTX_EXTRA_CSS } = await import("./pptx");
      host = await createRenderHost(PPTX_EXTRA_CSS);
      pages = await renderPresentation(
        input,
        host,
        context,
        options.powerpoint ?? { notes: false },
        warnings,
      );
    }
    throwIfCancelled(context);
    if (!pages.length) throw new OfficeError("empty-document");
    if (pages.length > OFFICE_LIMITS.pages) throw new OfficeError("too-many-pages");
    const result = await pagesToPdf(pages, {
      dpi: QUALITY_DPI[options.quality],
      jpegQuality: QUALITY_JPEG[options.quality],
      title: file.name.replace(/\.[^.]+$/, ""),
      context,
    });
    preparePrintPages(host, pages);
    return { ...result, warnings, host };
  } catch (cause) {
    host?.destroy();
    throw cause;
  }
}

export const defaultExcelOptions: ExcelOptions = {
  scope: "all",
  scaling: "fit-width",
  gridlines: "file",
  orientation: "file",
};
