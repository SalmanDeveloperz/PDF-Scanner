import { PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import { PDF_METADATA_LIMITS, type PdfMetadataResponse } from "@/lib/pdf-metadata";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ input: ArrayBuffer }>) => void) | null;
  postMessage(message: PdfMetadataResponse, transfer?: Transferable[]): void;
};

workerScope.onmessage = async (event) => {
  try {
    const { input } = event.data;
    if (!input.byteLength) throw new Error("empty-file");
    if (input.byteLength > PDF_METADATA_LIMITS.inputBytes) throw new Error("input-too-large");
    const document = await PDFDocument.load(input, {
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    const pages = document.getPages();
    if (!pages.length) throw new Error("empty-document");
    if (pages.length > PDF_METADATA_LIMITS.pages) throw new Error("too-many-pages");

    const stripXmp = (dictionary: PDFDict) => {
      const metadata = dictionary.get(PDFName.of("Metadata"));
      if (metadata instanceof PDFRef) document.context.delete(metadata);
      dictionary.delete(PDFName.of("Metadata"));
    };
    const infoRef = document.context.trailerInfo.Info;
    if (infoRef instanceof PDFRef) {
      const info = document.context.lookupMaybe(infoRef, PDFDict);
      if (info) for (const key of info.keys()) info.delete(key);
      document.context.delete(infoRef);
    } else if (infoRef instanceof PDFDict) {
      for (const key of infoRef.keys()) infoRef.delete(key);
    }
    delete document.context.trailerInfo.Info;
    delete document.context.trailerInfo.ID;
    stripXmp(document.catalog);
    for (const page of pages) stripXmp(page.node);

    const output = await document.save({ useObjectStreams: true });
    if (!output.byteLength) throw new Error("empty-output");
    if (output.byteLength > PDF_METADATA_LIMITS.outputBytes) throw new Error("output-too-large");
    const bytes =
      output.byteOffset === 0 && output.byteLength === output.buffer.byteLength
        ? (output.buffer as ArrayBuffer)
        : (output.buffer.slice(
            output.byteOffset,
            output.byteOffset + output.byteLength,
          ) as ArrayBuffer);
    workerScope.postMessage({ type: "success", bytes, pages: pages.length }, [bytes]);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.toLowerCase() : "processing-failed";
    const code = message.includes("input-too-large")
      ? "input-too-large"
      : message.includes("output-too-large")
        ? "output-too-large"
        : message.includes("too-many-pages")
          ? "too-many-pages"
          : message.includes("empty-document") || message.includes("empty-file")
            ? message.includes("empty-document")
              ? "empty-document"
              : "empty-file"
            : /encrypted|password/.test(message)
              ? "encrypted"
              : /memory|allocation|array buffer|heap/.test(message)
                ? "memory"
                : /invalid pdf|invalid object|corrupt|unexpected end|xref/.test(message)
                  ? "damaged-pdf"
                  : "processing-failed";
    workerScope.postMessage({ type: "error", code });
  }
};
