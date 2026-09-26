import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Download,
  FileImage,
  LoaderCircle,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  IMAGE_TO_PDF_LIMITS,
  type ImagePdfEnhancement,
  type ImagePdfMargin,
  type ImagePdfPaperSize,
} from "@/lib/image-to-pdf";
import { formatScanBytes } from "@/lib/scan-utils";

type PageImage = { id: number; file: File; url: string; rotation: number };
type WorkerResponse =
  | { type: "progress"; completed: number; total: number; fileName: string }
  | { type: "saving" }
  | { type: "success"; bytes: ArrayBuffer }
  | { type: "error"; code: string; fileName?: string };
type Output = { name: string; href: string; size: number };

function imageError(code: string, fileName?: string) {
  switch (code) {
    case "unsupported-format":
      return `${fileName ? `“${fileName}”` : "This image"} uses a format this browser cannot decode.`;
    case "processor-unavailable":
      return "This browser cannot apply the selected enhancement. Try a recent Chrome, Edge, Firefox, or Safari.";
    case "image-too-large":
      return `${fileName ? `“${fileName}”` : "An image"} exceeds 40 megapixels or 16,000 pixels on a side.`;
    case "too-many-pixels":
      return `The images exceed ${IMAGE_TO_PDF_LIMITS.totalPixels / 1_000_000} megapixels total.`;
    case "too-large-output":
      return `The enhanced PDF exceeds ${formatScanBytes(IMAGE_TO_PDF_LIMITS.outputBytes)}.`;
    case "memory":
      return "Your browser ran out of memory. Try fewer or smaller images.";
    case "cancelled":
      return "Page cleanup was cancelled. Your original images were not changed.";
    default:
      return "We couldn’t process these images. Try another format or a smaller selection.";
  }
}

export function SmartPageCleanupTool() {
  const [pages, setPages] = useState<PageImage[]>([]);
  const [enhancement, setEnhancement] = useState<ImagePdfEnhancement>("natural");
  const [paperSize, setPaperSize] = useState<ImagePdfPaperSize>("a4");
  const [margin, setMargin] = useState<ImagePdfMargin>(24);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [output, setOutput] = useState<Output | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const pagesRef = useRef<PageImage[]>([]);
  const outputRef = useRef<Output | null>(null);
  const nextId = useRef(0);

  const clearOutput = () => {
    if (outputRef.current) URL.revokeObjectURL(outputRef.current.href);
    outputRef.current = null;
    setOutput(null);
  };
  const stopWorker = () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
  };
  useEffect(
    () => () => {
      stopWorker();
      pagesRef.current.forEach(({ url }) => URL.revokeObjectURL(url));
      if (outputRef.current) URL.revokeObjectURL(outputRef.current.href);
    },
    [],
  );

  const addFiles = (incoming: FileList | File[]) => {
    if (busy) return;
    const files = Array.from(incoming).filter(
      (file) =>
        file.type.startsWith("image/") ||
        /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(file.name),
    );
    if (!files.length) {
      setError("Choose one or more image files to clean up.");
      return;
    }
    if (pages.length + files.length > IMAGE_TO_PDF_LIMITS.files) {
      setError(`Choose up to ${IMAGE_TO_PDF_LIMITS.files} images.`);
      return;
    }
    const combined =
      pages.reduce((sum, page) => sum + page.file.size, 0) +
      files.reduce((sum, file) => sum + file.size, 0);
    if (combined > IMAGE_TO_PDF_LIMITS.totalInputBytes) {
      setError(
        `The images exceed ${formatScanBytes(IMAGE_TO_PDF_LIMITS.totalInputBytes)} combined input.`,
      );
      return;
    }
    const empty = files.find((file) => !file.size);
    if (empty) {
      setError(`“${empty.name}” is empty.`);
      return;
    }
    clearOutput();
    setError("");
    const additions = files.map((file) => ({
      id: ++nextId.current,
      file,
      url: URL.createObjectURL(file),
      rotation: 0,
    }));
    setPages((previous) => {
      const next = [...previous, ...additions];
      pagesRef.current = next;
      return next;
    });
  };

  const updatePages = (next: PageImage[]) => {
    pagesRef.current = next;
    setPages(next);
    clearOutput();
  };
  const rotate = (id: number) =>
    updatePages(
      pages.map((page) =>
        page.id === id ? { ...page, rotation: (page.rotation + 90) % 360 } : page,
      ),
    );
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
    [next[index], next[target]] = [next[target]!, next[index]!];
    updatePages(next);
  };
  const remove = (id: number) => {
    const page = pages.find((item) => item.id === id);
    if (page) URL.revokeObjectURL(page.url);
    updatePages(pages.filter((item) => item.id !== id));
  };

  const createPdf = () => {
    if (!pages.length || busy) return;
    clearOutput();
    setBusy(true);
    setError("");
    setStatus("Preparing cleaned pages…");
    const worker = new Worker(new URL("../workers/images-to-pdf.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    const finish = () => {
      stopWorker();
      setBusy(false);
    };
    timeoutRef.current = window.setTimeout(
      () => {
        if (workerRef.current !== worker) return;
        worker.terminate();
        workerRef.current = null;
        timeoutRef.current = null;
        setError("Page cleanup exceeded the 10-minute safety limit. Try fewer or smaller images.");
        setStatus("");
        setBusy(false);
      },
      10 * 60 * 1_000,
    );
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (workerRef.current !== worker) return;
      const message = event.data;
      if (message.type === "progress")
        setStatus(`Cleaning page ${message.completed} of ${message.total}…`);
      else if (message.type === "saving") setStatus("Saving the cleaned PDF…");
      else if (message.type === "error") {
        setError(imageError(message.code, message.fileName));
        setStatus("");
        finish();
      } else {
        const blob = new Blob([message.bytes], { type: "application/pdf" });
        const result = {
          name: "cleaned-scan.pdf",
          href: URL.createObjectURL(blob),
          size: blob.size,
        };
        outputRef.current = result;
        setOutput(result);
        setStatus(`${pages.length} pages saved with the selected rotations and tone.`);
        finish();
      }
    };
    worker.onerror = () => {
      if (workerRef.current !== worker) return;
      setError(imageError("failed"));
      setStatus("");
      finish();
    };
    worker.postMessage({
      files: pages.map(({ file }) => file),
      paperSize,
      margin,
      options: { enhancement, rotations: pages.map(({ rotation }) => rotation) },
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <a
          href="/#scan-ocr"
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Scan and recognize
        </a>
        <div className="mx-auto max-w-5xl">
          <header className="mb-8 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent text-primary">
              <RotateCw className="size-7" />
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Smart page cleanup
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Rotate pages, improve contrast, and combine your cleaned scans into a PDF. Changes are
              applied to a new copy.
            </p>
          </header>
          <section
            className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
            aria-label="Clean scanned pages"
          >
            <input
              ref={inputRef}
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            {pages.length === 0 ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  addFiles(event.dataTransfer.files);
                }}
                className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-border px-5 py-10 text-center hover:border-primary/60 hover:bg-soft/70"
              >
                <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
                  <Plus className="size-6" />
                </span>
                <strong className="mt-4">Choose or drop scanned images</strong>
                <span className="mt-1 text-sm text-muted-foreground">
                  Up to {IMAGE_TO_PDF_LIMITS.files} images ·{" "}
                  {formatScanBytes(IMAGE_TO_PDF_LIMITS.totalInputBytes)} combined input
                </span>
              </button>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-bold">Scan pages ({pages.length})</h2>
                    <p className="text-sm text-muted-foreground">
                      Rotate individual pages and choose a tone for the PDF.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => inputRef.current?.click()}
                    disabled={busy}
                  >
                    <Plus className="size-4" /> Add images
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {pages.map((page, index) => (
                    <article
                      key={page.id}
                      className="overflow-hidden rounded-xl border border-border bg-background"
                    >
                      <img
                        src={page.url}
                        alt={`Page ${index + 1}`}
                        className="aspect-[3/4] w-full bg-soft object-contain transition"
                        style={{ transform: `rotate(${page.rotation}deg)` }}
                      />
                      <div className="flex items-center gap-1 p-2">
                        <strong className="min-w-0 flex-1 truncate text-xs">
                          Page {index + 1}
                        </strong>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => rotate(page.id)}
                          aria-label={`Rotate page ${index + 1}`}
                          className="rounded p-1.5 hover:bg-soft"
                        >
                          <RotateCw className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busy || index === 0}
                          onClick={() => move(index, -1)}
                          aria-label={`Move page ${index + 1} up`}
                          className="rounded p-1 hover:bg-soft disabled:opacity-35"
                        >
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busy || index === pages.length - 1}
                          onClick={() => move(index, 1)}
                          aria-label={`Move page ${index + 1} down`}
                          className="rounded p-1 hover:bg-soft disabled:opacity-35"
                        >
                          <ArrowDown className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => remove(page.id)}
                          aria-label={`Remove page ${index + 1}`}
                          className="rounded p-1 text-muted-foreground hover:bg-soft hover:text-destructive"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  <label className="text-sm font-semibold">
                    Page tone
                    <select
                      className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2.5"
                      value={enhancement}
                      onChange={(event) =>
                        setEnhancement(event.target.value as ImagePdfEnhancement)
                      }
                      disabled={busy}
                    >
                      <option value="natural">Keep original colors</option>
                      <option value="grayscale">Grayscale</option>
                      <option value="high-contrast">Black and white · high contrast</option>
                    </select>
                  </label>
                  <label className="text-sm font-semibold">
                    Paper size
                    <select
                      className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2.5"
                      value={paperSize}
                      onChange={(event) => setPaperSize(event.target.value as ImagePdfPaperSize)}
                      disabled={busy}
                    >
                      <option value="a4">A4</option>
                      <option value="letter">Letter</option>
                      <option value="fit">Fit to image</option>
                    </select>
                  </label>
                  <label className="text-sm font-semibold">
                    Margin
                    <select
                      className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2.5"
                      value={margin}
                      onChange={(event) => setMargin(Number(event.target.value) as ImagePdfMargin)}
                      disabled={busy}
                    >
                      <option value={0}>None</option>
                      <option value={24}>Standard</option>
                      <option value={48}>Wide</option>
                    </select>
                  </label>
                </div>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  Tone and rotation are applied in a background worker. This tool does not detect
                  page edges, correct perspective, or remove shadows automatically.
                </p>
                <div className="mt-5 flex justify-center">
                  {busy ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        stopWorker();
                        setBusy(false);
                        setStatus("");
                        setError(imageError("cancelled"));
                      }}
                    >
                      <X className="size-4" /> Cancel
                    </Button>
                  ) : (
                    <Button onClick={createPdf}>
                      <FileImage className="size-4" /> Create cleaned PDF
                    </Button>
                  )}
                </div>
              </>
            )}
            {busy && (
              <p
                role="status"
                aria-live="polite"
                className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground"
              >
                <LoaderCircle className="size-4 animate-spin" />
                {status}
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
            {!busy && status && (
              <p role="status" className="mt-4 text-center text-sm text-muted-foreground">
                {status}
              </p>
            )}
            {output && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-accent/40 p-4">
                <span>
                  <strong className="block text-sm">Cleaned PDF is ready</strong>
                  <small className="text-muted-foreground">{formatScanBytes(output.size)}</small>
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
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
