import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ArrowLeft,
  ArrowLeftRight,
  Download,
  FileEdit,
  LoaderCircle,
  Minus,
  Plus,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  formatBytes,
  pdfDocumentToolError,
  PDF_DOCUMENT_TOOL_LIMITS,
  type CropMargins,
  type PageNumberStyle,
  type PdfDocumentToolRequest,
  type PdfDocumentToolResponse,
  type PdfMarkup,
} from "@/lib/pdf-document-tools";

export type PdfDocumentToolMode = "edit" | "page-numbers" | "crop";

const copy: Record<PdfDocumentToolMode, { title: string; description: string; output: string }> = {
  edit: {
    title: "Edit PDF",
    description:
      "Add text, notes, and shapes on top of a PDF page. Existing page text is not rewritten.",
    output: "edited.pdf",
  },
  "page-numbers": {
    title: "Page numbers",
    description: "Add consistent page numbers to every page of your PDF.",
    output: "numbered.pdf",
  },
  crop: {
    title: "Crop PDF",
    description: "Adjust the visible page area with the same margins on each page.",
    output: "cropped.pdf",
  },
};

function previewError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "";
  if (/password|encrypted/i.test(message))
    return "This PDF is password-protected. Unlock it before using this tool.";
  if (/memory|allocation|heap/i.test(message)) return pdfDocumentToolError("memory");
  return pdfDocumentToolError("damaged-pdf");
}

export function PdfDocumentTool({ mode }: { mode: PdfDocumentToolMode }) {
  const info = copy[mode];
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<{ href: string; size: number } | null>(null);
  const [items, setItems] = useState<PdfMarkup[]>([]);
  const [markupType, setMarkupType] = useState<PdfMarkup["type"]>("text");
  const [text, setText] = useState("");
  const [color, setColor] = useState("#b30015");
  const [fontSize, setFontSize] = useState(16);
  const [margins, setMargins] = useState<CropMargins>({ top: 24, right: 24, bottom: 24, left: 24 });
  const [startNumber, setStartNumber] = useState(1);
  const [numberStyle, setNumberStyle] = useState<PageNumberStyle>("number");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<PageViewport | null>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const loadingRef = useRef<PDFDocumentLoadingTask | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const outputRef = useRef<string | null>(null);
  const nextId = useRef(0);

  const clearOutput = () => {
    if (outputRef.current) URL.revokeObjectURL(outputRef.current);
    outputRef.current = null;
    setOutput(null);
  };

  useEffect(
    () => () => {
      renderRef.current?.cancel();
      void loadingRef.current?.destroy().catch(() => undefined);
      workerRef.current?.terminate();
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      if (outputRef.current) URL.revokeObjectURL(outputRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (cancelled) return;
        const task = pdfjs.getDocument({ data: bytes, stopAtErrors: true, useWasm: true });
        loadingRef.current = task;
        const loaded = await task.promise;
        if (cancelled) {
          await task.destroy();
          return;
        }
        if (!loaded.numPages) throw new Error("empty-document");
        if (loaded.numPages > PDF_DOCUMENT_TOOL_LIMITS.pages) throw new Error("too-many-pages");
        setDocument(loaded);
        setPageCount(loaded.numPages);
      } catch (cause) {
        if (!cancelled) setError(previewError(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      renderRef.current?.cancel();
      renderRef.current = null;
      const task = loadingRef.current;
      loadingRef.current = null;
      void task?.destroy().catch(() => undefined);
      setDocument(null);
      setLoading(false);
    };
  }, [file]);

  useEffect(() => {
    if (!document || mode === "page-numbers") return;
    let cancelled = false;
    let page: PDFPageProxy | null = null;
    void (async () => {
      try {
        page = await document.getPage(currentPage);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(
          1.5,
          Math.sqrt(PDF_DOCUMENT_TOOL_LIMITS.previewPixels / (base.width * base.height)),
        );
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d", { alpha: false });
        if (!canvas || !context) throw new Error("memory");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        viewportRef.current = viewport;
        const task = page.render({
          canvas,
          canvasContext: context,
          viewport,
          background: "#ffffff",
        });
        renderRef.current = task;
        await task.promise;
      } catch (cause) {
        if (!cancelled) setError(previewError(cause));
      }
    })();
    return () => {
      cancelled = true;
      renderRef.current?.cancel();
      renderRef.current = null;
      page?.cleanup();
    };
  }, [document, currentPage, mode]);

  const selectFile = (selected?: File) => {
    if (!selected || busy) return;
    setError("");
    clearOutput();
    setDocument(null);
    setPageCount(0);
    setCurrentPage(1);
    setItems([]);
    if (
      !selected.name.toLowerCase().endsWith(".pdf") ||
      (selected.type && !["application/pdf", "application/octet-stream"].includes(selected.type))
    ) {
      setError(pdfDocumentToolError("wrong-type"));
      return;
    }
    if (!selected.size) {
      setError(pdfDocumentToolError("empty-file"));
      return;
    }
    if (selected.size > PDF_DOCUMENT_TOOL_LIMITS.inputBytes) {
      setError(pdfDocumentToolError("input-too-large"));
      return;
    }
    setFile(selected);
  };

  const placeMarkup = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!file || busy || mode !== "edit" || (markupType !== "rectangle" && !text.trim())) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (items.length >= PDF_DOCUMENT_TOOL_LIMITS.editItems) {
      setError(`Add no more than ${PDF_DOCUMENT_TOOL_LIMITS.editItems} annotations.`);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const [x, y] = viewport.convertToPdfPoint(
      ((event.clientX - rect.left) * viewport.width) / rect.width,
      ((event.clientY - rect.top) * viewport.height) / rect.height,
    );
    const width = markupType === "rectangle" ? 144 : markupType === "note" ? 220 : 260;
    const height = markupType === "rectangle" ? 72 : markupType === "note" ? 100 : 40;
    const newItem: PdfMarkup = {
      id: ++nextId.current,
      pageIndex: currentPage - 1,
      type: markupType,
      x: Math.max(0, x),
      y: Math.max(0, y),
      width,
      height,
      text: text.trim().slice(0, 500),
      color,
      fontSize,
    };
    setItems((previous) => [...previous, newItem]);
    setError("");
  };

  const run = async () => {
    if (!file || busy || !pageCount) return;
    if (mode === "edit" && items.length === 0) {
      setError("Add at least one text item, note, or shape to the page.");
      return;
    }
    if (mode === "crop" && Object.values(margins).every((value) => value === 0)) {
      setError("Enter at least one crop margin greater than zero.");
      return;
    }
    setBusy(true);
    setError("");
    clearOutput();
    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/pdf-document-tools.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      setBusy(false);
      setError("The PDF processor could not start. Refresh and try again.");
      return;
    }
    workerRef.current = worker;
    const finish = () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      if (workerRef.current === worker) workerRef.current = null;
      worker.terminate();
      setBusy(false);
    };
    timeoutRef.current = window.setTimeout(() => {
      if (workerRef.current !== worker) return;
      workerRef.current = null;
      worker.terminate();
      timeoutRef.current = null;
      setBusy(false);
      setError(pdfDocumentToolError("timeout"));
    }, PDF_DOCUMENT_TOOL_LIMITS.timeoutMs);
    worker.onmessage = (event: MessageEvent<PdfDocumentToolResponse>) => {
      if (workerRef.current !== worker) return;
      finish();
      if (event.data.type === "error") {
        setError(pdfDocumentToolError(event.data.code));
        return;
      }
      const blob = new Blob([event.data.bytes], { type: "application/pdf" });
      const href = URL.createObjectURL(blob);
      outputRef.current = href;
      setOutput({ href, size: blob.size });
    };
    worker.onerror = (event) => {
      if (workerRef.current !== worker) return;
      event.preventDefault();
      finish();
      setError(
        pdfDocumentToolError(
          /memory|allocation|heap/i.test(event.message) ? "memory" : "processing-failed",
        ),
      );
    };
    worker.onmessageerror = () => {
      if (workerRef.current !== worker) return;
      finish();
      setError(pdfDocumentToolError("processing-failed"));
    };
    try {
      const input = await file.arrayBuffer();
      if (workerRef.current !== worker) return;
      const request: PdfDocumentToolRequest =
        mode === "edit"
          ? { type: "save", mode, input, items }
          : mode === "crop"
            ? { type: "save", mode, input, margins }
            : {
                type: "save",
                mode,
                input,
                startNumber,
                style: numberStyle,
                color,
                fontSize: Math.min(36, fontSize),
              };
      worker.postMessage(request, [input]);
    } catch {
      if (workerRef.current === worker) {
        finish();
        setError(pdfDocumentToolError("memory"));
      }
    }
  };

  const removeItem = (id: number) =>
    setItems((previous) => previous.filter((item) => item.id !== id));
  const cancelProcessing = () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(false);
    setError(pdfDocumentToolError("cancelled"));
  };
  const markers = items
    .filter((item) => item.pageIndex === currentPage - 1)
    .map((item) => {
      const viewport = viewportRef.current;
      if (!viewport) return null;
      const [x, y] = viewport.convertToViewportPoint(item.x, item.y);
      if (item.type === "rectangle") {
        const [endX, endY] = viewport.convertToViewportPoint(
          item.x + item.width,
          item.y + item.height,
        );
        return (
          <span
            key={item.id}
            className="pointer-events-none absolute z-10"
            title="Rectangle shape"
            style={{
              left: `${(Math.min(x, endX) / viewport.width) * 100}%`,
              top: `${(Math.min(y, endY) / viewport.height) * 100}%`,
              width: `${(Math.abs(endX - x) / viewport.width) * 100}%`,
              height: `${(Math.abs(endY - y) / viewport.height) * 100}%`,
              border: `2px solid ${item.color}`,
              backgroundColor: `${item.color}22`,
            }}
          />
        );
      }
      return (
        <span
          key={item.id}
          className="absolute z-10 max-w-[45%] -translate-y-full truncate rounded bg-amber-200 px-1.5 py-1 text-[11px] text-black shadow"
          style={{
            left: `${(x / viewport.width) * 100}%`,
            top: `${(y / viewport.height) * 100}%`,
          }}
          title={item.text}
        >
          {item.text}
        </span>
      );
    });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <a
          href="/#edit-pdf"
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Edit and sign tools
        </a>
        <header className="mx-auto mb-8 mt-7 max-w-3xl text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent text-primary">
            <FileEdit className="size-7" />
          </span>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">{info.title}</h1>
          <p className="mt-3 text-muted-foreground">
            {info.description} Files are processed locally in your browser.
          </p>
        </header>
        <section
          className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-7"
          aria-label={info.title}
        >
          <input
            ref={fileInputRef}
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
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-border px-5 py-10 text-center hover:border-primary/60 hover:bg-soft/70"
            >
              <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
                <Plus className="size-6" />
              </span>
              <strong className="mt-4">
                Choose a PDF to {mode === "edit" ? "annotate" : mode === "crop" ? "crop" : "number"}
              </strong>
              <span className="mt-1 text-sm text-muted-foreground">
                Maximum {formatBytes(PDF_DOCUMENT_TOOL_LIMITS.inputBytes)} ·{" "}
                {PDF_DOCUMENT_TOOL_LIMITS.pages.toLocaleString()} pages
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <FileEdit className="size-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm">{file.name}</strong>
                <small className="text-muted-foreground">
                  {formatBytes(file.size)}
                  {pageCount ? ` · ${pageCount} pages` : ""}
                </small>
              </span>
              <button
                type="button"
                aria-label="Remove PDF"
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  setDocument(null);
                  setPageCount(0);
                  setItems([]);
                  clearOutput();
                  setError("");
                }}
                className="rounded p-2 text-muted-foreground hover:bg-soft"
              >
                <X className="size-4" />
              </button>
            </div>
          )}

          {file && loading && (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Loading PDF preview…
            </p>
          )}

          {file && pageCount > 0 && mode === "edit" && (
            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_270px]">
              <div className="min-w-0">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-bold">
                    Preview · page {currentPage} of {pageCount}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((page) => page - 1)}
                    >
                      <ArrowLeft className="size-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage >= pageCount}
                      onClick={() => setCurrentPage((page) => page + 1)}
                    >
                      Next
                      <ArrowLeftRight className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-lg border bg-white shadow-sm">
                  <canvas
                    ref={canvasRef}
                    onClick={placeMarkup}
                    className={`block h-auto w-full ${markupType === "rectangle" || text.trim() ? "cursor-crosshair" : "cursor-default"}`}
                    aria-label={`PDF page ${currentPage} preview`}
                  />
                  {markers}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Click the page to place the selected item. Existing text and images stay
                  unchanged.
                </p>
              </div>
              <aside className="space-y-4 rounded-xl border border-border bg-background p-4">
                <label className="block text-sm font-bold">
                  Add to page
                  <select
                    className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2"
                    value={markupType}
                    onChange={(event) => setMarkupType(event.target.value as PdfMarkup["type"])}
                  >
                    <option value="text">Text</option>
                    <option value="note">Note</option>
                    <option value="rectangle">Rectangle shape</option>
                  </select>
                </label>
                {markupType !== "rectangle" && (
                  <label className="block text-sm font-bold">
                    Text or note
                    <textarea
                      maxLength={500}
                      rows={3}
                      className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2 font-normal"
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      placeholder="Type what to add"
                    />
                  </label>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm font-bold">
                    Color
                    <input
                      type="color"
                      className="mt-2 block h-10 w-full cursor-pointer rounded-md border border-input bg-background p-1"
                      value={color}
                      onChange={(event) => setColor(event.target.value)}
                    />
                  </label>
                  <label className="block text-sm font-bold">
                    Text size
                    <input
                      type="number"
                      min={6}
                      max={96}
                      className="mt-2 block h-10 w-full rounded-md border border-input bg-background px-2"
                      value={fontSize}
                      onChange={(event) => setFontSize(Number(event.target.value))}
                    />
                  </label>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!items.length || busy}
                  onClick={() => setItems((previous) => previous.slice(0, -1))}
                >
                  <Undo2 className="size-4" />
                  Undo last
                </Button>
                <div className="max-h-40 space-y-2 overflow-y-auto">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 rounded border p-2 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        Page {item.pageIndex + 1} · {item.type}
                        {item.text ? ` · ${item.text}` : ""}
                      </span>
                      <button
                        aria-label="Remove annotation"
                        onClick={() => removeItem(item.id)}
                        className="rounded p-1 hover:bg-soft"
                      >
                        <Minus className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          )}

          {file && pageCount > 0 && mode === "page-numbers" && (
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <label className="text-sm font-bold">
                First page number
                <input
                  type="number"
                  min={1}
                  max={1_000_000}
                  value={startNumber}
                  onChange={(event) => setStartNumber(Number(event.target.value))}
                  className="mt-2 block h-11 w-full rounded-md border border-input bg-background px-3"
                />
              </label>
              <label className="text-sm font-bold">
                Number format
                <select
                  value={numberStyle}
                  onChange={(event) => setNumberStyle(event.target.value as PageNumberStyle)}
                  className="mt-2 block h-11 w-full rounded-md border border-input bg-background px-3"
                >
                  <option value="number">1</option>
                  <option value="page">Page 1</option>
                  <option value="of">1 of {pageCount}</option>
                </select>
              </label>
              <label className="text-sm font-bold">
                Appearance
                <div className="mt-2 flex gap-2">
                  <input
                    type="color"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    className="h-11 w-14 cursor-pointer rounded-md border bg-background p-1"
                  />
                  <input
                    type="number"
                    min={6}
                    max={36}
                    value={fontSize}
                    onChange={(event) => setFontSize(Number(event.target.value))}
                    aria-label="Page number font size"
                    className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3"
                  />
                </div>
              </label>
              <p className="text-xs leading-5 text-muted-foreground sm:col-span-3">
                Numbers are placed near the bottom center of each page. Existing page content is
                preserved.
              </p>
            </div>
          )}

          {file && pageCount > 0 && mode === "crop" && (
            <div className="mt-6">
              <p className="mb-2 text-sm font-bold">Preview · first page</p>
              <div className="mx-auto mb-5 max-w-2xl overflow-hidden rounded border bg-white shadow-sm">
                <canvas
                  ref={canvasRef}
                  className="block h-auto w-full"
                  aria-label="First page crop preview"
                />
              </div>
              <p className="mb-4 text-xs text-muted-foreground">
                The preview shows the source page. Crop margins are applied to every page.
              </p>
              <p className="text-sm font-bold">Crop margins (PDF points)</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Apply equal margins to each page. 72 points = 1 inch. At least 1 inch of page area
                is preserved in each dimension.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {(["top", "right", "bottom", "left"] as const).map((side) => (
                  <label key={side} className="text-sm font-bold capitalize">
                    {side}
                    <input
                      type="number"
                      min={0}
                      max={720}
                      step={1}
                      value={margins[side]}
                      onChange={(event) =>
                        setMargins((previous) => ({
                          ...previous,
                          [side]: Number(event.target.value) || 0,
                        }))
                      }
                      className="mt-2 block h-11 w-full rounded-md border border-input bg-background px-3"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-3 rounded-lg bg-accent/50 p-3 text-xs leading-5 text-muted-foreground">
                Cropping changes the visible page boundary. Content outside the crop can remain in
                the PDF and may be recoverable; use Redact PDF when content must be permanently
                removed.
              </p>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
            >
              {error}
            </p>
          )}
          {file && pageCount > 0 && (
            <Button
              type="button"
              disabled={busy || loading}
              onClick={() => void run()}
              className="mt-6 h-12 w-full text-base font-bold"
            >
              {busy ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  Processing PDF…
                </>
              ) : (
                <>
                  <Download />
                  Create {mode === "edit" ? "edited" : mode === "crop" ? "cropped" : "numbered"} PDF
                </>
              )}
            </Button>
          )}
          {busy && (
            <Button
              type="button"
              variant="outline"
              onClick={cancelProcessing}
              className="mt-3 w-full"
            >
              Cancel processing
            </Button>
          )}
          {output && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-accent/40 p-4">
              <div>
                <strong className="block">Your PDF is ready</strong>
                <span className="text-sm text-muted-foreground">{formatBytes(output.size)}</span>
              </div>
              <a
                href={output.href}
                download={info.output}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"
              >
                <Download className="size-4" />
                Download
              </a>
            </div>
          )}
          <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
            Files stay on this device. Inputs and outputs up to{" "}
            {formatBytes(PDF_DOCUMENT_TOOL_LIMITS.inputBytes)} ·{" "}
            {PDF_DOCUMENT_TOOL_LIMITS.pages.toLocaleString()} pages. Password-protected or complex
            PDFs may not be supported.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
