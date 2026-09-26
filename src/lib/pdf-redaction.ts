export const PDF_REDACTION_LIMITS = {
  inputBytes: 100 * 1024 * 1024,
  outputBytes: 200 * 1024 * 1024,
  pages: 60,
  dpi: 144,
  pagePixels: 24_000_000,
  totalPixels: 120_000_000,
  timeoutMs: 15 * 60 * 1_000,
} as const;

export type RedactionBox = { x: number; y: number; width: number; height: number };

export function normalizeRedactionBox(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): RedactionBox | null {
  const left = Math.max(0, Math.min(startX, endX));
  const top = Math.max(0, Math.min(startY, endY));
  const right = Math.min(1, Math.max(startX, endX));
  const bottom = Math.min(1, Math.max(startY, endY));
  if (right - left < 0.004 || bottom - top < 0.004) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function pdfRedactionErrorMessage(code: string) {
  switch (code) {
    case "wrong-type":
      return "Choose a PDF file ending in .pdf.";
    case "empty-file":
      return "This file is empty. Choose a valid PDF.";
    case "input-too-large":
      return `This PDF exceeds the ${formatRedactionBytes(PDF_REDACTION_LIMITS.inputBytes)} input limit.`;
    case "too-many-pages":
      return `Raster redaction supports up to ${PDF_REDACTION_LIMITS.pages} pages per document.`;
    case "empty-document":
      return "This PDF does not contain any pages.";
    case "encrypted":
      return "This PDF is password-protected. Unlock it with the password before redacting it.";
    case "page-too-large":
      return "A page exceeds the safe rendering limit. Try a smaller or simpler PDF.";
    case "output-too-large":
      return `The flattened PDF would exceed ${formatRedactionBytes(PDF_REDACTION_LIMITS.outputBytes)}. Try fewer pages or a smaller source.`;
    case "timeout":
      return "Redaction took too long and was stopped. Try a smaller or shorter PDF.";
    case "memory":
      return "Your browser ran out of memory. Close other tabs or try a smaller or shorter PDF.";
    case "damaged-pdf":
      return "This PDF appears damaged or unsupported. Try opening and re-saving it in a PDF reader.";
    case "cancelled":
      return "Redaction was cancelled. Your original PDF was not changed.";
    default:
      return "We couldn’t redact this PDF. Check that it opens correctly, then try again.";
  }
}

export function formatRedactionBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
