import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ArrowLeft,
  Download,
  FileSearch,
  FileText,
  LoaderCircle,
  ReceiptText,
  ScanText,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { formatScanBytes } from "@/lib/scan-utils";

const RECEIPT_LIMITS = {
  inputBytes: 20 * 1024 * 1024,
  pages: 3,
  pagePixels: 3_500_000,
  timeoutMs: 5 * 60 * 1_000,
} as const;
type TesseractWorker = {
  recognize: (canvas: HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};
type Fields = { merchant: string; date: string; total: string };
type Suggestions = {
  fields: Fields;
  confidence: Record<keyof Fields, "candidate" | "review">;
  rawText: string;
};
type PdfJsDocument = { numPages: number; getPage: (page: number) => Promise<PDFPageProxy> };
type PdfJsLoadingTask = { promise: Promise<PdfJsDocument>; destroy: () => Promise<void> };

function extractSuggestions(rawText: string): Suggestions {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const merchant =
    lines.find(
      (line) =>
        /[A-Za-z]/.test(line) &&
        !/^(receipt|invoice|tax invoice|sales receipt)$/i.test(line) &&
        line.length < 100,
    ) ?? "";
  const datePattern =
    /\b(?:20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-](?:20)?\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\b/i;
  const dateLine = lines.find((line) => datePattern.test(line));
  const totalLine = [...lines]
    .reverse()
    .find(
      (line) =>
        /(?:grand\s+total|amount\s+due|balance\s+due|total|amount\s+paid|paid)/i.test(line) &&
        /\d/.test(line),
    );
  const amountPattern = /(?:[$€£₹]\s*)?\b\d{1,3}(?:,\d{3})*(?:\.\d{2})\b|\b\d+\.\d{2}\b/g;
  const amount = totalLine?.match(amountPattern)?.at(-1) ?? "";
  return {
    fields: { merchant, date: dateLine?.match(datePattern)?.[0] ?? "", total: amount },
    confidence: {
      merchant: merchant ? "candidate" : "review",
      date: dateLine ? "candidate" : "review",
      total: totalLine && amount ? "candidate" : "review",
    },
    rawText,
  };
}

export function ReceiptDataExtractorTool() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [resultUrl, setResultUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ocrRef = useRef<TesseractWorker | null>(null);
  const loadingRef = useRef<PdfJsLoadingTask | null>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const canvasesRef = useRef<HTMLCanvasElement[]>([]);
  const resultUrlRef = useRef("");

  const clearResult = () => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = "";
    setResultUrl("");
    setSuggestions(null);
  };
  useEffect(
    () => () => {
      cancelledRef.current = true;
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      renderRef.current?.cancel();
      void loadingRef.current?.destroy();
      void ocrRef.current?.terminate();
      canvasesRef.current.forEach((canvas) => {
        canvas.width = 0;
        canvas.height = 0;
      });
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    },
    [],
  );

  const selectFile = (selected?: File) => {
    if (!selected || busy) return;
    clearResult();
    setError("");
    setProgress("");
    const isPdf =
      selected.type === "application/pdf" || selected.name.toLowerCase().endsWith(".pdf");
    const isImage =
      selected.type.startsWith("image/") ||
      /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(selected.name);
    if (!isPdf && !isImage) {
      setFile(null);
      setError("Choose one PDF or supported image file.");
    } else if (!selected.size) {
      setFile(null);
      setError("This file is empty.");
    } else if (selected.size > RECEIPT_LIMITS.inputBytes) {
      setFile(null);
      setError(`This file exceeds the ${formatScanBytes(RECEIPT_LIMITS.inputBytes)} input limit.`);
    } else setFile(selected);
  };

  const extract = async () => {
    if (!file || busy) return;
    clearResult();
    setError("");
    setBusy(true);
    setProgress("Starting English OCR…");
    cancelledRef.current = false;
    let pdf: PdfJsDocument | null = null;
    let task: PdfJsLoadingTask | null = null;
    let ocr: TesseractWorker | null = null;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      cancelledRef.current = true;
      renderRef.current?.cancel();
      void loadingRef.current?.destroy();
      void ocrRef.current?.terminate();
      setError("Receipt extraction exceeded the 5-minute safety limit.");
      setProgress("");
      setBusy(false);
    }, RECEIPT_LIMITS.timeoutMs);
    timeoutRef.current = timer;
    try {
      const tesseract = await import("tesseract.js");
      ocr = (await tesseract.createWorker("eng", undefined, {
        logger: (message) => {
          if (message.status && message.progress > 0)
            setProgress(`Loading OCR… ${Math.round(message.progress * 100)}%`);
        },
      })) as unknown as TesseractWorker;
      ocrRef.current = ocr;
      canvasesRef.current = [];
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        task = pdfjs.getDocument({
          data: new Uint8Array(await file.arrayBuffer()),
          stopAtErrors: true,
          useWasm: true,
        }) as PdfJsLoadingTask;
        loadingRef.current = task;
        pdf = await task.promise;
        if (pdf.numPages < 1) throw new Error("empty-document");
        if (pdf.numPages > RECEIPT_LIMITS.pages) throw new Error("too-many-pages");
        for (let number = 1; number <= pdf.numPages; number++) {
          if (cancelledRef.current) throw new Error("cancelled");
          setProgress(`Rendering receipt page ${number} of ${pdf.numPages}…`);
          const page = await pdf.getPage(number);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(
            2,
            2_200 / Math.max(base.width, base.height),
            Math.sqrt(RECEIPT_LIMITS.pagePixels / (base.width * base.height)),
          );
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("memory");
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          const render = page.render({
            canvas,
            canvasContext: context,
            viewport,
            background: "#ffffff",
          });
          renderRef.current = render;
          await render.promise;
          renderRef.current = null;
          canvasesRef.current.push(canvas);
          page.cleanup();
        }
      } else {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        try {
          const scale = Math.min(
            1,
            2_200 / Math.max(bitmap.width, bitmap.height),
            Math.sqrt(RECEIPT_LIMITS.pagePixels / (bitmap.width * bitmap.height)),
          );
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
          canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("memory");
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          canvasesRef.current.push(canvas);
        } finally {
          bitmap.close();
        }
      }
      const texts: string[] = [];
      for (let index = 0; index < canvasesRef.current.length; index++) {
        if (cancelledRef.current) throw new Error("cancelled");
        setProgress(
          `Recognizing receipt text on page ${index + 1} of ${canvasesRef.current.length}…`,
        );
        const canvas = canvasesRef.current[index]!;
        const result = await ocr.recognize(canvas);
        texts.push(result.data.text);
        canvas.width = 0;
        canvas.height = 0;
      }
      const extracted = extractSuggestions(texts.join("\n"));
      setSuggestions(extracted);
      setProgress("Review each suggested field before using it.");
    } catch (cause) {
      if (!cancelledRef.current) {
        const message = cause instanceof Error ? cause.message : "";
        setError(
          timedOut
            ? "Receipt extraction exceeded the 5-minute safety limit."
            : /password|encrypted/i.test(message)
              ? "This PDF is password-protected. Unlock it before extracting text."
              : /network|fetch|worker|wasm|tesseract/i.test(message)
                ? "English OCR could not load. Check your connection and try again."
                : /invalid pdf|damaged|xref|trailer|unexpected end/i.test(message)
                  ? "This PDF appears damaged or unsupported."
                  : /memory|allocation|heap/i.test(message)
                    ? "Your browser ran out of memory. Try a smaller receipt."
                    : message === "too-many-pages"
                      ? `Receipts may have at most ${RECEIPT_LIMITS.pages} pages.`
                      : "Could not extract receipt text. Try a clearer scan or image.",
        );
        setProgress("");
      }
    } finally {
      window.clearTimeout(timer);
      timeoutRef.current = null;
      renderRef.current = null;
      loadingRef.current = null;
      ocrRef.current = null;
      canvasesRef.current.forEach((canvas) => {
        canvas.width = 0;
        canvas.height = 0;
      });
      canvasesRef.current = [];
      await ocr?.terminate().catch(() => undefined);
      await task?.destroy().catch(() => undefined);
      if (!cancelledRef.current) setBusy(false);
    }
  };

  const updateField = (field: keyof Fields, value: string) =>
    setSuggestions((current) =>
      current ? { ...current, fields: { ...current.fields, [field]: value } } : current,
    );
  const downloadJson = () => {
    if (!suggestions) return;
    const blob = new Blob([JSON.stringify({ ...suggestions.fields, reviewed: true }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = url;
    setResultUrl(url);
  };
  const cancel = () => {
    cancelledRef.current = true;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    renderRef.current?.cancel();
    void loadingRef.current?.destroy();
    void ocrRef.current?.terminate();
    setBusy(false);
    setProgress("");
    setError("Extraction cancelled. No receipt data was saved.");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <a
          href="/#scan-ocr"
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Scan and recognize
        </a>
        <div className="mx-auto max-w-4xl">
          <header className="mb-8 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent text-primary">
              <ReceiptText className="size-7" />
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Receipt data extractor
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Read English receipt text and suggest a merchant, date, and total. Check every value
              against the original before using it.
            </p>
          </header>
          <section
            className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
            aria-label="Receipt data extractor"
          >
            <input
              ref={inputRef}
              className="hidden"
              type="file"
              accept="application/pdf,image/*,.pdf"
              onChange={(event) => {
                selectFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {!file ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-border px-5 py-10 text-center hover:border-primary/60 hover:bg-soft/70"
              >
                <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
                  <FileText className="size-6" />
                </span>
                <strong className="mt-4">Choose one receipt image or PDF</strong>
                <span className="mt-1 text-sm text-muted-foreground">
                  Up to {formatScanBytes(RECEIPT_LIMITS.inputBytes)} · {RECEIPT_LIMITS.pages} pages
                  · English OCR
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-border p-3">
                <FileText className="size-5 text-primary" />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{file.name}</strong>
                  <small className="text-muted-foreground">{formatScanBytes(file.size)}</small>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setFile(null);
                    clearResult();
                    setError("");
                    setProgress("");
                  }}
                  aria-label="Remove receipt"
                  className="rounded p-2 hover:bg-soft"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}
            {error && (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {progress && (
              <p
                role="status"
                aria-live="polite"
                className="mt-4 text-center text-sm text-muted-foreground"
              >
                {progress}
              </p>
            )}
            <div className="mt-5 flex justify-center gap-2">
              {busy ? (
                <Button variant="outline" onClick={cancel}>
                  <X className="size-4" /> Cancel
                </Button>
              ) : (
                <Button disabled={!file} onClick={() => void extract()}>
                  <ScanText className="size-4" /> Extract suggestions
                </Button>
              )}
            </div>
            {suggestions && (
              <div className="mt-6 border-t border-border pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-bold">Review extracted candidates</h2>
                  <span className="text-xs text-muted-foreground">
                    OCR can misread receipts; verify against the source.
                  </span>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  {(["merchant", "date", "total"] as const).map((field) => (
                    <label key={field} className="text-sm font-semibold capitalize">
                      {field}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {suggestions.confidence[field] === "candidate"
                          ? "Candidate"
                          : "Needs review"}
                      </span>
                      <input
                        value={suggestions.fields[field]}
                        onChange={(event) => updateField(field, event.target.value)}
                        className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2.5"
                      />
                    </label>
                  ))}
                </div>
                <details className="mt-4 rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Review OCR text
                  </summary>
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                    {suggestions.rawText || "No text recognized."}
                  </pre>
                </details>
                <div className="mt-4 flex justify-end">
                  {resultUrl ? (
                    <a
                      href={resultUrl}
                      download="receipt-data.json"
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"
                    >
                      <Download className="size-4" /> Download reviewed JSON
                    </a>
                  ) : (
                    <Button onClick={downloadJson}>
                      <Download className="size-4" /> Prepare JSON
                    </Button>
                  )}
                </div>
              </div>
            )}
            <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
              Files stay in this browser. The OCR engine downloads English language data from a
              public CDN on first use; no receipt file is sent to that service. Extracted fields are
              suggestions, not verified accounting data.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
