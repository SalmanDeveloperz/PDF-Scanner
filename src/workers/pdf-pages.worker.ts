import { degrees, PDFDocument } from "pdf-lib";
import {
  PDF_PAGE_LIMITS,
  parsePageRanges,
  parsePageSelection,
  type PdfPageWorkerRequest,
  type PdfPageWorkerResponse,
} from "@/lib/pdf-pages";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<PdfPageWorkerRequest>) => void) | null;
  postMessage(message: PdfPageWorkerResponse, transfer?: Transferable[]): void;
};

function getErrorCode(cause: unknown) {
  const message = cause instanceof Error ? cause.message.toLowerCase() : "processing-failed";
  if (message.includes("wrong-type")) return "wrong-type";
  if (message.includes("empty-file")) return "empty-file";
  if (message.includes("input-too-large")) return "input-too-large";
  if (message.includes("total-input-too-large")) return "total-input-too-large";
  if (message.includes("too-many-files")) return "too-many-files";
  if (message.includes("not-enough-files")) return "not-enough-files";
  if (message.includes("too-many-pages")) return "too-many-pages";
  if (message.includes("empty-document")) return "empty-document";
  if (message.includes("invalid-selection")) return "invalid-selection";
  if (message.includes("page-out-of-range")) return "page-out-of-range";
  if (message.includes("overlapping-ranges")) return "overlapping-ranges";
  if (message.includes("too-many-ranges")) return "too-many-ranges";
  if (message.includes("no-pages-left")) return "no-pages-left";
  if (message.includes("invalid-page-order")) return "invalid-page-order";
  if (message.includes("output-too-large")) return "output-too-large";
  if (message.includes("password") || message.includes("encrypted")) return "encrypted";
  if (
    message.includes("memory") ||
    message.includes("allocation") ||
    message.includes("array buffer") ||
    message.includes("heap out of memory")
  ) return "memory";
  if (
    message.includes("invalid pdf") ||
    message.includes("invalid object") ||
    message.includes("corrupt") ||
    message.includes("unexpected end")
  ) return "damaged-pdf";
  return "processing-failed";
}

async function loadDocument(input: ArrayBuffer) {
  const document = await PDFDocument.load(input, {
    throwOnInvalidObject: true,
    updateMetadata: false,
  });
  const pageCount = document.getPageCount();
  if (pageCount === 0) throw new Error("empty-document");
  if (pageCount > PDF_PAGE_LIMITS.pages) throw new Error("too-many-pages");
  return document;
}

function asTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

workerScope.onmessage = async (event: MessageEvent<PdfPageWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "merge") {
      if (request.files.length < 2) throw new Error("not-enough-files");
      if (request.files.length > PDF_PAGE_LIMITS.mergeFiles) throw new Error("too-many-files");
      let totalInputBytes = 0;
      for (const file of request.files) {
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
          throw new Error("wrong-type");
        }
        if (file.size === 0) throw new Error("empty-file");
        totalInputBytes += file.size;
        if (totalInputBytes > PDF_PAGE_LIMITS.inputBytes) throw new Error("total-input-too-large");
      }
      const output = await PDFDocument.create();
      let pageCount = 0;
      for (const file of request.files) {
        const source = await loadDocument(await file.arrayBuffer());
        pageCount += source.getPageCount();
        if (pageCount > PDF_PAGE_LIMITS.pages) throw new Error("too-many-pages");
        const pages = await output.copyPages(source, source.getPageIndices());
        pages.forEach((page) => output.addPage(page));
      }
      const bytes = await output.save({ useObjectStreams: true });
      if (bytes.byteLength > PDF_PAGE_LIMITS.outputBytes) throw new Error("output-too-large");
      const buffer = asTransferableBuffer(bytes);
      const response: PdfPageWorkerResponse = {
        type: "processed",
        outputs: [{ name: "merged.pdf", bytes: buffer }],
        pageCount,
      };
      workerScope.postMessage(response, [buffer]);
      return;
    }

    if (request.input.byteLength === 0) throw new Error("empty-file");
    if (request.input.byteLength > PDF_PAGE_LIMITS.inputBytes) throw new Error("input-too-large");
    const source = await loadDocument(request.input);
    if (request.type === "inspect") {
      workerScope.postMessage({ type: "inspected", pageCount: source.getPageCount() });
      return;
    }

    const sourcePages = source.getPages();
    const outputs: Array<{ name: string; bytes: ArrayBuffer }> = [];
    let totalOutputBytes = 0;
    const save = async (document: PDFDocument, name: string) => {
      const bytes = await document.save({ useObjectStreams: true });
      totalOutputBytes += bytes.byteLength;
      if (totalOutputBytes > PDF_PAGE_LIMITS.outputBytes) throw new Error("output-too-large");
      outputs.push({ name, bytes: asTransferableBuffer(bytes) });
    };
    const copyPages = async (pageIndices: number[], name: string) => {
      const output = await PDFDocument.create();
      const pages = await output.copyPages(source, pageIndices);
      for (const page of pages) output.addPage(page);
      await save(output, name);
    };

    if (request.mode === "split") {
      const ranges = parsePageRanges(request.selection ?? "", sourcePages.length);
      for (const range of ranges) {
        await copyPages(
          range,
          `pages-${range[0]! + 1}-${range[range.length - 1]! + 1}.pdf`,
        );
      }
    } else if (request.mode === "extract") {
      const indices = parsePageSelection(request.selection ?? "", sourcePages.length);
      await copyPages(indices, "extracted-pages.pdf");
    } else if (request.mode === "remove") {
      const removed = new Set(parsePageSelection(request.selection ?? "", sourcePages.length));
      const remaining = sourcePages.map((_, index) => index).filter((index) => !removed.has(index));
      if (remaining.length === 0) throw new Error("no-pages-left");
      await copyPages(remaining, "pages-removed.pdf");
    } else {
      const pageOrder = request.pageOrder ?? [];
      if (
        pageOrder.length === 0 ||
        pageOrder.length > sourcePages.length ||
        new Set(pageOrder.map(({ pageIndex }) => pageIndex)).size !== pageOrder.length ||
        pageOrder.some(
          ({ pageIndex, rotation }) =>
            !Number.isInteger(pageIndex) ||
            pageIndex < 0 ||
            pageIndex >= sourcePages.length ||
            !Number.isInteger(rotation) ||
            rotation < 0 ||
            rotation > 270 ||
            rotation % 90 !== 0,
        )
      ) {
        throw new Error("invalid-page-order");
      }
      const output = await PDFDocument.create();
      const pages = await output.copyPages(source, pageOrder.map(({ pageIndex }) => pageIndex));
      pages.forEach((page, index) => {
        output.addPage(page);
        const rotation = pageOrder[index]?.rotation ?? 0;
        const originalRotation = page.getRotation().angle;
        page.setRotation(degrees(((originalRotation + rotation) % 360 + 360) % 360));
      });
      await save(output, "organized.pdf");
    }

    if (outputs.length === 0) throw new Error("invalid-selection");
    const response: PdfPageWorkerResponse = {
      type: "processed",
      outputs,
      pageCount: sourcePages.length,
    };
    workerScope.postMessage(response, outputs.map(({ bytes }) => bytes));
  } catch (cause) {
    workerScope.postMessage({ type: "error", code: getErrorCode(cause) });
  }
};
