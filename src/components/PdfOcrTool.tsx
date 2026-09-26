import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, FileText, LoaderCircle, Plus, ScanText, X } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import type { PDFPageProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  formatOptimizeBytes,
  PDF_OPTIMIZE_LIMITS,
  pdfOptimizeErrorMessage,
} from "@/lib/pdf-optimize";

type OutputFile = { name: string; href: string; size: number };
type PdfJsDocument = { numPages: number; getPage: (page: number) => Promise<PDFPageProxy> };
type PdfJsLoadingTask = { promise: Promise<PdfJsDocument>; destroy: () => Promise<void> };
type TesseractWorker = {
  recognize: (
    image: HTMLCanvasElement,
    options: { pdfTitle: string; pdfTextOnly: boolean },
    output: { pdf: boolean; text: boolean },
  ) => Promise<{ data: { pdf: number[] | null; text: string | null } }>;
  terminate: () => Promise<unknown>;
};

const TIMEOUT_MS = PDF_OPTIMIZE_LIMITS.timeoutMs;
const MAX_PAGE_EDGE = 2_800;

function safeBaseName(name: string) {
  return (
    name
      .replace(/\.pdf$/i, "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim() || "document"
  );
}

export function PdfOcrTool({
  initialFile,
  autoProcess = false,
  title = "OCR PDF",
  description = "Recognize English text in scanned pages and create a searchable PDF. Original page content is preserved, with an invisible text layer added over each page.",
}: {
  initialFile?: File;
  autoProcess?: boolean;
  title?: string;
  description?: string;
}) {
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [output, setOutput] = useState<OutputFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<TesseractWorker | null>(null);
  const outputRef = useRef<OutputFile | null>(null);
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const autoStartedRef = useRef(false);
  const processRef = useRef<(() => Promise<void>) | null>(null);

  const clearOutput = () => {
    if (outputRef.current) URL.revokeObjectURL(outputRef.current.href);
    outputRef.current = null;
    setOutput(null);
  };

  useEffect(
    () => () => {
      cancelledRef.current = true;
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      void workerRef.current?.terminate();
      if (outputRef.current) URL.revokeObjectURL(outputRef.current.href);
    },
    [],
  );

  const selectFile = (selected?: File) => {
    if (!selected) return;
    clearOutput();
    setError("");
    setProgress("");
    if (selected.type !== "application/pdf" && !selected.name.toLowerCase().endsWith(".pdf")) {
      setFile(null);
      setError(pdfOptimizeErrorMessage("wrong-type"));
    } else if (selected.size === 0) {
      setFile(null);
      setError(pdfOptimizeErrorMessage("empty-file"));
    } else if (selected.size > PDF_OPTIMIZE_LIMITS.ocrInputBytes) {
      setFile(null);
      setError(pdfOptimizeErrorMessage("ocr-input-too-large"));
    } else {
      setFile(selected);
    }
  };

  const process = async () => {
    if (!file || isProcessing) return;
    cancelledRef.current = false;
    clearOutput();
    setError("");
    setIsProcessing(true);
    setProgress("Opening PDF locally…");
    timeoutRef.current = window.setTimeout(() => {
      cancelledRef.current = true;
      void workerRef.current?.terminate();
      workerRef.current = null;
      setIsProcessing(false);
      setProgress("");
      setError(pdfOptimizeErrorMessage("timeout"));
    }, TIMEOUT_MS);

    let document: PdfJsDocument | null = null;
    let loadingTask: PdfJsLoadingTask | null = null;
    let worker: TesseractWorker | null = null;
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (cancelledRef.current) return;
      loadingTask = pdfjs.getDocument({
        data: bytes,
        stopAtErrors: true,
        useWasm: true,
      }) as PdfJsLoadingTask;
      document = await loadingTask.promise;
      if (document.numPages === 0) throw new Error("empty-document");
      if (document.numPages > PDF_OPTIMIZE_LIMITS.ocrPages) throw new Error("too-many-ocr-pages");
      const sourceDocument = await PDFDocument.load(bytes, {
        throwOnInvalidObject: true,
        updateMetadata: false,
      });
      if (sourceDocument.getPageCount() !== document.numPages) throw new Error("damaged-pdf");
      setProgress(
        `Loading English OCR model for ${document.numPages} page${document.numPages === 1 ? "" : "s"}…`,
      );
      const tesseract = await import("tesseract.js");
      worker = (await tesseract.createWorker("eng", undefined, {
        logger: (message) => {
          if (cancelledRef.current) return;
          if (message.status && message.progress > 0)
            setProgress(`Loading OCR model… ${Math.round(message.progress * 100)}%`);
        },
      })) as unknown as TesseractWorker;
      workerRef.current = worker;

      const pdfTitle = safeBaseName(file.name);
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        if (cancelledRef.current) return;
        setProgress(`Rendering and recognizing page ${pageNumber} of ${document.numPages}…`);
        const page = await document.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1, rotation: 0 });
        const scale = Math.min(
          2.2,
          MAX_PAGE_EDGE / baseViewport.width,
          MAX_PAGE_EDGE / baseViewport.height,
          Math.sqrt(PDF_OPTIMIZE_LIMITS.ocrPagePixels / (baseViewport.width * baseViewport.height)),
        );
        const viewport = page.getViewport({ scale, rotation: 0 });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("memory");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, viewport, background: "#ffffff" }).promise;
        const recognized = await worker.recognize(
          canvas,
          { pdfTitle, pdfTextOnly: true },
          { pdf: true, text: true },
        );
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
        if (!recognized.data.pdf?.length) throw new Error("ocr-empty-output");
        const ocrPage = await PDFDocument.load(new Uint8Array(recognized.data.pdf), {
          updateMetadata: false,
        });
        const embeddedTextPage = await sourceDocument.embedPdf(ocrPage);
        const sourcePage = sourceDocument.getPage(pageNumber - 1);
        const cropBox = sourcePage.getCropBox();
        sourcePage.drawPage(embeddedTextPage[0]!, {
          x: cropBox.x,
          y: cropBox.y,
          width: cropBox.width,
          height: cropBox.height,
        });
      }
      if (cancelledRef.current) return;
      setProgress("Saving searchable PDF…");
      const resultBytes = await sourceDocument.save({ useObjectStreams: true });
      if (!resultBytes.byteLength) throw new Error("empty-output");
      if (resultBytes.byteLength > PDF_OPTIMIZE_LIMITS.outputBytes)
        throw new Error("output-too-large");
      const resultBuffer = resultBytes.buffer.slice(
        resultBytes.byteOffset,
        resultBytes.byteOffset + resultBytes.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([resultBuffer], { type: "application/pdf" });
      const ready = {
        name: `${pdfTitle}-searchable.pdf`,
        href: URL.createObjectURL(blob),
        size: blob.size,
      };
      outputRef.current = ready;
      setOutput(ready);
      setProgress("Searchable PDF is ready to save.");
    } catch (cause) {
      if (!cancelledRef.current) {
        const code = cause instanceof Error ? cause.message : "ocr-failed";
        setError(
          code === "too-many-ocr-pages" ||
            code === "empty-document" ||
            code === "output-too-large" ||
            code === "timeout"
            ? pdfOptimizeErrorMessage(code)
            : /password|encrypted/i.test(code)
              ? pdfOptimizeErrorMessage("encrypted")
              : /memory|allocation|heap/i.test(code)
                ? pdfOptimizeErrorMessage("memory")
                : /invalid pdf|damaged|xref|trailer|unexpected end/i.test(code)
                  ? pdfOptimizeErrorMessage("damaged-pdf")
                  : /network|fetch|worker|wasm|language|traineddata|tesseract/i.test(code)
                    ? pdfOptimizeErrorMessage("ocr-unavailable")
                    : pdfOptimizeErrorMessage("processing-failed"),
        );
        setProgress("");
      }
    } finally {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      workerRef.current = null;
      await worker?.terminate().catch(() => undefined);
      await loadingTask?.destroy().catch(() => undefined);
      if (!cancelledRef.current) setIsProcessing(false);
    }
  };

  processRef.current = process;

  useEffect(() => {
    if (initialFile && autoProcess && file === initialFile && !autoStartedRef.current) {
      autoStartedRef.current = true;
      let started = false;
      const timer = window.setTimeout(() => {
        started = true;
        void processRef.current?.();
      }, 0);
      return () => {
        window.clearTimeout(timer);
        if (!started) autoStartedRef.current = false;
      };
    }
    return undefined;
  }, [autoProcess, file, initialFile]);

  const cancel = () => {
    cancelledRef.current = true;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    void workerRef.current?.terminate();
    workerRef.current = null;
    setIsProcessing(false);
    setProgress("");
    setError("OCR cancelled. Your original file was not changed.");
  };

  return (
    <>
      <SiteHeader />
      <main className="min-h-[calc(100vh-18rem)] bg-soft px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-3xl">
          <a
            href="/#tools"
            className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Back to PDF tools
          </a>
          <header className="mt-8 text-center sm:mt-10">
            <span className="mx-auto grid size-14 place-items-center rounded-xl bg-accent text-primary">
              <ScanText className="size-7" />
            </span>
            <p className="eyebrow mt-4">
              {title === "OCR PDF" ? "Optimize PDF" : "Scan and recognize"}
            </p>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">{title}</h1>
            <p className="mx-auto mt-3 max-w-2xl leading-7 text-muted-foreground">{description}</p>
          </header>
          <section
            className="mt-8 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-7"
            aria-label="OCR PDF"
          >
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                selectFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {!file ? (
              <button
                type="button"
                disabled={isProcessing}
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
                className={`flex w-full flex-col items-center rounded-lg border-2 border-dashed px-5 py-10 text-center transition ${dragging ? "border-primary bg-accent/50" : "border-border hover:border-primary/60 hover:bg-soft/70"}`}
              >
                <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
                  <Plus className="size-6" />
                </span>
                <strong className="mt-4 text-base">Choose one PDF or drop it here</strong>
                <span className="mt-1 text-sm text-muted-foreground">
                  Maximum {formatOptimizeBytes(PDF_OPTIMIZE_LIMITS.ocrInputBytes)} ·{" "}
                  {PDF_OPTIMIZE_LIMITS.ocrPages} pages · English OCR
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3 sm:p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                  <FileText className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{file.name}</strong>
                  <small className="text-muted-foreground">{formatOptimizeBytes(file.size)}</small>
                </span>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => {
                    setFile(null);
                    clearOutput();
                    setError("");
                    setProgress("");
                  }}
                  aria-label="Remove PDF"
                  className="rounded p-2 text-muted-foreground hover:bg-soft hover:text-destructive disabled:opacity-40"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}
            {error && (
              <p
                role="alert"
                className="mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
              >
                {error}
              </p>
            )}
            {progress && (
              <p
                role="status"
                aria-live="polite"
                className="mt-4 rounded-md bg-accent/50 px-4 py-3 text-sm font-medium"
              >
                {progress}
              </p>
            )}
            <div className="mt-5 flex gap-3">
              <Button
                type="button"
                onClick={() => void process()}
                disabled={!file || isProcessing}
                className="h-12 flex-1 text-base font-bold"
              >
                {isProcessing ? (
                  <>
                    <LoaderCircle className="animate-spin" /> Recognizing…
                  </>
                ) : (
                  <>
                    <ScanText /> Make searchable
                  </>
                )}
              </Button>
              {isProcessing && (
                <Button type="button" variant="outline" onClick={cancel}>
                  Cancel
                </Button>
              )}
            </div>
            {output && (
              <div className="mt-5 rounded-lg border border-primary/20 bg-accent/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    <strong className="block text-sm">{output.name} is ready</strong>
                    <small className="text-muted-foreground">
                      {formatOptimizeBytes(output.size)}
                    </small>
                  </span>
                  <a
                    href={output.href}
                    download={output.name}
                    className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"
                  >
                    <Download className="size-4" /> Save PDF
                  </a>
                </div>
              </div>
            )}
            <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
              Your document stays in this browser. The English OCR engine and language data may be
              downloaded from their public CDN on first use; these downloads contain no document
              data.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
