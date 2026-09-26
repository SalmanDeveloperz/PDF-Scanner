export const PDF_TO_JPG_LIMITS = {
  inputBytes: 100 * 1024 * 1024,
  pages: 100,
  dpi: 150,
  pagePixels: 24_000_000,
  totalPixels: 180_000_000,
  outputBytes: 150 * 1024 * 1024,
  timeoutMs: 10 * 60 * 1_000,
} as const;

export function formatJpgBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function pdfToJpgErrorMessage(code: string) {
  switch (code) {
    case "wrong-type":
      return "Choose a PDF file ending in .pdf.";
    case "empty-file":
      return "This file is empty. Choose a valid PDF.";
    case "input-too-large":
      return `This PDF exceeds the ${formatJpgBytes(PDF_TO_JPG_LIMITS.inputBytes)} input limit.`;
    case "too-many-pages":
      return `This PDF exceeds the ${PDF_TO_JPG_LIMITS.pages}-page limit. Split it into smaller documents first.`;
    case "empty-document":
      return "This PDF does not contain any pages.";
    case "encrypted":
      return "This PDF is password-protected. Unlock it with the password before converting it.";
    case "page-too-large":
      return "A page is too large to render safely at the selected resolution. Try a smaller or simpler PDF.";
    case "output-too-large":
      return `The JPG images would exceed the ${formatJpgBytes(PDF_TO_JPG_LIMITS.outputBytes)} output limit. Try fewer pages or a smaller PDF.`;
    case "timeout":
      return "Conversion took too long and was stopped. Try a smaller or shorter PDF.";
    case "memory":
      return "Your browser ran out of memory. Close other tabs or try a smaller or shorter PDF.";
    case "damaged-pdf":
      return "This PDF appears damaged or unsupported. Try opening and re-saving it in a PDF reader.";
    case "cancelled":
      return "Conversion was cancelled.";
    case "engine-unavailable":
      return "The PDF rendering engine could not start. Refresh the page and try again.";
    default:
      return "We couldn’t convert this PDF. Check that it opens correctly, then try again.";
  }
}
