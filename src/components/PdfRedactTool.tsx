import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  FileText,
  LoaderCircle,
  Plus,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  formatRedactionBytes,
  normalizeRedactionBox,
  PDF_REDACTION_LIMITS,
  pdfRedactionErrorMessage,
  type RedactionBox,
} from "@/lib/pdf-redaction";

type Output = { name: string; href: string; size: number; pages: number };

function errorCode(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "";
  if (/password|encrypted/i.test(message)) return "encrypted";
  if (/memory|allocation|heap/i.test(message)) return "memory";
  if (/invalid pdf|damaged|xref|trailer|unexpected end|formaterror/i.test(message))
    return "damaged-pdf";
  if (/worker|fetch|wasm|loading/i.test(message)) return "engine-unavailable";
  return message;
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("jpeg-encode-failed"))),
      "image/jpeg",
      0.96,
    ),
  );
}

export function PdfRedactTool() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [boxes, setBoxes] = useState<Record<number, RedactionBox[]>>({});
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [output, setOutput] = useState<Output | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const loadingRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const previewUrlRef = useRef("");
  const outputRef = useRef<Output | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const cancelledRef = useRef(false);
  const failureCodeRef = useRef("");

  const clearPreview = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setPreviewUrl("");
  };
  const clearOutput = () => {
    if (outputRef.current) URL.revokeObjectURL(outputRef.current.href);
    outputRef.current = null;
    setOutput(null);
  };
  const disposeDocument = () => {
    renderRef.current?.cancel();
    renderRef.current = null;
    const task = loadingRef.current;
    loadingRef.current = null;
    pdfRef.current = null;
    void task?.destroy().catch(() => undefined);
  };

  useEffect(
    () => () => {
      cancelledRef.current = true;
      disposeDocument();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (outputRef.current) URL.revokeObjectURL(outputRef.current.href);
    },
    [],
  );

  const selectFile = (selected?: File) => {
    if (!selected || busy) return;
    disposeDocument();
    clearPreview();
    clearOutput();
    setBoxes({});
    setPageCount(0);
    setCurrentPage(1);
    setError("");
    setProgress("");
    setAcknowledged(false);
    if (
      !selected.name.toLowerCase().endsWith(".pdf") ||
      (selected.type && !["application/pdf", "application/octet-stream"].includes(selected.type))
    ) {
      setFile(null);
      setError(pdfRedactionErrorMessage("wrong-type"));
    } else if (!selected.size) {
      setFile(null);
      setError(pdfRedactionErrorMessage("empty-file"));
    } else if (selected.size > PDF_REDACTION_LIMITS.inputBytes) {
      setFile(null);
      setError(pdfRedactionErrorMessage("input-too-large"));
    } else setFile(selected);
  };

  useEffect(() => {
    if (!file) return;
    let abandoned = false;
    let localRender: RenderTask | null = null;
    const loadPreview = async () => {
      setPreviewLoading(true);
      setError("");
      let page: PDFPageProxy | null = null;
      let canvas: HTMLCanvasElement | null = null;
      try {
        let document = pdfRef.current;
        if (!document) {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
          const data = new Uint8Array(await file.arrayBuffer());
          const loadingTask = pdfjs.getDocument({ data, stopAtErrors: true, useWasm: true });
          loadingRef.current = loadingTask;
          document = await loadingTask.promise;
          if (abandoned) {
            await loadingTask.destroy();
            return;
          }
          if (document.numPages < 1) throw new Error("empty-document");
          if (document.numPages > PDF_REDACTION_LIMITS.pages) throw new Error("too-many-pages");
          pdfRef.current = document;
          setPageCount(document.numPages);
        }
        if (currentPage > document.numPages) return;
        page = await document.getPage(currentPage);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(
          1,
          900 / base.width,
          900 / base.height,
          Math.sqrt(1_500_000 / (base.width * base.height)),
        );
        const viewport = page.getViewport({ scale });
        canvas = window.document.createElement("canvas");
        const previewCanvas = canvas;
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("memory");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        localRender = page.render({
          canvas,
          canvasContext: context,
          viewport,
          background: "#ffffff",
        });
        renderRef.current = localRender;
        await localRender.promise;
        if (abandoned) return;
        const blob = await new Promise<Blob>((resolve, reject) =>
          previewCanvas.toBlob(
            (image) => (image ? resolve(image) : reject(new Error("preview-failed"))),
            "image/png",
          ),
        );
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        renderRef.current = null;
      } catch (cause) {
        if (!abandoned) setError(pdfRedactionErrorMessage(errorCode(cause)));
      } finally {
        page?.cleanup();
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        if (!abandoned) setPreviewLoading(false);
      }
    };
    void loadPreview();
    return () => {
      abandoned = true;
      localRender?.cancel();
      if (renderRef.current === localRender) renderRef.current = null;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    };
  }, [file, currentPage]);

  const addBox = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || !previewUrl || busy) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const endX = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const endY = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const box = normalizeRedactionBox(dragStartRef.current.x, dragStartRef.current.y, endX, endY);
    dragStartRef.current = null;
    setDragging(false);
    if (box)
      setBoxes((previous) => ({
        ...previous,
        [currentPage]: [...(previous[currentPage] ?? []), box],
      }));
  };

  const redact = async () => {
    const document = pdfRef.current;
    if (!file || !document || busy) return;
    if (!Object.values(boxes).some((pageBoxes) => pageBoxes.length)) {
      setError("Draw at least one black redaction box over content you want permanently removed.");
      return;
    }
    if (!acknowledged) {
      setError(
        "Confirm that you understand redaction converts every page into an image and removes text selection, links, forms, and annotations.",
      );
      return;
    }
    setBusy(true);
    setError("");
    clearOutput();
    clearPreview();
    cancelledRef.current = false;
    failureCodeRef.current = "";
    const timer = window.setTimeout(() => {
      failureCodeRef.current = "timeout";
      cancelledRef.current = true;
      renderRef.current?.cancel();
    }, PDF_REDACTION_LIMITS.timeoutMs);
    try {
      const sanitized = await PDFDocument.create();
      sanitized.setTitle("");
      sanitized.setAuthor("");
      sanitized.setSubject("");
      sanitized.setKeywords([]);
      sanitized.setCreator("PDF Scanner");
      sanitized.setProducer("PDF Scanner redaction");
      let totalPixels = 0;
      let encodedBytes = 0;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        if (cancelledRef.current) throw new Error(failureCodeRef.current || "cancelled");
        setProgress(`Flattening and redacting page ${pageNumber} of ${document.numPages}…`);
        const page = await document.getPage(pageNumber);
        let canvas: HTMLCanvasElement | null = null;
        try {
          const base = page.getViewport({ scale: 1 });
          const scale = PDF_REDACTION_LIMITS.dpi / 72;
          const viewport = page.getViewport({ scale });
          const width = Math.ceil(viewport.width);
          const height = Math.ceil(viewport.height);
          const pixels = width * height;
          if (
            !Number.isFinite(pixels) ||
            pixels < 1 ||
            pixels > PDF_REDACTION_LIMITS.pagePixels ||
            totalPixels + pixels > PDF_REDACTION_LIMITS.totalPixels
          )
            throw new Error("page-too-large");
          totalPixels += pixels;
          canvas = window.document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("memory");
          context.fillStyle = "#fff";
          context.fillRect(0, 0, width, height);
          const render = page.render({
            canvas,
            canvasContext: context,
            viewport,
            background: "#ffffff",
          });
          renderRef.current = render;
          await render.promise;
          renderRef.current = null;
          for (const box of boxes[pageNumber] ?? []) {
            context.fillStyle = "#000000";
            context.fillRect(
              Math.floor(box.x * width),
              Math.floor(box.y * height),
              Math.ceil(box.width * width),
              Math.ceil(box.height * height),
            );
          }
          const jpeg = await canvasToJpeg(canvas);
          encodedBytes += jpeg.size;
          if (encodedBytes > PDF_REDACTION_LIMITS.outputBytes) throw new Error("output-too-large");
          const image = await sanitized.embedJpg(await jpeg.arrayBuffer());
          const pageWidth = base.width;
          const pageHeight = base.height;
          const outputPage = sanitized.addPage([pageWidth, pageHeight]);
          outputPage.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
        } finally {
          renderRef.current = null;
          page.cleanup();
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      }
      if (cancelledRef.current) throw new Error(failureCodeRef.current || "cancelled");
      setProgress("Saving sanitized PDF…");
      const bytes = await sanitized.save({ useObjectStreams: true });
      if (bytes.byteLength > PDF_REDACTION_LIMITS.outputBytes) throw new Error("output-too-large");
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const name = `${
        file.name
          .replace(/\.pdf$/i, "")
          .replace(/[\\/:*?"<>|]/g, "_")
          .trim() || "document"
      }-redacted.pdf`;
      const ready = {
        name,
        href: URL.createObjectURL(new Blob([buffer], { type: "application/pdf" })),
        size: bytes.byteLength,
        pages: document.numPages,
      };
      outputRef.current = ready;
      setOutput(ready);
      setProgress(
        `Finished: ${ready.pages} pages flattened; redacted regions are rasterized into the saved pages.`,
      );
    } catch (cause) {
      setProgress("");
      setError(pdfRedactionErrorMessage(errorCode(failureCodeRef.current || cause)));
    } finally {
      window.clearTimeout(timer);
      renderRef.current = null;
      setBusy(false);
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    failureCodeRef.current = "cancelled";
    renderRef.current?.cancel();
  };
  const pageBoxes = boxes[currentPage] ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <a
          href="/#security-pdf"
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> PDF security tools
        </a>
        <div className="mx-auto max-w-5xl">
          <header className="mb-8 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent text-primary">
              <ShieldAlert className="size-7" />
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">Redact PDF</h1>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Draw solid black boxes over sensitive content. The saved PDF rebuilds every page from
              a raster image, removing the original selectable page content beneath redactions.
            </p>
          </header>
          <section
            className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
            aria-label="Redact PDF"
          >
            {!file ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  selectFile(event.dataTransfer.files[0]);
                }}
                className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-border px-5 py-10 text-center transition hover:border-primary/60 hover:bg-soft/70"
              >
                <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
                  <Plus className="size-6" />
                </span>
                <strong className="mt-4">Choose a PDF or drop it here</strong>
                <span className="mt-1 text-sm text-muted-foreground">
                  Up to {formatRedactionBytes(PDF_REDACTION_LIMITS.inputBytes)} ·{" "}
                  {PDF_REDACTION_LIMITS.pages} pages
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3 sm:p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                  <FileText className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{file.name}</strong>
                  <small className="text-muted-foreground">
                    {formatRedactionBytes(file.size)}
                    {pageCount ? ` · ${pageCount} pages` : ""}
                  </small>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    disposeDocument();
                    clearPreview();
                    clearOutput();
                    setFile(null);
                    setPageCount(0);
                    setBoxes({});
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
            <input
              ref={inputRef}
              className="hidden"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                selectFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {file && (
              <div className="mt-5 rounded-xl border border-border bg-soft/50 p-3 sm:p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-bold">
                      Redact page {currentPage} of {pageCount || "…"}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Drag across content to add a black redaction box.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || currentPage <= 1}
                      onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      aria-label="Previous page"
                    >
                      <ArrowLeft className="size-4" />
                    </Button>
                    <span className="min-w-16 text-center text-sm tabular-nums">
                      {currentPage} / {pageCount || "—"}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || currentPage >= pageCount}
                      onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
                      aria-label="Next page"
                    >
                      <ArrowRight className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex min-h-80 items-center justify-center overflow-auto rounded-lg bg-slate-200 p-3">
                  {previewLoading && (
                    <p
                      role="status"
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <LoaderCircle className="size-4 animate-spin" />
                      Rendering page…
                    </p>
                  )}
                  {previewUrl && (
                    <div
                      className={`relative inline-block max-w-full select-none overflow-hidden shadow-md ${busy ? "pointer-events-none" : ""}`}
                      onPointerDown={(event) => {
                        if (!previewUrl || previewLoading || busy) return;
                        event.currentTarget.setPointerCapture(event.pointerId);
                        const rect = event.currentTarget.getBoundingClientRect();
                        dragStartRef.current = {
                          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
                          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
                        };
                        setDragging(true);
                      }}
                      onPointerUp={addBox}
                      onPointerCancel={() => {
                        dragStartRef.current = null;
                        setDragging(false);
                      }}
                      onPointerMove={(event) => {
                        if (!dragging || !dragStartRef.current) return;
                        const rect = event.currentTarget.getBoundingClientRect();
                        const endX = Math.max(
                          0,
                          Math.min(1, (event.clientX - rect.left) / rect.width),
                        );
                        const endY = Math.max(
                          0,
                          Math.min(1, (event.clientY - rect.top) / rect.height),
                        );
                        setBoxes((previous) => previous);
                        event.currentTarget.style.setProperty(
                          "--drag-left",
                          `${Math.min(dragStartRef.current.x, endX) * 100}%`,
                        );
                        event.currentTarget.style.setProperty(
                          "--drag-top",
                          `${Math.min(dragStartRef.current.y, endY) * 100}%`,
                        );
                        event.currentTarget.style.setProperty(
                          "--drag-width",
                          `${Math.abs(endX - dragStartRef.current.x) * 100}%`,
                        );
                        event.currentTarget.style.setProperty(
                          "--drag-height",
                          `${Math.abs(endY - dragStartRef.current.y) * 100}%`,
                        );
                      }}
                      style={{ touchAction: "none" }}
                    >
                      <img
                        src={previewUrl}
                        alt={`Page ${currentPage} preview`}
                        draggable={false}
                        className="block max-h-[70vh] max-w-full"
                      />
                      {pageBoxes.map((box, index) => (
                        <span
                          key={index}
                          className="absolute bg-black"
                          style={{
                            left: `${box.x * 100}%`,
                            top: `${box.y * 100}%`,
                            width: `${box.width * 100}%`,
                            height: `${box.height * 100}%`,
                          }}
                        />
                      ))}
                      {dragging && (
                        <span
                          className="pointer-events-none absolute bg-black/80"
                          style={{
                            left: "var(--drag-left)",
                            top: "var(--drag-top)",
                            width: "var(--drag-width)",
                            height: "var(--drag-height)",
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    {Object.values(boxes).reduce((sum, page) => sum + page.length, 0)} redaction
                    box(es) on {Object.keys(boxes).length} page(s)
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!pageBoxes.length || busy}
                    onClick={() => setBoxes((previous) => ({ ...previous, [currentPage]: [] }))}
                  >
                    <Trash2 className="size-4" /> Clear this page
                  </Button>
                </div>
              </div>
            )}
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={busy}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1 accent-primary"
              />
              <span>
                <strong className="block">I understand the output is rasterized</strong>
                <span className="mt-1 block leading-5 text-muted-foreground">
                  Every page becomes a JPEG image. Text selection/search, links, forms, annotations,
                  and accessibility structure are removed. Keep a copy of the original before
                  redacting.
                </span>
              </span>
            </label>
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
                <Button type="button" variant="outline" onClick={cancel}>
                  <X className="size-4" /> Cancel
                </Button>
              ) : (
                <Button type="button" disabled={!file || !pageCount} onClick={() => void redact()}>
                  <ShieldAlert className="size-4" /> Apply redactions and save
                </Button>
              )}
            </div>
            {busy && (
              <p className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Rasterizing every page locally…
              </p>
            )}
            {output && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-accent/40 p-4">
                <span>
                  <strong className="block text-sm">{output.name} is ready</strong>
                  <small className="text-muted-foreground">
                    {formatRedactionBytes(output.size)} · {output.pages} image-only pages
                  </small>
                </span>
                <a
                  href={output.href}
                  download={output.name}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"
                >
                  <Download className="size-4" /> Save PDF
                </a>
              </div>
            )}
            <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
              Your file stays in this browser. Limits: {PDF_REDACTION_LIMITS.pages} pages,{" "}
              {PDF_REDACTION_LIMITS.dpi} DPI,{" "}
              {formatRedactionBytes(PDF_REDACTION_LIMITS.outputBytes)} output. Verify the saved
              pages before sharing.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
