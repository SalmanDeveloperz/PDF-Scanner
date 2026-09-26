export const PDF_COMPARE_LIMITS = {
  totalInputBytes: 100 * 1024 * 1024,
  pagesPerFile: 100,
  pagePixels: 2_000_000,
  totalPixels: 100_000_000,
  maxTextCharacters: 5_000_000,
  timeoutMs: 10 * 60 * 1_000,
  visualThresholdPercent: 0.2,
} as const;

export type PdfPageDifference = {
  page: number;
  kind: "changed" | "added" | "removed";
  textChanged: boolean;
  visualChangePercent?: number;
  originalText?: string;
  revisedText?: string;
};

export function formatCompareBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function pdfCompareErrorMessage(code: string) {
  switch (code) {
    case "wrong-type":
      return "Choose PDF files ending in .pdf.";
    case "empty-file":
      return "One of the selected PDFs is empty.";
    case "input-too-large":
      return `The PDFs exceed the ${formatCompareBytes(PDF_COMPARE_LIMITS.totalInputBytes)} combined input limit.`;
    case "too-many-pages":
      return `Compare up to ${PDF_COMPARE_LIMITS.pagesPerFile} pages per PDF.`;
    case "too-many-pixels":
      return "The selected pages exceed the safe visual-comparison limit. Compare smaller documents.";
    case "text-too-large":
      return "The extracted text exceeds the safe comparison limit. Compare shorter documents.";
    case "empty-document":
      return "One of the PDFs does not contain any pages.";
    case "encrypted":
      return "One of the PDFs is password-protected. Unlock it before comparing.";
    case "timeout":
      return "Comparison took too long and was stopped. Try smaller or shorter PDFs.";
    case "memory":
      return "Your browser ran out of memory. Close other tabs or compare smaller PDFs.";
    case "damaged-pdf":
      return "One of the PDFs appears damaged or unsupported. Try opening and re-saving it.";
    case "cancelled":
      return "Comparison was cancelled.";
    default:
      return "We couldn’t compare these PDFs. Check that they open correctly, then try again.";
  }
}
