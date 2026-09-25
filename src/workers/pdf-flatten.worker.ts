import { PDFDocument } from "pdf-lib";
import { PDF_OPTIMIZE_LIMITS } from "@/lib/pdf-optimize";

type Request = { input: ArrayBuffer };
type Response =
  | { type: "success"; bytes: ArrayBuffer; flattenedFields: number }
  | { type: "error"; code: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: Response, transfer?: Transferable[]): void;
};

workerScope.onmessage = async ({ data }) => {
  try {
    if (data.input.byteLength === 0) throw new Error("empty-file");
    if (data.input.byteLength > PDF_OPTIMIZE_LIMITS.inputBytes) throw new Error("input-too-large");
    const document = await PDFDocument.load(data.input, {
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    const pages = document.getPages();
    if (pages.length === 0) throw new Error("empty-document");
    if (pages.length > PDF_OPTIMIZE_LIMITS.pages) throw new Error("too-many-pages");
    const form = document.getForm();
    const flattenedFields = form.getFields().length;
    if (flattenedFields === 0) throw new Error("no-form-fields");
    form.flatten();
    const output = await document.save({ useObjectStreams: true });
    if (output.byteLength > PDF_OPTIMIZE_LIMITS.outputBytes) throw new Error("output-too-large");
    const bytes = output.buffer.slice(
      output.byteOffset,
      output.byteOffset + output.byteLength,
    ) as ArrayBuffer;
    workerScope.postMessage({ type: "success", bytes, flattenedFields }, [bytes]);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.toLowerCase() : "processing-failed";
    let code = "processing-failed";
    if (message.includes("password") || message.includes("encrypted")) code = "encrypted";
    else if (message.includes("empty-file")) code = "empty-file";
    else if (message.includes("input-too-large")) code = "input-too-large";
    else if (message.includes("output-too-large")) code = "output-too-large";
    else if (message.includes("too-many-pages")) code = "too-many-pages";
    else if (message.includes("empty-document")) code = "empty-document";
    else if (message.includes("no-form-fields")) code = "no-form-fields";
    else if (/memory|allocation|array buffer|heap out of memory/.test(message)) code = "memory";
    else if (/invalid pdf|invalid object|corrupt|unexpected end/.test(message)) code = "damaged-pdf";
    workerScope.postMessage({ type: "error", code });
  }
};
