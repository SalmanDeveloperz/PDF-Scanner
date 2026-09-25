import { PDFDocument, degrees } from "pdf-lib";
import { PDF_EDIT_LIMITS, type PdfEditRequest, type PdfEditResponse } from "@/lib/pdf-editing";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<PdfEditRequest>) => void) | null;
  postMessage(message: PdfEditResponse, transfer?: Transferable[]): void;
};

workerScope.onmessage = async (event: MessageEvent<PdfEditRequest>) => {
  const { mode, input, image, startPage, endPage, position, rotation } = event.data;
  try {
    const document = await PDFDocument.load(input, { throwOnInvalidObject: true });
    const pages = document.getPages();
    if (pages.length === 0) throw new Error("empty-document");
    if (pages.length > PDF_EDIT_LIMITS.pages) throw new Error("too-many-pages");
    const resolvedEndPage = endPage === 0 ? pages.length : endPage;
    if (startPage < 1 || resolvedEndPage < startPage || resolvedEndPage > pages.length) {
      throw new Error("invalid-page-range");
    }

    const imageBytes = new Uint8Array(image);
    const embedded = await document.embedPng(imageBytes);
    for (let pageIndex = startPage - 1; pageIndex < resolvedEndPage; pageIndex++) {
      const page = pages[pageIndex];
      if (!page) continue;
      const { width, height } = page.getSize();
      if (mode === "sign") {
        const maxWidth = width * 0.26;
        const maxHeight = height * 0.12;
        const scale = Math.min(maxWidth / embedded.width, maxHeight / embedded.height);
        const drawWidth = embedded.width * scale;
        const drawHeight = embedded.height * scale;
        const marginX = Math.min(36, width * 0.05);
        const marginY = Math.min(36, height * 0.05);
        const x =
          position === "left"
            ? marginX
            : position === "right"
              ? width - drawWidth - marginX
              : (width - drawWidth) / 2;
        page.drawImage(embedded, {
          x,
          y: marginY,
          width: drawWidth,
          height: drawHeight,
        });
      } else {
        const maxWidth = width * 0.6;
        const maxHeight = height * 0.22;
        const scale = Math.min(maxWidth / embedded.width, maxHeight / embedded.height);
        const drawWidth = embedded.width * scale;
        const drawHeight = embedded.height * scale;
        const centerX =
          position === "left" ? width * 0.36 : position === "right" ? width * 0.64 : width / 2;
        page.drawImage(embedded, {
          x: centerX - drawWidth / 2,
          y: height / 2 - drawHeight / 2,
          width: drawWidth,
          height: drawHeight,
          rotate: degrees(rotation),
        });
      }
    }

    const output = await document.save({ useObjectStreams: true });
    if (output.byteLength > PDF_EDIT_LIMITS.outputBytes) throw new Error("output-too-large");
    const bytes =
      output.byteOffset === 0 && output.byteLength === output.buffer.byteLength
        ? (output.buffer as ArrayBuffer)
        : (output.buffer.slice(
            output.byteOffset,
            output.byteOffset + output.byteLength,
          ) as ArrayBuffer);
    const response: PdfEditResponse = {
      type: "success",
      bytes,
      pageCount: resolvedEndPage - startPage + 1,
    };
    workerScope.postMessage(response, [bytes]);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.toLowerCase() : "processing-failed";
    let code = "processing-failed";
    if (message.includes("password") || message.includes("encrypted")) code = "password-protected";
    else if (message.includes("too-many-pages")) code = "too-many-pages";
    else if (message.includes("invalid-page-range")) code = "invalid-page-range";
    else if (message.includes("empty-document")) code = "empty-document";
    else if (message.includes("output-too-large")) code = "output-too-large";
    else if (
      message.includes("memory") ||
      message.includes("allocation") ||
      message.includes("array buffer") ||
      message.includes("heap out of memory")
    )
      code = "memory";
    else if (
      message.includes("invalid pdf") ||
      message.includes("invalid object") ||
      message.includes("corrupt")
    )
      code = "damaged-pdf";
    const response: PdfEditResponse = { type: "error", code };
    workerScope.postMessage(response);
  }
};
