export const PDF_METADATA_LIMITS = {
  inputBytes: 100 * 1024 * 1024,
  outputBytes: 200 * 1024 * 1024,
  pages: 2_000,
  timeoutMs: 5 * 60 * 1_000,
} as const;

export type PdfMetadataResponse =
  { type: "success"; bytes: ArrayBuffer; pages: number } | { type: "error"; code: string };

export function formatMetadataBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function metadataErrorMessage(code: string) {
  switch (code) {
    case "wrong-type":
      return "Choose a PDF file ending in .pdf.";
    case "empty-file":
      return "This file is empty. Choose a valid PDF.";
    case "input-too-large":
      return `This PDF exceeds the ${formatMetadataBytes(PDF_METADATA_LIMITS.inputBytes)} input limit.`;
    case "output-too-large":
      return `The cleaned PDF exceeds the ${formatMetadataBytes(PDF_METADATA_LIMITS.outputBytes)} output limit.`;
    case "too-many-pages":
      return `This PDF exceeds the ${PDF_METADATA_LIMITS.pages.toLocaleString()}-page safety limit.`;
    case "empty-document":
      return "This PDF does not contain any pages.";
    case "encrypted":
      return "This PDF is password-protected. Unlock it with the password before cleaning metadata.";
    case "timeout":
      return "Metadata cleanup took too long and was stopped. Try a smaller or simpler PDF.";
    case "memory":
      return "Your browser ran out of memory. Close other tabs or try a smaller PDF.";
    case "damaged-pdf":
      return "This PDF appears damaged or unsupported. Try opening and re-saving it in a PDF reader.";
    case "cancelled":
      return "Metadata cleanup was cancelled. Your original PDF was not changed.";
    default:
      return "We couldn’t clean this PDF. Check that it opens correctly, then try again.";
  }
}
