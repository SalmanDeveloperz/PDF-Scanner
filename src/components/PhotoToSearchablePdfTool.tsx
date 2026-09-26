import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileSearch, LoaderCircle, Plus, X } from "lucide-react";
import { PdfOcrTool } from "@/components/PdfOcrTool";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  IMAGE_TO_PDF_LIMITS,
  type ImagePdfMargin,
  type ImagePdfPaperSize,
} from "@/lib/image-to-pdf";
import { PDF_OPTIMIZE_LIMITS } from "@/lib/pdf-optimize";
import { formatScanBytes } from "@/lib/scan-utils";

type Photo = { id: number; file: File; url: string };
type WorkerResponse =
  | { type: "progress"; completed: number; total: number; fileName: string }
  | { type: "saving" }
  | { type: "success"; bytes: ArrayBuffer }
  | { type: "error"; code: string; fileName?: string };

function imageError(code: string, fileName?: string) {
  switch (code) {
    case "too-many-pages":
      return `Photo-to-searchable-PDF supports up to ${PDF_OPTIMIZE_LIMITS.ocrPages} pages per run.`;
    case "ocr-input-too-large":
      return `The generated PDF is over the ${formatScanBytes(PDF_OPTIMIZE_LIMITS.ocrInputBytes)} OCR limit. Use smaller photos.`;
    case "invalid-file-count":
      return `Choose between 1 and ${PDF_OPTIMIZE_LIMITS.ocrPages} photos.`;
    case "unsupported-format":
      return `${fileName ? `“${fileName}”` : "An image"} uses a format this browser cannot decode.`;
    case "image-too-large":
      return `${fileName ? `“${fileName}”` : "An image"} exceeds the safe image dimension limit.`;
    case "too-many-pixels":
      return "The selected photos exceed the safe total pixel limit.";
    case "too-large-output":
      return `The photo PDF exceeds ${formatScanBytes(IMAGE_TO_PDF_LIMITS.outputBytes)}.`;
    case "memory":
      return "Your device ran out of memory. Try fewer or smaller photos.";
    case "cancelled":
      return "Photo processing was cancelled. Your originals were not changed.";
    default:
      return "We couldn’t prepare these photos. Try smaller images or another browser.";
  }
}

export function PhotoToSearchablePdfTool() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [paperSize, setPaperSize] = useState<ImagePdfPaperSize>("a4");
  const [margin, setMargin] = useState<ImagePdfMargin>(24);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [preparedPdf, setPreparedPdf] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const urlsRef = useRef(new Set<string>());
  const nextId = useRef(0);

  const releaseUrls = () => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current.clear();
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
      releaseUrls();
    },
    [],
  );

  const addPhotos = (incoming: FileList | File[]) => {
    if (busy) return;
    const files = Array.from(incoming).filter(
      (file) =>
        file.type.startsWith("image/") ||
        /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(file.name),
    );
    if (!files.length) {
      setError("Choose one or more photo files.");
      return;
    }
    if (photos.length + files.length > PDF_OPTIMIZE_LIMITS.ocrPages) {
      setError(imageError("too-many-pages"));
      return;
    }
    const total =
      photos.reduce((sum, photo) => sum + photo.file.size, 0) +
      files.reduce((sum, file) => sum + file.size, 0);
    if (total > IMAGE_TO_PDF_LIMITS.totalInputBytes) {
      setError(
        `Photos exceed the ${formatScanBytes(IMAGE_TO_PDF_LIMITS.totalInputBytes)} combined input limit.`,
      );
      return;
    }
    const empty = files.find((file) => !file.size);
    if (empty) {
      setError(`“${empty.name}” is empty.`);
      return;
    }
    setError("");
    const additions = files.map((file) => {
      const url = URL.createObjectURL(file);
      urlsRef.current.add(url);
      return { id: ++nextId.current, file, url };
    });
    setPhotos((previous) => [...previous, ...additions]);
  };

  const movePhoto = (index: number, direction: -1 | 1) => {
    const next = [...photos];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setPhotos(next);
  };

  const createSearchable = () => {
    if (busy || !photos.length) return;
    setBusy(true);
    setError("");
    setStatus("Converting photos into PDF pages…");
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
        setBusy(false);
        setStatus("");
        setError(
          "Photo conversion exceeded the 10-minute safety limit. Try fewer or smaller images.",
        );
      },
      10 * 60 * 1000,
    );
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (workerRef.current !== worker) return;
      const response = event.data;
      if (response.type === "progress")
        setStatus(`Preparing page ${response.completed} of ${response.total}…`);
      else if (response.type === "saving") setStatus("Preparing the OCR document…");
      else if (response.type === "error") {
        setError(imageError(response.code, response.fileName));
        setStatus("");
        finish();
      } else if (response.bytes.byteLength > PDF_OPTIMIZE_LIMITS.ocrInputBytes) {
        setError(imageError("ocr-input-too-large"));
        setStatus("");
        finish();
      } else {
        const safeName =
          photos[0]?.file.name
            .replace(/\.[^.]+$/, "")
            .replace(/[\\/:*?"<>|]/g, "_")
            .trim() || "photo-scan";
        const pdf = new File([response.bytes], `${safeName}.pdf`, { type: "application/pdf" });
        releaseUrls();
        setPhotos([]);
        setPreparedPdf(pdf);
        finish();
      }
    };
    worker.onerror = () => {
      if (workerRef.current !== worker) return;
      setError(imageError("processing-failed"));
      setStatus("");
      finish();
    };
    worker.postMessage({ files: photos.map(({ file }) => file), paperSize, margin });
  };

  if (preparedPdf)
    return (
      <PdfOcrTool
        initialFile={preparedPdf}
        autoProcess
        title="Photo to searchable PDF"
        description="Your photos have been combined into a PDF. English OCR is now adding searchable text page by page."
      />
    );

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
              <FileSearch className="size-7" />
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Photo to searchable PDF
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Create a clean multi-page PDF from photos, then run English OCR locally so the saved
              pages are searchable.
            </p>
          </header>
          <section
            className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
            aria-label="Photo to searchable PDF"
          >
            <input
              ref={inputRef}
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                if (event.target.files) addPhotos(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            {photos.length === 0 ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  addPhotos(event.dataTransfer.files);
                }}
                className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-border px-5 py-10 text-center hover:border-primary/60 hover:bg-soft/70"
              >
                <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
                  <Plus className="size-6" />
                </span>
                <strong className="mt-4">Choose or drop photos</strong>
                <span className="mt-1 text-sm text-muted-foreground">
                  Up to {PDF_OPTIMIZE_LIMITS.ocrPages} ·{" "}
                  {formatScanBytes(IMAGE_TO_PDF_LIMITS.totalInputBytes)} combined input
                </span>
              </button>
            ) : (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-bold">Photo pages ({photos.length})</h2>
                    <p className="text-sm text-muted-foreground">
                      Reorder pages before converting.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => inputRef.current?.click()}
                    disabled={busy}
                  >
                    <Plus className="size-4" /> Add photos
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {photos.map((photo, index) => (
                    <article
                      key={photo.id}
                      className="overflow-hidden rounded-xl border border-border"
                    >
                      <img
                        src={photo.url}
                        alt={`Photo page ${index + 1}`}
                        className="aspect-[3/4] w-full bg-soft object-contain"
                      />
                      <div className="flex items-center gap-1 p-2">
                        <strong className="min-w-0 flex-1 truncate text-xs">
                          Page {index + 1}
                        </strong>
                        <button
                          type="button"
                          disabled={busy || index === 0}
                          onClick={() => movePhoto(index, -1)}
                          aria-label={`Move page ${index + 1} up`}
                          className="rounded p-1 hover:bg-soft disabled:opacity-35"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={busy || index === photos.length - 1}
                          onClick={() => movePhoto(index, 1)}
                          aria-label={`Move page ${index + 1} down`}
                          className="rounded p-1 hover:bg-soft disabled:opacity-35"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            urlsRef.current.delete(photo.url);
                            URL.revokeObjectURL(photo.url);
                            setPhotos((previous) =>
                              previous.filter((item) => item.id !== photo.id),
                            );
                          }}
                          aria-label={`Remove page ${index + 1}`}
                          className="rounded p-1 text-muted-foreground hover:bg-soft hover:text-destructive disabled:opacity-35"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold">
                    Paper size
                    <select
                      className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2.5"
                      value={paperSize}
                      disabled={busy}
                      onChange={(event) => setPaperSize(event.target.value as ImagePdfPaperSize)}
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
                      disabled={busy}
                      onChange={(event) => setMargin(Number(event.target.value) as ImagePdfMargin)}
                    >
                      <option value={0}>None</option>
                      <option value={24}>Standard</option>
                      <option value={48}>Wide</option>
                    </select>
                  </label>
                </div>
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
            {photos.length > 0 && (
              <div className="mt-5 flex justify-center">
                {busy ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      stopWorker();
                      setBusy(false);
                      setStatus("");
                      setError(imageError("cancelled"));
                    }}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button onClick={createSearchable}>
                    <FileSearch className="size-4" /> Create searchable PDF
                  </Button>
                )}
              </div>
            )}
            <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
              English OCR · maximum {PDF_OPTIMIZE_LIMITS.ocrPages} pages · the photo PDF must fit
              within the {formatScanBytes(PDF_OPTIMIZE_LIMITS.ocrInputBytes)} OCR limit · first-use
              OCR data downloads from a public CDN, never your photos.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
