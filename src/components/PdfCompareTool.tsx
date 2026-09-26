import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ArrowLeft, FileDiff, FileText, LoaderCircle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  formatCompareBytes,
  PDF_COMPARE_LIMITS,
  pdfCompareErrorMessage,
  type PdfPageDifference,
} from "@/lib/pdf-compare";

type DocumentPair = {
  loadingA: PDFDocumentLoadingTask;
  loadingB: PDFDocumentLoadingTask;
  a: PDFDocumentProxy;
  b: PDFDocumentProxy;
};

function normalizeText(text: string) {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

function getErrorCode(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "";
  if (/password|encrypted/i.test(message)) return "encrypted";
  if (/memory|allocation|heap/i.test(message)) return "memory";
  if (/invalid pdf|damaged|xref|trailer|unexpected end|formaterror/i.test(message))
    return "damaged-pdf";
  if (/worker|fetch|wasm|loading/i.test(message)) return "engine-unavailable";
  return message;
}

async function pageText(page: PDFPageProxy) {
  const content = await page.getTextContent();
  return normalizeText(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
}

async function renderPixels(
  page: PDFPageProxy,
  width: number,
  height: number,
  scale: number,
  onRenderTask: (task: RenderTask | null) => void,
) {
  const viewport = page.getViewport({ scale });
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("memory");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  const task = page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" });
  onRenderTask(task);
  try {
    await task.promise;
    return context.getImageData(0, 0, width, height);
  } finally {
    onRenderTask(null);
    canvas.width = 0;
    canvas.height = 0;
  }
}

function visualDifferencePercent(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let changedPixels = 0;
  const pixels = Math.floor(Math.min(a.length, b.length) / 4);
  for (let offset = 0; offset < pixels * 4; offset += 4) {
    if (
      Math.max(
        Math.abs(a[offset]! - b[offset]!),
        Math.abs(a[offset + 1]! - b[offset + 1]!),
        Math.abs(a[offset + 2]! - b[offset + 2]!),
      ) > 20
    )
      changedPixels++;
  }
  return pixels ? (changedPixels / pixels) * 100 : 100;
}

function snippet(text: string) {
  return text.length <= 360 ? text : `${text.slice(0, 360)}…`;
}

export function PdfCompareTool() {
  const [original, setOriginal] = useState<File | null>(null);
  const [revised, setRevised] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [differences, setDifferences] = useState<PdfPageDifference[] | null>(null);
  const [counts, setCounts] = useState({ original: 0, revised: 0 });
  const [dragging, setDragging] = useState(false);
  const inputA = useRef<HTMLInputElement>(null);
  const inputB = useRef<HTMLInputElement>(null);
  const pairRef = useRef<DocumentPair | null>(null);
  const loadingARef = useRef<PDFDocumentLoadingTask | null>(null);
  const loadingBRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const cancelledRef = useRef(false);
  const failureCodeRef = useRef("");

  const disposePair = () => {
    renderRef.current?.cancel();
    renderRef.current = null;
    const pair = pairRef.current;
    pairRef.current = null;
    const loadingA = pair?.loadingA ?? loadingARef.current;
    const loadingB = pair?.loadingB ?? loadingBRef.current;
    loadingARef.current = null;
    loadingBRef.current = null;
    if (loadingA || loadingB)
      void Promise.all([
        loadingA?.destroy().catch(() => undefined),
        loadingB?.destroy().catch(() => undefined),
      ]);
  };

  useEffect(
    () => () => {
      cancelledRef.current = true;
      disposePair();
    },
    [],
  );

  const chooseFile = (which: "original" | "revised", file?: File) => {
    if (!file || busy) return;
    if (
      !file.name.toLowerCase().endsWith(".pdf") ||
      (file.type && !["application/pdf", "application/octet-stream"].includes(file.type))
    ) {
      setError(pdfCompareErrorMessage("wrong-type"));
      return;
    }
    if (!file.size) {
      setError(pdfCompareErrorMessage("empty-file"));
      return;
    }
    const other = which === "original" ? revised : original;
    if (file.size + (other?.size ?? 0) > PDF_COMPARE_LIMITS.totalInputBytes) {
      setError(pdfCompareErrorMessage("input-too-large"));
      return;
    }
    disposePair();
    setDifferences(null);
    setCounts({ original: 0, revised: 0 });
    setError("");
    if (which === "original") setOriginal(file);
    else setRevised(file);
  };

  const cancel = () => {
    cancelledRef.current = true;
    failureCodeRef.current = "cancelled";
    renderRef.current?.cancel();
    disposePair();
  };

  const compare = async () => {
    if (!original || !revised || busy) return;
    if (original.size + revised.size > PDF_COMPARE_LIMITS.totalInputBytes) {
      setError(pdfCompareErrorMessage("input-too-large"));
      return;
    }
    setBusy(true);
    setError("");
    setProgress("Opening both PDFs locally…");
    setDifferences(null);
    cancelledRef.current = false;
    failureCodeRef.current = "";
    let activePair: DocumentPair | null = null;
    let totalPixels = 0;
    let totalCharacters = 0;
    const timer = window.setTimeout(() => {
      failureCodeRef.current = "timeout";
      cancelledRef.current = true;
      renderRef.current?.cancel();
      disposePair();
    }, PDF_COMPARE_LIMITS.timeoutMs);
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const inputABytes = new Uint8Array(await original.arrayBuffer());
      if (cancelledRef.current) throw new Error(failureCodeRef.current || "cancelled");
      const inputBBytes = new Uint8Array(await revised.arrayBuffer());
      if (cancelledRef.current) throw new Error(failureCodeRef.current || "cancelled");
      const loadingA = pdfjs.getDocument({ data: inputABytes, stopAtErrors: true, useWasm: true });
      const loadingB = pdfjs.getDocument({ data: inputBBytes, stopAtErrors: true, useWasm: true });
      loadingARef.current = loadingA;
      loadingBRef.current = loadingB;
      const [a, b] = await Promise.all([loadingA.promise, loadingB.promise]);
      activePair = { loadingA, loadingB, a, b };
      pairRef.current = activePair;
      if (!a.numPages || !b.numPages) throw new Error("empty-document");
      if (
        a.numPages > PDF_COMPARE_LIMITS.pagesPerFile ||
        b.numPages > PDF_COMPARE_LIMITS.pagesPerFile
      )
        throw new Error("too-many-pages");
      setCounts({ original: a.numPages, revised: b.numPages });
      const maxPages = Math.max(a.numPages, b.numPages);
      const results: PdfPageDifference[] = [];
      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        if (cancelledRef.current) throw new Error(failureCodeRef.current || "cancelled");
        setProgress(`Comparing page ${pageNumber} of ${maxPages}…`);
        if (pageNumber > a.numPages) {
          results.push({
            page: pageNumber,
            kind: "added",
            textChanged: true,
            revisedText: snippet(await pageText(await b.getPage(pageNumber))),
          });
          setDifferences([...results]);
          continue;
        }
        if (pageNumber > b.numPages) {
          results.push({
            page: pageNumber,
            kind: "removed",
            textChanged: true,
            originalText: snippet(await pageText(await a.getPage(pageNumber))),
          });
          setDifferences([...results]);
          continue;
        }
        const pageA = await a.getPage(pageNumber);
        const pageB = await b.getPage(pageNumber);
        try {
          const [textA, textB] = await Promise.all([pageText(pageA), pageText(pageB)]);
          totalCharacters += textA.length + textB.length;
          if (totalCharacters > PDF_COMPARE_LIMITS.maxTextCharacters)
            throw new Error("text-too-large");
          const baseA = pageA.getViewport({ scale: 1 });
          const baseB = pageB.getViewport({ scale: 1 });
          const dimensionsEqual =
            Math.abs(baseA.width - baseB.width) < 0.5 &&
            Math.abs(baseA.height - baseB.height) < 0.5;
          let visualPercent: number | undefined;
          if (dimensionsEqual) {
            const scale = Math.min(
              96 / 72,
              Math.sqrt(PDF_COMPARE_LIMITS.pagePixels / (baseA.width * baseA.height)),
            );
            const width = Math.max(1, Math.ceil(baseA.width * scale));
            const height = Math.max(1, Math.ceil(baseA.height * scale));
            const pixels = width * height * 2;
            if (
              pixels > PDF_COMPARE_LIMITS.pagePixels * 2 ||
              totalPixels + pixels > PDF_COMPARE_LIMITS.totalPixels
            )
              throw new Error("too-many-pixels");
            totalPixels += pixels;
            const setRenderTask = (task: RenderTask | null) => {
              renderRef.current = task;
            };
            const renderedA = await renderPixels(pageA, width, height, scale, setRenderTask);
            if (cancelledRef.current) throw new Error(failureCodeRef.current || "cancelled");
            const renderedB = await renderPixels(pageB, width, height, scale, setRenderTask);
            visualPercent = visualDifferencePercent(renderedA.data, renderedB.data);
          } else visualPercent = 100;
          const textChanged = textA !== textB;
          const visualChanged = visualPercent >= PDF_COMPARE_LIMITS.visualThresholdPercent;
          if (textChanged || visualChanged)
            results.push({
              page: pageNumber,
              kind: "changed",
              textChanged,
              visualChangePercent: visualPercent,
              ...(textChanged ? { originalText: snippet(textA), revisedText: snippet(textB) } : {}),
            });
        } finally {
          pageA.cleanup();
          pageB.cleanup();
        }
        setDifferences([...results]);
      }
      setProgress(
        results.length
          ? `Found differences on ${results.length} page${results.length === 1 ? "" : "s"}.`
          : "No differences detected at the selected comparison resolution.",
      );
    } catch (cause) {
      setDifferences(null);
      setProgress("");
      setError(pdfCompareErrorMessage(getErrorCode(failureCodeRef.current || cause)));
    } finally {
      window.clearTimeout(timer);
      disposePair();
      setBusy(false);
    }
  };

  const changedCount = differences?.length ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <a
          href="/#security-pdf"
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> PDF security tools
        </a>
        <div className="mx-auto max-w-4xl">
          <header className="mb-8 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent text-primary">
              <FileDiff className="size-7" />
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Compare PDFs
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Compare corresponding pages by extracted text and visual rendering. Files are
              processed locally in your browser.
            </p>
          </header>
          <section
            className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
            aria-label="Compare PDF documents"
          >
            <div className="grid gap-4 md:grid-cols-2">
              {[
                { key: "original" as const, label: "Original PDF", file: original, input: inputA },
                { key: "revised" as const, label: "Revised PDF", file: revised, input: inputB },
              ].map(({ key, label, file: selected, input }) => (
                <div key={key}>
                  <p className="mb-2 text-sm font-bold">{label}</p>
                  <input
                    ref={input}
                    className="hidden"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(event) => {
                      chooseFile(key, event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                  {!selected ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => input.current?.click()}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragging(false);
                        chooseFile(key, event.dataTransfer.files[0]);
                      }}
                      className={`flex min-h-36 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition ${dragging ? "border-primary bg-accent/40" : "border-border hover:border-primary/60 hover:bg-soft/70"}`}
                    >
                      <Plus className="size-5 text-primary" />
                      <strong className="mt-2 text-sm">Choose or drop {label.toLowerCase()}</strong>
                      <small className="mt-1 text-muted-foreground">PDF only</small>
                    </button>
                  ) : (
                    <div className="flex min-h-36 items-center gap-3 rounded-xl border border-border p-4">
                      <FileText className="size-6 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm">{selected.name}</strong>
                        <small className="text-muted-foreground">
                          {formatCompareBytes(selected.size)}
                        </small>
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Remove ${label}`}
                        onClick={() => {
                          disposePair();
                          setDifferences(null);
                          if (key === "original") setOriginal(null);
                          else setRevised(null);
                        }}
                        className="rounded p-2 text-muted-foreground hover:bg-soft hover:text-destructive"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
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
            <div className="mt-5 flex justify-center gap-3">
              {busy ? (
                <Button variant="outline" onClick={cancel}>
                  <X className="size-4" /> Cancel
                </Button>
              ) : (
                <Button disabled={!original || !revised} onClick={() => void compare()}>
                  <FileDiff className="size-4" /> Compare documents
                </Button>
              )}
            </div>
            {differences && (
              <div className="mt-6 border-t border-border pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-bold">Comparison results</h2>
                  <span className="rounded-full bg-accent px-3 py-1 text-sm font-semibold text-primary">
                    {changedCount
                      ? `${changedCount} changed page${changedCount === 1 ? "" : "s"}`
                      : "No changes found"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Original: {counts.original} pages · Revised: {counts.revised} pages · Compared by
                  page number. Visual difference is sampled at up to 96 DPI; review the source PDFs
                  before making decisions.
                </p>
                {differences.length > 0 && (
                  <ul className="mt-4 space-y-3">
                    {differences.map((difference) => (
                      <li key={difference.page} className="rounded-lg border border-border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong className="text-sm">
                            Page {difference.page} ·{" "}
                            {difference.kind === "changed"
                              ? "Changed"
                              : difference.kind === "added"
                                ? "Added in revised PDF"
                                : "Removed from revised PDF"}
                          </strong>
                          <span className="text-xs text-muted-foreground">
                            {difference.kind === "changed"
                              ? difference.visualChangePercent === 100 && !difference.textChanged
                                ? "Page dimensions differ"
                                : `${difference.visualChangePercent?.toFixed(2)}% visual difference${difference.textChanged ? " · text differs" : ""}`
                              : "Page count differs"}
                          </span>
                        </div>
                        {difference.textChanged && (
                          <div className="mt-3 grid gap-3 text-xs leading-5 md:grid-cols-2">
                            <p className="break-words rounded bg-soft p-3">
                              <strong className="block">Original text</strong>
                              {difference.originalText || "No extractable text"}
                            </p>
                            <p className="break-words rounded bg-soft p-3">
                              <strong className="block">Revised text</strong>
                              {difference.revisedText || "No extractable text"}
                            </p>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
              Limits: {formatCompareBytes(PDF_COMPARE_LIMITS.totalInputBytes)} combined,{" "}
              {PDF_COMPARE_LIMITS.pagesPerFile} pages per PDF, 96 DPI visual comparison. Scanned
              documents are compared visually; OCR text is compared when present. Reordered pages
              are compared by their current page numbers.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
