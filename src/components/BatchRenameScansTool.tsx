import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ArrowLeft, Download, FileText, LoaderCircle, Plus, ScanText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { formatScanBytes } from "@/lib/scan-utils";

const BATCH_LIMITS = {
  files: 20,
  inputBytes: 50 * 1024 * 1024,
  pagePixels: 2_500_000,
  timeoutMs: 10 * 60 * 1_000,
} as const;
type Scan = { id: number; file: File; name: string; href: string; note: string };
type TesseractWorker = {
  recognize: (canvas: HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};
type PdfJsDocument = { numPages: number; getPage: (page: number) => Promise<PDFPageProxy> };
type PdfJsLoadingTask = PDFDocumentLoadingTask & { promise: Promise<PdfJsDocument> };

function sanitizeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/./g, (character) => (character.charCodeAt(0) < 32 ? " " : character))
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function suggestedBaseName(text: string, fallback: string) {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find(
      (part) =>
        part.length >= 3 &&
        part.length <= 90 &&
        /[A-Za-z0-9]/.test(part) &&
        !/^(scan|document|receipt|invoice|page)\b/i.test(part),
    );
  return sanitizeName(line ?? "") || fallback;
}

function recognizedImage(file: File) {
  return (
    file.type.startsWith("image/") ||
    /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(file.name)
  );
}
function recognizedPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function BatchRenameScansTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ocrRef = useRef<TesseractWorker | null>(null);
  const loadingRef = useRef<PdfJsLoadingTask | null>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const nextId = useRef(0);
  const urlsRef = useRef(new Set<string>());

  const clearScans = () => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current.clear();
    setScans([]);
  };
  useEffect(
    () => () => {
      cancelledRef.current = true;
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      renderRef.current?.cancel();
      void loadingRef.current?.destroy();
      void ocrRef.current?.terminate();
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  const addFiles = (incoming: FileList | File[]) => {
    if (busy) return;
    const selected = Array.from(incoming);
    const invalid = selected.find((file) => !recognizedPdf(file) && !recognizedImage(file));
    if (invalid) {
      setError(`“${invalid.name}” is not a supported PDF or image.`);
      return;
    }
    if (selected.some((file) => !file.size)) {
      setError("One of the selected files is empty.");
      return;
    }
    if (files.length + selected.length > BATCH_LIMITS.files) {
      setError(`Rename up to ${BATCH_LIMITS.files} files at a time.`);
      return;
    }
    if (
      [...files, ...selected].reduce((sum, file) => sum + file.size, 0) > BATCH_LIMITS.inputBytes
    ) {
      setError(`Selected files exceed ${formatScanBytes(BATCH_LIMITS.inputBytes)} total input.`);
      return;
    }
    clearScans();
    setError("");
    setFiles((previous) => [...previous, ...selected]);
  };

  const suggestNames = async () => {
    if (!files.length || busy) return;
    clearScans();
    setBusy(true);
    setError("");
    setProgress("Loading OCR…");
    cancelledRef.current = false;
    let ocr: TesseractWorker | null = null;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      cancelledRef.current = true;
      renderRef.current?.cancel();
      void loadingRef.current?.destroy();
      void ocrRef.current?.terminate();
      setBusy(false);
      setProgress("");
      setError("Batch OCR exceeded the 10-minute safety limit. Try fewer or smaller files.");
    }, BATCH_LIMITS.timeoutMs);
    timeoutRef.current = timer;
    const results: Scan[] = [];
    try {
      const tesseract = await import("tesseract.js");
      ocr = (await tesseract.createWorker("eng", undefined, {
        logger: (message) => {
          if (message.status && message.progress > 0)
            setProgress(`Loading OCR… ${Math.round(message.progress * 100)}%`);
        },
      })) as unknown as TesseractWorker;
      ocrRef.current = ocr;
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      for (let index = 0; index < files.length; index++) {
        if (cancelledRef.current) throw new Error("cancelled");
        const file = files[index]!;
        const fallback = sanitizeName(file.name.replace(/\.[^.]+$/, "")) || `scan-${index + 1}`;
        setProgress(`Reading ${index + 1} of ${files.length}: ${file.name}`);
        let canvas: HTMLCanvasElement | null = null;
        let page: PDFPageProxy | null = null;
        try {
          if (recognizedPdf(file)) {
            const task = pdfjs.getDocument({
              data: new Uint8Array(await file.arrayBuffer()),
              stopAtErrors: true,
              useWasm: true,
            }) as PdfJsLoadingTask;
            loadingRef.current = task;
            const document = await task.promise;
            if (!document.numPages) throw new Error("empty-document");
            page = await document.getPage(1);
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(
              2,
              2_000 / Math.max(base.width, base.height),
              Math.sqrt(BATCH_LIMITS.pagePixels / (base.width * base.height)),
            );
            const viewport = page.getViewport({ scale });
            canvas = window.document.createElement("canvas");
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
            page.cleanup();
            page = null;
            await task.destroy();
            loadingRef.current = null;
          } else {
            const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
            try {
              const scale = Math.min(
                1,
                2_000 / Math.max(bitmap.width, bitmap.height),
                Math.sqrt(BATCH_LIMITS.pagePixels / (bitmap.width * bitmap.height)),
              );
              canvas = window.document.createElement("canvas");
              canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
              canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
              const context = canvas.getContext("2d", { alpha: false });
              if (!context) throw new Error("memory");
              context.fillStyle = "#fff";
              context.fillRect(0, 0, canvas.width, canvas.height);
              context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            } finally {
              bitmap.close();
            }
          }
          const recognized = await ocr.recognize(canvas!);
          const name = suggestedBaseName(recognized.data.text, fallback);
          const href = URL.createObjectURL(file);
          urlsRef.current.add(href);
          results.push({
            id: ++nextId.current,
            file,
            name,
            href,
            note: recognized.data.text.trim()
              ? "Name suggested from page-one OCR; review before saving."
              : "No text found; original file name retained.",
          });
        } catch (cause) {
          if (cancelledRef.current) throw cause;
          const href = URL.createObjectURL(file);
          urlsRef.current.add(href);
          results.push({
            id: ++nextId.current,
            file,
            name: fallback,
            href,
            note: "OCR could not read this file; original file name retained.",
          });
        } finally {
          renderRef.current = null;
          page?.cleanup();
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
        setScans([...results]);
      }
      setProgress(
        `${results.length} files are ready. Review each suggested name; file contents were not changed.`,
      );
    } catch (cause) {
      if (!cancelledRef.current)
        setError(
          timedOut
            ? "Batch OCR exceeded the 10-minute safety limit."
            : /network|fetch|worker|wasm|tesseract/i.test(
                  cause instanceof Error ? cause.message : "",
                )
              ? "English OCR could not load. Check your connection and try again."
              : "Batch name suggestions could not be completed.",
        );
      setProgress("");
      clearScans();
    } finally {
      window.clearTimeout(timer);
      timeoutRef.current = null;
      renderRef.current = null;
      loadingRef.current = null;
      ocrRef.current = null;
      await ocr?.terminate().catch(() => undefined);
      if (!cancelledRef.current) setBusy(false);
    }
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
    setError("Batch processing cancelled. Your source files were not changed.");
  };
  const updateName = (id: number, value: string) =>
    setScans((previous) =>
      previous.map((scan) => (scan.id === id ? { ...scan, name: value } : scan)),
    );
  const downloadName = (scan: Scan) =>
    `${sanitizeName(scan.name) || "scan"}${scan.file.name.match(/\.[^.]+$/)?.[0] ?? ""}`;

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
              <ScanText className="size-7" />
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Batch rename scans
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Suggest filenames from the first page of each scan. Review every name, then download
              files individually; file contents remain unchanged.
            </p>
          </header>
          <section
            className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
            aria-label="Batch rename scans"
          >
            <input
              ref={inputRef}
              className="hidden"
              type="file"
              accept="application/pdf,image/*,.pdf"
              multiple
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            {files.length === 0 ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDragEnter={() => setDragging(true)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  addFiles(event.dataTransfer.files);
                }}
                className={`flex w-full flex-col items-center rounded-xl border-2 border-dashed px-5 py-10 text-center ${dragging ? "border-primary bg-accent/40" : "border-border hover:border-primary/60 hover:bg-soft/70"}`}
              >
                <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
                  <Plus className="size-6" />
                </span>
                <strong className="mt-4">Choose or drop PDFs and scan images</strong>
                <span className="mt-1 text-sm text-muted-foreground">
                  Up to {BATCH_LIMITS.files} files · {formatScanBytes(BATCH_LIMITS.inputBytes)}{" "}
                  total input
                </span>
              </button>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-bold">Selected scans ({files.length})</h2>
                    <p className="text-sm text-muted-foreground">
                      OCR reads only the first page of each PDF.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => inputRef.current?.click()}
                    disabled={busy}
                  >
                    <Plus className="size-4" /> Add files
                  </Button>
                </div>
                <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
                  {files.map((file) => (
                    <li
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="flex items-center gap-3 p-3"
                    >
                      <FileText className="size-5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm">{file.name}</strong>
                        <small className="text-muted-foreground">
                          {formatScanBytes(file.size)}
                        </small>
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setFiles((previous) => previous.filter((item) => item !== file));
                          clearScans();
                        }}
                        aria-label={`Remove ${file.name}`}
                        className="rounded p-2 hover:bg-soft"
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
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
            <div className="mt-5 flex justify-center">
              {busy ? (
                <Button variant="outline" onClick={cancel}>
                  <X className="size-4" /> Cancel
                </Button>
              ) : (
                <Button disabled={!files.length} onClick={() => void suggestNames()}>
                  <ScanText className="size-4" /> Suggest names with OCR
                </Button>
              )}
            </div>
            {scans.length > 0 && (
              <div className="mt-6 border-t border-border pt-5">
                <h2 className="font-bold">Review and save files</h2>
                <ul className="mt-3 space-y-3">
                  {scans.map((scan) => (
                    <li
                      key={scan.id}
                      className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-[1fr_auto] md:items-end"
                    >
                      <label className="min-w-0 text-sm font-semibold">
                        New filename
                        <input
                          value={scan.name}
                          onChange={(event) => updateName(scan.id, event.target.value)}
                          className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2.5"
                        />
                        <small className="mt-1 block truncate font-normal text-muted-foreground">
                          {scan.note} · {scan.file.name}
                        </small>
                      </label>
                      <a
                        href={scan.href}
                        download={downloadName(scan)}
                        className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"
                      >
                        <Download className="size-4" /> Download renamed
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
              English OCR suggests names only; review them. Files stay in your browser, the
              recognition engine may download from a public CDN, and downloads are separate rather
              than one ZIP.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
