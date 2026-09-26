import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  Plus,
  Presentation,
  Printer,
  RefreshCw,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  OFFICE_KINDS,
  OFFICE_LIMITS,
  QUALITY_DPI,
  formatOfficeBytes,
  normalizeOfficeError,
  officeErrorMessage,
  outputName,
  precheckOfficeFile,
  type OfficeKind,
  type OfficeQuality,
  type RenderContext,
} from "@/lib/office/common";
import type { ExcelOptions, OfficeConvertResult } from "@/lib/office/convert";
import type { RenderHost } from "@/lib/office/host";

type Output = {
  href: string;
  name: string;
  size: number;
  pageCount: number;
  thumbnails: string[];
  warnings: string[];
};

const COPY: Record<
  OfficeKind,
  { icon: LucideIcon; description: string; preserved: string[]; note: string }
> = {
  word: {
    icon: FileText,
    description:
      "Turn Word documents into PDF pages. Fonts, styles, lists, tables, images, headers, footers, and page numbers are laid out page by page in your browser.",
    preserved: [
      "Paragraph and character styles",
      "Tables, lists, and images",
      "Headers, footers, and page numbers",
      "Page size, margins, and orientation",
    ],
    note: "Legacy .doc files must be saved as .docx first. Pagination is recalculated, so a page may break a few lines differently than Word when your device lacks the document's fonts.",
  },
  excel: {
    icon: FileSpreadsheet,
    description:
      "Turn spreadsheets into print-ready PDF pages. Cell formatting, merged cells, number formats, images, charts, and print settings are preserved.",
    preserved: [
      "Fonts, fills, borders, and alignment",
      "Number, date, and currency formats",
      "Merged cells, images, and charts",
      "Print area, titles, headers, and footers",
    ],
    note: "Formulas show the values saved in the file. Legacy .xls and .ods files must be saved as .xlsx first. Conditional formatting and pivot styling are not applied.",
  },
  powerpoint: {
    icon: Presentation,
    description:
      "Turn presentations into PDF with one slide per page. Themes, backgrounds, shapes, images, tables, and charts are rendered at full slide size.",
    preserved: [
      "Slide size, backgrounds, and themes",
      "Text boxes, shapes, and images",
      "Tables and common chart types",
      "Optional speaker notes pages",
    ],
    note: "Animations, transitions, audio, and video are not part of a PDF. Legacy .ppt files must be saved as .pptx first. SmartArt and uncommon effects are approximated.",
  },
};

const QUALITY_OPTIONS: Array<{ value: OfficeQuality; label: string; hint: string }> = [
  { value: "standard", label: "Standard", hint: `${QUALITY_DPI.standard} DPI · smaller file` },
  { value: "high", label: "High", hint: `${QUALITY_DPI.high} DPI · recommended` },
  { value: "maximum", label: "Maximum", hint: `${QUALITY_DPI.maximum} DPI · print quality` },
];

export function OfficeToPdfTool({ kind }: { kind: OfficeKind }) {
  const info = OFFICE_KINDS[kind];
  const copy = COPY[kind];
  const Icon = copy.icon;
  const [file, setFile] = useState<File | null>(null);
  const [quality, setQuality] = useState<OfficeQuality>("high");
  const [excel, setExcel] = useState<ExcelOptions>({
    scope: "all",
    scaling: "fit-width",
    gridlines: "file",
    orientation: "file",
  });
  const [notes, setNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [output, setOutput] = useState<Output | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const contextRef = useRef<RenderContext | null>(null);
  const hostRef = useRef<RenderHost | null>(null);
  const outputRef = useRef<Output | null>(null);

  const clearOutput = () => {
    if (outputRef.current) URL.revokeObjectURL(outputRef.current.href);
    outputRef.current = null;
    setOutput(null);
    hostRef.current?.destroy();
    hostRef.current = null;
  };

  useEffect(
    () => () => {
      if (contextRef.current) {
        contextRef.current.signal.cancelled = true;
        contextRef.current.signal.reason = "cancelled";
      }
      if (outputRef.current) URL.revokeObjectURL(outputRef.current.href);
      hostRef.current?.destroy();
    },
    [],
  );

  const selectFile = (candidate?: File) => {
    if (busy || !candidate) return;
    clearOutput();
    setError("");
    setProgress("");
    const code = precheckOfficeFile(kind, candidate);
    if (code) {
      setFile(null);
      setError(officeErrorMessage(kind, code));
      return;
    }
    setFile(candidate);
  };

  const cancel = () => {
    const context = contextRef.current;
    if (!context) return;
    context.signal.cancelled = true;
    if (!context.signal.reason) context.signal.reason = "cancelled";
    setProgress("Cancelling…");
  };

  const convert = async () => {
    if (!file || busy) return;
    clearOutput();
    setError("");
    setBusy(true);
    setProgress("Starting converter…");
    const context: RenderContext = {
      signal: { cancelled: false, reason: "" },
      progress: (message) => {
        if (!context.signal.cancelled) setProgress(message);
      },
    };
    contextRef.current = context;
    const timer = window.setTimeout(() => {
      context.signal.cancelled = true;
      context.signal.reason = "timeout";
    }, OFFICE_LIMITS.timeoutMs);
    let result: OfficeConvertResult | null = null;
    try {
      const { convertOfficeFile } = await import("@/lib/office/convert");
      result = await convertOfficeFile(
        kind,
        file,
        { quality, excel, powerpoint: { notes } },
        context,
      );
      if (context.signal.cancelled) throw new Error(context.signal.reason || "cancelled");
      const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
      const next: Output = {
        href: URL.createObjectURL(blob),
        name: outputName(file.name),
        size: blob.size,
        pageCount: result.pageCount,
        thumbnails: result.thumbnails,
        warnings: result.warnings,
      };
      hostRef.current = result.host;
      outputRef.current = next;
      setOutput(next);
      setProgress("");
    } catch (cause) {
      result?.host.destroy();
      const code = context.signal.reason || normalizeOfficeError(cause);
      if (code === "processing-failed") console.error(cause);
      setError(officeErrorMessage(kind, code));
      setProgress("");
    } finally {
      window.clearTimeout(timer);
      contextRef.current = null;
      setBusy(false);
    }
  };

  const printVector = () => {
    const frame = hostRef.current?.frame;
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };

  const optionClass =
    "mt-2 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal disabled:opacity-60";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <a
          href="/#convert-pdf"
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All conversion tools
        </a>
        <div className="mx-auto max-w-3xl">
          <header className="mb-8 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent text-primary">
              <Icon className="size-7" />
            </span>
            <p className="eyebrow mt-4">Convert documents</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
              {info.title}
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{copy.description}</p>
          </header>

          <section
            className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
            aria-label={`${info.title} conversion`}
          >
            {!file ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  selectFile(event.dataTransfer.files[0]);
                }}
                className={`flex w-full flex-col items-center rounded-xl border-2 border-dashed px-5 py-10 text-center transition ${dragging ? "border-primary bg-accent/50" : "border-border hover:border-primary/60 hover:bg-soft/70"}`}
              >
                <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
                  <Plus className="size-6" />
                </span>
                <strong className="mt-4">Choose a {info.noun} or drop it here</strong>
                <span className="mt-1 text-sm text-muted-foreground">
                  {info.formatsLabel} · up to {formatOfficeBytes(OFFICE_LIMITS.inputBytes)}
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3 sm:p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{file.name}</strong>
                  <small className="text-muted-foreground">{formatOfficeBytes(file.size)}</small>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setFile(null);
                    clearOutput();
                    setError("");
                    setProgress("");
                  }}
                  aria-label={`Remove ${info.noun}`}
                  className="rounded p-2 text-muted-foreground hover:bg-soft hover:text-destructive disabled:opacity-40"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={info.accept}
              className="hidden"
              data-testid="office-file-input"
              onChange={(event) => {
                selectFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />

            <fieldset className="mt-6" disabled={busy}>
              <legend className="text-sm font-semibold">PDF quality</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {QUALITY_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer flex-col rounded-lg border px-3 py-2.5 text-sm transition ${quality === option.value ? "border-primary bg-accent/50" : "border-border hover:bg-soft"}`}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <input
                        type="radio"
                        name="quality"
                        value={option.value}
                        checked={quality === option.value}
                        onChange={() => {
                          setQuality(option.value);
                          clearOutput();
                        }}
                        className="accent-primary"
                      />
                      {option.label}
                    </span>
                    <span className="mt-0.5 pl-5 text-xs text-muted-foreground">{option.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {kind === "excel" && (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold">
                  Sheets
                  <select
                    className={optionClass}
                    disabled={busy}
                    value={excel.scope}
                    onChange={(event) => {
                      setExcel({ ...excel, scope: event.target.value as ExcelOptions["scope"] });
                      clearOutput();
                    }}
                  >
                    <option value="all">All visible sheets</option>
                    <option value="active">Active sheet only</option>
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Page scaling
                  <select
                    className={optionClass}
                    disabled={busy}
                    value={excel.scaling}
                    onChange={(event) => {
                      setExcel({
                        ...excel,
                        scaling: event.target.value as ExcelOptions["scaling"],
                      });
                      clearOutput();
                    }}
                  >
                    <option value="fit-width">Fit all columns on one page</option>
                    <option value="fit-page">Fit each sheet on one page</option>
                    <option value="file">Use the file’s print settings</option>
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Orientation
                  <select
                    className={optionClass}
                    disabled={busy}
                    value={excel.orientation}
                    onChange={(event) => {
                      setExcel({
                        ...excel,
                        orientation: event.target.value as ExcelOptions["orientation"],
                      });
                      clearOutput();
                    }}
                  >
                    <option value="file">As saved in the file</option>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Gridlines
                  <select
                    className={optionClass}
                    disabled={busy}
                    value={excel.gridlines}
                    onChange={(event) => {
                      setExcel({
                        ...excel,
                        gridlines: event.target.value as ExcelOptions["gridlines"],
                      });
                      clearOutput();
                    }}
                  >
                    <option value="file">As saved in the file</option>
                    <option value="on">Always print gridlines</option>
                    <option value="off">Never print gridlines</option>
                  </select>
                </label>
              </div>
            )}

            {kind === "powerpoint" && (
              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={notes}
                  disabled={busy}
                  onChange={(event) => {
                    setNotes(event.target.checked);
                    clearOutput();
                  }}
                  className="mt-0.5 accent-primary"
                />
                <span>
                  <strong className="block">Include speaker notes</strong>
                  <span className="text-muted-foreground">
                    Adds a notes page after each slide that has notes.
                  </span>
                </span>
              </label>
            )}

            <div className="mt-6 flex justify-center gap-3">
              {busy ? (
                <Button type="button" variant="outline" onClick={cancel}>
                  <X className="size-4" /> Cancel
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => void convert()}
                  disabled={!file}
                  className="h-11 min-w-52 text-base font-bold"
                >
                  {output ? <RefreshCw className="size-4" /> : <Icon className="size-4" />}
                  {output ? "Convert again" : "Convert to PDF"}
                </Button>
              )}
            </div>

            {busy && (
              <p
                role="status"
                aria-live="polite"
                className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground"
              >
                <LoaderCircle className="size-4 animate-spin" />
                {progress}
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            {output && (
              <div
                className="mt-6 rounded-xl border border-primary/20 bg-accent/40 p-4 sm:p-5"
                data-testid="office-output"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0">
                    <strong className="block truncate text-sm">{output.name} is ready</strong>
                    <small className="text-muted-foreground">
                      {output.pageCount} {output.pageCount === 1 ? "page" : "pages"} ·{" "}
                      {formatOfficeBytes(output.size)}
                    </small>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={printVector}>
                      <Printer className="size-4" /> Print
                    </Button>
                    <a
                      href={output.href}
                      download={output.name}
                      className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90"
                    >
                      <Download className="size-4" /> Download PDF
                    </a>
                  </span>
                </div>
                {output.thumbnails.length > 0 && (
                  <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {output.thumbnails.map((src, index) => (
                      <li
                        key={index}
                        className="overflow-hidden rounded-md border border-border bg-white shadow-sm"
                      >
                        <img
                          src={src}
                          alt={`Preview of page ${index + 1}`}
                          className="block h-auto w-full"
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {output.pageCount > output.thumbnails.length && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing the first {output.thumbnails.length} of {output.pageCount} pages.
                  </p>
                )}
                {output.warnings.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {output.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  Text is embedded as real, selectable text wherever an identical font is available,
                  and links stay clickable. Print → “Save as PDF” creates a copy that uses this
                  device’s own fonts.
                </p>
              </div>
            )}

            <div className="mt-6 grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2">
              <div>
                <h2 className="font-bold">What’s preserved</h2>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {copy.preserved.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h2 className="font-bold">Good to know</h2>
                <p className="mt-2 text-muted-foreground">{copy.note}</p>
              </div>
            </div>
            <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
              Limits: {formatOfficeBytes(OFFICE_LIMITS.inputBytes)} input, {OFFICE_LIMITS.pages}{" "}
              pages, {formatOfficeBytes(OFFICE_LIMITS.outputBytes)} PDF output. Your file is
              processed on this device and never uploaded.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
