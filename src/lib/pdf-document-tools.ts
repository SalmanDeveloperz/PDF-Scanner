import { PDF_PAGE_LIMITS } from "@/lib/pdf-pages";

export const PDF_DOCUMENT_TOOL_LIMITS = {
  inputBytes: PDF_PAGE_LIMITS.inputBytes,
  outputBytes: PDF_PAGE_LIMITS.outputBytes,
  pages: PDF_PAGE_LIMITS.pages,
  editItems: 500,
  timeoutMs: PDF_PAGE_LIMITS.timeoutMs,
  previewPixels: 3_000_000,
} as const;

export type PdfMarkup = {
  id: number;
  pageIndex: number;
  type: "text" | "note" | "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  fontSize: number;
};

export type CropMargins = { top: number; right: number; bottom: number; left: number };
export type PageNumberStyle = "number" | "page" | "of";

export type PdfDocumentToolRequest =
  | { type: "save"; mode: "edit"; input: ArrayBuffer; items: PdfMarkup[] }
  | {
      type: "save";
      mode: "page-numbers";
      input: ArrayBuffer;
      startNumber: number;
      style: PageNumberStyle;
      color: string;
      fontSize: number;
    }
  | { type: "save"; mode: "crop"; input: ArrayBuffer; margins: CropMargins };

export type PdfDocumentToolResponse =
  { type: "success"; bytes: ArrayBuffer; pageCount: number } | { type: "error"; code: string };

export function pdfDocumentToolError(code: string) {
  switch (code) {
    case "wrong-type":
      return "Choose a PDF file ending in .pdf.";
    case "empty-file":
      return "This file is empty. Choose a valid PDF.";
    case "input-too-large":
      return `This PDF exceeds the ${formatBytes(PDF_DOCUMENT_TOOL_LIMITS.inputBytes)} limit.`;
    case "output-too-large":
      return `The finished PDF exceeds ${formatBytes(PDF_DOCUMENT_TOOL_LIMITS.outputBytes)}.`;
    case "too-many-pages":
      return `This PDF exceeds the ${PDF_DOCUMENT_TOOL_LIMITS.pages.toLocaleString()}-page limit.`;
    case "password-protected":
      return "This PDF is password-protected. Unlock it with the password before editing.";
    case "damaged-pdf":
      return "This PDF appears damaged or unsupported. Try opening and re-saving it in a PDF reader.";
    case "invalid-crop":
      return "Those margins leave too little page area. Reduce the crop values and try again.";
    case "invalid-edit":
      return "Some edit values are invalid. Check the text, page, size, and color, then try again.";
    case "unsupported-text":
      return "This editor currently supports Western Latin text. Remove unsupported characters and try again.";
    case "timeout":
      return "Processing took too long and was stopped. Try a smaller or simpler PDF.";
    case "memory":
      return "Your browser ran out of memory. Close other tabs or try a smaller PDF.";
    case "cancelled":
      return "Processing was cancelled. Your original PDF was not changed.";
    default:
      return "We couldn’t process this PDF. Check that it opens correctly, then try again.";
  }
}

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
