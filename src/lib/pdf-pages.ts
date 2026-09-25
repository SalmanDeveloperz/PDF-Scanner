export const PDF_PAGE_LIMITS = {
  inputBytes: 200 * 1024 * 1024,
  outputBytes: 200 * 1024 * 1024,
  mergeFiles: 20,
  pages: 2_000,
  maxSplitFiles: 20,
  timeoutMs: 15 * 60 * 1_000,
} as const;

export type PdfPageToolMode = "split" | "organize" | "extract" | "remove";

export type PdfPageOrderItem = { pageIndex: number; rotation: number };

export type PdfPageWorkerRequest =
  | { type: "inspect"; input: ArrayBuffer }
  | { type: "merge"; files: File[] }
  | {
      type: "process";
      mode: PdfPageToolMode;
      input: ArrayBuffer;
      selection?: string;
      pageOrder?: PdfPageOrderItem[];
    };

export type PdfPageWorkerResponse =
  | { type: "inspected"; pageCount: number }
  | {
      type: "processed";
      outputs: Array<{ name: string; bytes: ArrayBuffer }>;
      pageCount: number;
    }
  | { type: "error"; code: string };

type PageRangeOptions = { maxRanges?: number };

function parseRangeToken(token: string, pageCount: number) {
  const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token.trim());
  if (!match) throw new Error("invalid-selection");
  const first = Number(match[1]);
  const last = Number(match[2] ?? match[1]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first) {
    throw new Error("invalid-selection");
  }
  if (last > pageCount) throw new Error("page-out-of-range");
  return Array.from({ length: last - first + 1 }, (_, index) => first + index - 1);
}

export function parsePageRanges(
  selection: string,
  pageCount: number,
  options: PageRangeOptions = {},
) {
  const tokens = selection.split(",").map((token) => token.trim());
  if (!selection.trim() || tokens.some((token) => token.length === 0)) {
    throw new Error("invalid-selection");
  }
  if (tokens.length > (options.maxRanges ?? PDF_PAGE_LIMITS.maxSplitFiles)) {
    throw new Error("too-many-ranges");
  }
  const ranges = tokens.map((token) => parseRangeToken(token, pageCount));
  const seen = new Set<number>();
  for (const range of ranges) {
    for (const page of range) {
      if (seen.has(page)) throw new Error("overlapping-ranges");
      seen.add(page);
    }
  }
  return ranges;
}

export function parsePageSelection(selection: string, pageCount: number) {
  const ranges = parsePageRanges(selection, pageCount, { maxRanges: pageCount });
  return ranges.flat();
}

export function pdfPageErrorMessage(code: string) {
  switch (code) {
    case "wrong-type":
      return "Choose a PDF file ending in .pdf.";
    case "empty-file":
      return "This file is empty. Choose a valid PDF.";
    case "input-too-large":
      return `This PDF exceeds the ${formatPageBytes(PDF_PAGE_LIMITS.inputBytes)} input limit. Choose a smaller file.`;
    case "total-input-too-large":
      return `The selected PDFs exceed the ${formatPageBytes(PDF_PAGE_LIMITS.inputBytes)} combined input limit. Remove files or choose smaller PDFs.`;
    case "too-many-files":
      return `Merge up to ${PDF_PAGE_LIMITS.mergeFiles} PDF files at a time.`;
    case "not-enough-files":
      return "Add at least two PDF files to merge.";
    case "output-too-large":
      return `The generated PDF files exceed the ${formatPageBytes(PDF_PAGE_LIMITS.outputBytes)} total output limit. Choose fewer pages or a smaller PDF.`;
    case "encrypted":
      return "This PDF is password-protected. Unlock it with the password before using this tool.";
    case "damaged-pdf":
      return "This PDF appears damaged or unsupported. Try opening and re-saving it in a PDF reader.";
    case "empty-document":
      return "This PDF does not contain any pages.";
    case "too-many-pages":
      return `This PDF exceeds the ${PDF_PAGE_LIMITS.pages.toLocaleString()}-page safety limit.`;
    case "invalid-selection":
      return "Enter page numbers like 1, 3-5. Use commas between pages or ranges.";
    case "page-out-of-range":
      return "One or more selected pages are outside this PDF’s page range.";
    case "overlapping-ranges":
      return "The selected ranges overlap. Each page can appear only once.";
    case "too-many-ranges":
      return `Split into no more than ${PDF_PAGE_LIMITS.maxSplitFiles} files at a time.`;
    case "no-pages-left":
      return "At least one page must remain in the PDF.";
    case "invalid-page-order":
      return "The page order changed unexpectedly. Reset the order and try again.";
    case "memory":
      return "Your browser ran out of memory while processing this PDF. Close other tabs or try a smaller file.";
    case "timeout":
      return "Processing took too long and was stopped. Try a smaller or simpler PDF.";
    case "worker-error":
      return "The PDF processor stopped unexpectedly. Refresh the page and try again with a valid PDF.";
    default:
      return "We couldn’t process this PDF. Check that it opens correctly, then try again.";
  }
}

export function formatPageBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
