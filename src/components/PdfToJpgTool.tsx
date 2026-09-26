import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileImage,
  FileText,
  ImageDown,
  LoaderCircle,
  Plus,
  X,
} from "lucide-react";
import type {
  PDFPageProxy,
  PDFDocumentProxy,
  RenderTask,
  PDFDocumentLoadingTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { formatJpgBytes, PDF_TO_JPG_LIMITS, pdfToJpgErrorMessage } from "@/lib/pdf-to-jpg";

type PageImage = { page: number; href: string; size: number };
type PdfJsModule = typeof import("pdfjs-dist");

export function PdfToJpgTool() {
  const [file, setFile] = useState<File | null>(null);
  const [quality, setQuality] = useState(0.9);
  const [images, setImages] = useState<PageImage[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<PageImage[]>([]);
  const cancelRef = useRef(false);
  const failureCodeRef = useRef("");
  const renderRef = useRef<RenderTask | null>(null);
  const loadingRef = useRef<PDFDocumentLoadingTask | null>(null);

  const clearImages = () => {
    imagesRef.current.forEach(({ href }) => URL.revokeObjectURL(href));
    imagesRef.current = [];
    setImages([]);
  };

  useEffect(
    () => () => {
      cancelRef.current = true;
      renderRef.current?.cancel();
      void loadingRef.current?.destroy();
      imagesRef.current.forEach(({ href }) => URL.revokeObjectURL(href));
    },
    [],
  );

  const selectFile = (candidate?: File) => {
    if (busy || !candidate) return;
    clearImages();
    setError("");
    setProgress("");
    if (
      !candidate.name.toLowerCase().endsWith(".pdf") ||
      (candidate.type && !["application/pdf", "application/octet-stream"].includes(candidate.type))
    ) {
      setFile(null);
      setError(pdfToJpgErrorMessage("wrong-type"));
      return;
    }
    if (!candidate.size) {
      setFile(null);
      setError(pdfToJpgErrorMessage("empty-file"));
      return;
    }
    if (candidate.size > PDF_TO_JPG_LIMITS.inputBytes) {
      setFile(null);
      setError(pdfToJpgErrorMessage("input-too-large"));
      return;
    }
    setFile(candidate);
  };

  const stop = () => {
    cancelRef.current = true;
    if (!failureCodeRef.current) failureCodeRef.current = "cancelled";
    renderRef.current?.cancel();
    void loadingRef.current?.destroy();
  };

  const convert = async () => {
    if (!file || busy) return;
    clearImages();
    setError("");
    setBusy(true);
    setProgress("Starting PDF renderer…");
    cancelRef.current = false;
    failureCodeRef.current = "";
    let pdf: PDFDocumentProxy | null = null;
    const generated: PageImage[] = [];
    let totalPixels = 0;
    let totalBytes = 0;
    const timer = window.setTimeout(() => {
      failureCodeRef.current = "timeout";
      cancelRef.current = true;
      renderRef.current?.cancel();
      void loadingRef.current?.destroy();
    }, PDF_TO_JPG_LIMITS.timeoutMs);

    try {
      const pdfjs: PdfJsModule = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const task = pdfjs.getDocument({ data: bytes, stopAtErrors: true, useWasm: true });
      loadingRef.current = task;
      pdf = await task.promise;
      if (pdf.numPages < 1) throw new Error("empty-document");
      if (pdf.numPages > PDF_TO_JPG_LIMITS.pages) throw new Error("too-many-pages");

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        if (cancelRef.current) throw new Error(failureCodeRef.current || "cancelled");
        setProgress(`Rendering page ${pageNumber} of ${pdf.numPages}…`);
        const page: PDFPageProxy = await pdf.getPage(pageNumber);
        let canvas: HTMLCanvasElement | null = null;
        try {
          const base = page.getViewport({ scale: 1 });
          const scale = PDF_TO_JPG_LIMITS.dpi / 72;
          const width = Math.ceil(base.width * scale);
          const height = Math.ceil(base.height * scale);
          const pixels = width * height;
          if (
            !Number.isFinite(pixels) ||
            pixels < 1 ||
            pixels > PDF_TO_JPG_LIMITS.pagePixels ||
            totalPixels + pixels > PDF_TO_JPG_LIMITS.totalPixels
          ) {
            throw new Error("page-too-large");
          }
          totalPixels += pixels;
          canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("engine-unavailable");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
          const render = page.render({
            canvas,
            canvasContext: context,
            viewport: page.getViewport({ scale }),
          });
          renderRef.current = render;
          await render.promise;
          renderRef.current = null;
          const blob = await canvasToJpeg(canvas, quality);
          if (cancelRef.current) throw new Error(failureCodeRef.current || "cancelled");
          totalBytes += blob.size;
          if (totalBytes > PDF_TO_JPG_LIMITS.outputBytes) throw new Error("output-too-large");
          const image = { page: pageNumber, href: URL.createObjectURL(blob), size: blob.size };
          generated.push(image);
          imagesRef.current = [...generated];
          setImages([...generated]);
        } finally {
          renderRef.current = null;
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
          page.cleanup();
        }
      }
      setProgress(
        `Finished ${generated.length} JPG ${generated.length === 1 ? "image" : "images"}.`,
      );
    } catch (cause) {
      generated.forEach(({ href }) => URL.revokeObjectURL(href));
      imagesRef.current = [];
      setImages([]);
      const raw = failureCodeRef.current || (cause instanceof Error ? cause.message : "");
      const code =
        raw === "cancelled" ||
        raw === "timeout" ||
        raw === "page-too-large" ||
        raw === "output-too-large" ||
        raw === "empty-document" ||
        raw === "too-many-pages" ||
        raw === "engine-unavailable"
          ? raw
          : /password|encrypted/i.test(raw)
            ? "encrypted"
            : /memory|allocation|heap/i.test(raw)
              ? "memory"
              : /invalid pdf|damaged|xref|trailer|unexpected end|formaterror/i.test(raw)
                ? "damaged-pdf"
                : /worker|fetch|wasm|loading/i.test(raw)
                  ? "engine-unavailable"
                  : "processing-failed";
      setError(pdfToJpgErrorMessage(code));
      setProgress("");
    } finally {
      window.clearTimeout(timer);
      renderRef.current = null;
      const activeLoadingTask = loadingRef.current;
      loadingRef.current = null;
      await activeLoadingTask?.destroy().catch(() => undefined);
      setBusy(false);
    }
  };

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
              <FileImage className="size-7" />
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">PDF to JPG</h1>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Turn every PDF page into a sharp JPG image. Pages are rendered one at a time in your
              browser.
            </p>
          </header>
          <section
            className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
            aria-label="PDF to JPG conversion"
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
                  Up to {formatJpgBytes(PDF_TO_JPG_LIMITS.inputBytes)} · {PDF_TO_JPG_LIMITS.pages}{" "}
                  pages
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3 sm:p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                  <FileText className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{file.name}</strong>
                  <small className="text-muted-foreground">{formatJpgBytes(file.size)}</small>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setFile(null);
                    clearImages();
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
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => {
                selectFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <label className="mt-5 block text-sm font-semibold">
              JPG quality{" "}
              <span className="font-normal text-muted-foreground">
                ({Math.round(quality * 100)}%)
              </span>
              <input
                type="range"
                min="70"
                max="95"
                step="5"
                value={Math.round(quality * 100)}
                disabled={busy}
                onChange={(event) => setQuality(Number(event.target.value) / 100)}
                className="mt-3 block w-full accent-primary"
              />
              <span className="mt-1 flex justify-between text-xs font-normal text-muted-foreground">
                <span>Smaller files</span>
                <span>Higher quality</span>
              </span>
            </label>
            <div className="mt-5 flex justify-center gap-3">
              {busy ? (
                <Button type="button" variant="outline" onClick={stop}>
                  <X className="size-4" /> Cancel
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => void convert()}
                  disabled={!file}
                  className="min-w-48"
                >
                  <ImageDown className="size-4" /> Convert to JPG
                </Button>
              )}
            </div>
            {busy && (
              <p
                role="status"
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
            {!busy && progress && !error && (
              <p role="status" className="mt-4 text-center text-sm text-muted-foreground">
                {progress}
              </p>
            )}
            <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
              Limits: {PDF_TO_JPG_LIMITS.pages} pages,{" "}
              {formatJpgBytes(PDF_TO_JPG_LIMITS.outputBytes)} total JPG output,{" "}
              {PDF_TO_JPG_LIMITS.dpi} DPI, {PDF_TO_JPG_LIMITS.pagePixels.toLocaleString()} pixels
              per page. Processing stays on this device.
            </p>
            {images.length > 0 && (
              <div className="mt-6 border-t border-border pt-5">
                <h2 className="font-bold">
                  Your JPG images{" "}
                  <span className="font-normal text-muted-foreground">({images.length})</span>
                </h2>
                <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                  {images.map((image) => (
                    <li key={image.page} className="flex items-center gap-3 p-3">
                      <FileImage className="size-5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 text-sm">
                        <strong className="block">Page {image.page}</strong>
                        <span className="text-muted-foreground">{formatJpgBytes(image.size)}</span>
                      </span>
                      <a
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-soft"
                        href={image.href}
                        download={`${file?.name.replace(/\.pdf$/i, "") || "document"}-page-${image.page}.jpg`}
                      >
                        <Download className="size-4" />
                        <span className="hidden sm:inline">Download</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("jpeg-encode-failed"));
      },
      "image/jpeg",
      quality,
    ),
  );
}
