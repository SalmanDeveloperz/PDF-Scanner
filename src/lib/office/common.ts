export type OfficeKind = "word" | "excel" | "powerpoint";

export const OFFICE_LIMITS = {
  inputBytes: 50 * 1024 * 1024,
  pages: 500,
  outputBytes: 300 * 1024 * 1024,
  pagePixels: 36_000_000,
  timeoutMs: 15 * 60 * 1_000,
} as const;

export type OfficeQuality = "standard" | "high" | "maximum";

/** Raster resolution used for each quality level (dots per inch). */
export const QUALITY_DPI: Record<OfficeQuality, number> = {
  standard: 150,
  high: 200,
  maximum: 300,
};

/** JPEG quality used for each level; text stays crisp while files stay reasonable. */
export const QUALITY_JPEG: Record<OfficeQuality, number> = {
  standard: 0.82,
  high: 0.86,
  maximum: 0.92,
};

export type OfficeKindInfo = {
  kind: OfficeKind;
  title: string;
  noun: string;
  extensions: string[];
  accept: string;
  legacyExtensions: string[];
  formatsLabel: string;
};

export const OFFICE_KINDS: Record<OfficeKind, OfficeKindInfo> = {
  word: {
    kind: "word",
    title: "Word to PDF",
    noun: "document",
    extensions: [".docx", ".docm", ".dotx", ".dotm"],
    legacyExtensions: [".doc", ".dot", ".rtf", ".odt"],
    accept:
      ".docx,.docm,.dotx,.dotm,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    formatsLabel: "DOCX, DOCM, DOTX",
  },
  excel: {
    kind: "excel",
    title: "Excel to PDF",
    noun: "spreadsheet",
    extensions: [".xlsx", ".xlsm", ".xltx", ".xltm", ".csv"],
    legacyExtensions: [".xls", ".xlsb", ".ods"],
    accept:
      ".xlsx,.xlsm,.xltx,.xltm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    formatsLabel: "XLSX, XLSM, XLTX, CSV",
  },
  powerpoint: {
    kind: "powerpoint",
    title: "PowerPoint to PDF",
    noun: "presentation",
    extensions: [".pptx", ".pptm", ".ppsx", ".ppsm", ".potx", ".potm"],
    legacyExtensions: [".ppt", ".pps", ".pot", ".odp"],
    accept:
      ".pptx,.pptm,.ppsx,.ppsm,.potx,.potm,application/vnd.openxmlformats-officedocument.presentationml.presentation",
    formatsLabel: "PPTX, PPTM, PPSX, POTX",
  },
};

export class OfficeError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export function extensionOf(name: string) {
  const match = /\.[^.]+$/.exec(name.toLowerCase());
  return match ? match[0] : "";
}

export function formatOfficeBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Checks the file name before any bytes are read. Returns an error code or "". */
export function precheckOfficeFile(kind: OfficeKind, file: File) {
  const info = OFFICE_KINDS[kind];
  const extension = extensionOf(file.name);
  if (info.legacyExtensions.includes(extension)) return "legacy-format";
  if (!info.extensions.includes(extension)) return "wrong-type";
  if (!file.size) return "empty-file";
  if (file.size > OFFICE_LIMITS.inputBytes) return "input-too-large";
  return "";
}

/** Validates magic bytes so renamed or encrypted files fail with a clear message. */
export function sniffOfficeBytes(kind: OfficeKind, name: string, bytes: Uint8Array) {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (kind === "excel" && extensionOf(name) === ".csv") {
    if (isZip || isOle) throw new OfficeError("wrong-type");
    return;
  }
  if (isOle) {
    // Password-protected OOXML files are stored in an OLE container with an EncryptedPackage stream.
    const head = new TextDecoder("utf-16le").decode(
      bytes.subarray(0, Math.min(bytes.length, 65536)),
    );
    throw new OfficeError(
      /EncryptedPackage|EncryptionInfo/.test(head) ? "encrypted" : "legacy-format",
    );
  }
  if (!isZip) throw new OfficeError("damaged-file");
}

export function officeErrorMessage(kind: OfficeKind, code: string) {
  const info = OFFICE_KINDS[kind];
  const modern = info.extensions
    .filter((ext) => ext !== ".csv")[0]
    ?.slice(1)
    .toUpperCase();
  switch (code) {
    case "wrong-type":
      return `Choose a ${info.noun} in one of these formats: ${info.formatsLabel}.`;
    case "legacy-format":
      return `This is an older or non-Microsoft ${info.noun} format. Open it in Office (or LibreOffice) and save it as ${modern}, then try again.`;
    case "empty-file":
      return `This file is empty. Choose a valid ${info.noun}.`;
    case "input-too-large":
      return `This file exceeds the ${formatOfficeBytes(OFFICE_LIMITS.inputBytes)} input limit.`;
    case "encrypted":
      return `This ${info.noun} is password-protected. Remove the password in Office, save it, then try again.`;
    case "damaged-file":
      return `This ${info.noun} appears damaged or is not a real ${modern} file. Try opening and re-saving it.`;
    case "empty-document":
      return kind === "excel"
        ? "This workbook has no visible cells to print."
        : `This ${info.noun} has no pages to convert.`;
    case "too-many-pages":
      return `The PDF would exceed ${OFFICE_LIMITS.pages} pages. Split the ${info.noun} into smaller files first.`;
    case "page-too-large":
      return "A page is too large to render at this quality. Choose a lower quality and try again.";
    case "output-too-large":
      return `The PDF would exceed ${formatOfficeBytes(OFFICE_LIMITS.outputBytes)}. Choose a lower quality or a shorter ${info.noun}.`;
    case "timeout":
      return "Conversion took too long and was stopped. Try a smaller file or lower quality.";
    case "memory":
      return "Your browser ran out of memory. Close other tabs, choose a lower quality, or try a smaller file.";
    case "cancelled":
      return "Conversion was cancelled.";
    case "engine-unavailable":
      return "The document renderer could not start. Refresh the page and try again.";
    default:
      return `We couldn’t convert this ${info.noun}. Check that it opens correctly in Office, then try again.`;
  }
}

export function normalizeOfficeError(cause: unknown) {
  if (cause instanceof OfficeError) return cause.code;
  const raw = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause ?? "");
  if (/cancel/i.test(raw)) return "cancelled";
  if (/memory|allocation|heap|RangeError: Array buffer/i.test(raw)) return "memory";
  if (/zip|central directory|end of data|corrupt|Can't find end|invalid|not a valid/i.test(raw))
    return "damaged-file";
  return "processing-failed";
}

export type ProgressFn = (message: string) => void;

export type RenderContext = {
  signal: { cancelled: boolean; reason: string };
  progress: ProgressFn;
};

export function throwIfCancelled(context: RenderContext) {
  if (context.signal.cancelled) throw new OfficeError(context.signal.reason || "cancelled");
}

/** Yields to the browser so progress updates paint and cancel clicks are handled. */
export function nextFrame() {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

export function outputName(name: string) {
  return `${name.replace(/\.[^.]+$/, "") || "document"}.pdf`;
}
