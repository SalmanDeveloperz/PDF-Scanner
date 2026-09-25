export const PDF_OPTIMIZE_LIMITS = {
  inputBytes: 200 * 1024 * 1024,
  outputBytes: 200 * 1024 * 1024,
  pages: 2_000,
  ocrInputBytes: 50 * 1024 * 1024,
  ocrPages: 30,
  ocrPagePixels: 3_500_000,
  timeoutMs: 15 * 60 * 1_000,
} as const;

export type PdfOptimizeMode = "compress" | "repair" | "flatten" | "archive";

export function pdfOptimizeErrorMessage(code: string) {
  switch (code) {
    case "wrong-type":
      return "Choose a PDF file ending in .pdf.";
    case "empty-file":
      return "This file is empty. Choose a valid PDF.";
    case "input-too-large":
      return `This PDF exceeds the ${formatOptimizeBytes(PDF_OPTIMIZE_LIMITS.inputBytes)} input limit.`;
    case "ocr-input-too-large":
      return `OCR supports PDFs up to ${formatOptimizeBytes(PDF_OPTIMIZE_LIMITS.ocrInputBytes)}.`;
    case "output-too-large":
      return `The result exceeds the ${formatOptimizeBytes(PDF_OPTIMIZE_LIMITS.outputBytes)} output limit.`;
    case "too-many-pages":
      return `This PDF exceeds the ${PDF_OPTIMIZE_LIMITS.pages.toLocaleString()}-page safety limit.`;
    case "too-many-ocr-pages":
      return `OCR supports up to ${PDF_OPTIMIZE_LIMITS.ocrPages} pages per run.`;
    case "empty-document":
      return "This PDF does not contain any pages.";
    case "encrypted":
      return "This PDF is password-protected. Unlock it before using this tool.";
    case "damaged-pdf":
      return "This PDF appears damaged or unsupported. Try opening and re-saving it in a PDF reader.";
    case "no-form-fields":
      return "This PDF has no interactive form fields to flatten.";
    case "memory":
      return "Your browser ran out of memory. Close other tabs or try a smaller or shorter PDF.";
    case "timeout":
      return "Processing took too long and was stopped. Try a smaller or simpler PDF.";
    case "engine-unavailable":
      return "The PDF engine could not start. Check your connection and browser settings, then try again.";
    case "qpdf-failed":
      return "The PDF could not be rewritten. It may be damaged, encrypted, or use unsupported features.";
    case "ocr-unavailable":
      return "The OCR engine or language data could not load. Check your connection and try again.";
    default:
      return "We couldn’t process this PDF. Check that it opens correctly, then try again.";
  }
}

export function formatOptimizeBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
