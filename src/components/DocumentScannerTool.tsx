import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  CameraOff,
  Download,
  FileImage,
  LoaderCircle,
  Plus,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  IMAGE_TO_PDF_LIMITS,
  type ImagePdfMargin,
  type ImagePdfPaperSize,
} from "@/lib/image-to-pdf";

type ScanPage = { id: string; file: File; previewUrl: string };
type WorkerResponse =
  | { type: "progress"; completed: number; total: number; fileName: string }
  | { type: "saving" }
  | { type: "success"; bytes: ArrayBuffer }
  | { type: "error"; code: string; fileName?: string };
type Result = { name: string; href: string; size: number };

function formatScanBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function scannerError(code: string, fileName?: string) {
  switch (code) {
    case "camera-unsupported":
      return "Camera capture isn’t available in this browser. Import image files instead.";
    case "camera-denied":
      return "Camera access was denied. Allow camera access in your browser settings, or import image files.";
    case "camera-missing":
      return "No camera was found on this device. Import image files to continue.";
    case "invalid-file-count":
      return `Choose up to ${IMAGE_TO_PDF_LIMITS.files} pages at a time.`;
    case "total-too-large":
      return `The images exceed the ${formatScanBytes(IMAGE_TO_PDF_LIMITS.totalInputBytes)} combined input limit.`;
    case "unsupported-format":
      return `${fileName ? `“${fileName}”` : "This image"} uses a format this browser cannot decode. Try JPEG or PNG.`;
    case "image-too-large":
      return `${fileName ? `“${fileName}”` : "An image"} exceeds the per-image pixel or dimension limit.`;
    case "too-many-pixels":
      return `The images exceed the ${IMAGE_TO_PDF_LIMITS.totalPixels / 1_000_000} megapixel total limit.`;
    case "too-large-output":
      return `The generated PDF exceeds ${formatScanBytes(IMAGE_TO_PDF_LIMITS.outputBytes)}.`;
    case "memory":
      return "Your device ran out of memory. Try fewer or smaller scans.";
    case "processor-unavailable":
      return "This browser cannot process images in the background. Try a recent Chrome, Edge, Firefox, or Safari.";
    case "invalid-image":
      return `${fileName ? `“${fileName}”` : "An image"} is empty, damaged, or could not be decoded.`;
    case "cancelled":
      return "PDF creation was cancelled. Your photos were not changed.";
    default:
      return "We couldn’t create the scan PDF. Try smaller images or another browser.";
  }
}

export function DocumentScannerTool() {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [paperSize, setPaperSize] = useState<ImagePdfPaperSize>("a4");
  const [margin, setMargin] = useState<ImagePdfMargin>(24);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const pagesRef = useRef<ScanPage[]>([]);
  const resultRef = useRef<Result | null>(null);
  const pageId = useRef(0);
  const mountedRef = useRef(true);

  const releaseCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  };
  const clearResult = () => {
    if (resultRef.current) URL.revokeObjectURL(resultRef.current.href);
    resultRef.current = null;
    setResult(null);
  };
  const stopWorker = () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      stopWorker();
      pagesRef.current.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
      if (resultRef.current) URL.revokeObjectURL(resultRef.current.href);
    };
  }, []);

  const addImages = (incoming: FileList | File[]) => {
    if (busy) return;
    const candidates = Array.from(incoming);
    const accepted = candidates.filter(
      (file) =>
        file.type.startsWith("image/") ||
        /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(file.name),
    );
    if (!accepted.length) {
      setError("Choose one or more image files to scan.");
      return;
    }
    if (pages.length + accepted.length > IMAGE_TO_PDF_LIMITS.files) {
      setError(scannerError("invalid-file-count"));
      return;
    }
    const combined =
      pages.reduce((sum, page) => sum + page.file.size, 0) +
      accepted.reduce((sum, file) => sum + file.size, 0);
    if (combined > IMAGE_TO_PDF_LIMITS.totalInputBytes) {
      setError(scannerError("total-too-large"));
      return;
    }
    const empty = accepted.find((file) => file.size === 0);
    if (empty) {
      setError(scannerError("invalid-image", empty.name));
      return;
    }
    clearResult();
    setError("");
    setStatus("");
    const additions = accepted.map((file) => ({
      id: `scan-${++pageId.current}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPages((previous) => {
      const next = [...previous, ...additions];
      pagesRef.current = next;
      return next;
    });
  };

  const startCamera = async (nextFacingMode = facingMode) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(scannerError("camera-unsupported"));
      return;
    }
    releaseCamera();
    setCameraBusy(true);
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: nextFacingMode },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setFacingMode(nextFacingMode);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (cause) {
      if (!mountedRef.current) return;
      releaseCamera();
      const name = cause instanceof DOMException ? cause.name : "";
      setError(
        scannerError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "camera-denied"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "camera-missing"
              : "camera-unsupported",
        ),
      );
    } finally {
      if (mountedRef.current) setCameraBusy(false);
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth < 1 || video.videoHeight < 1 || busy) return;
    const canvas = window.document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      setError("The camera image could not be captured. Try importing a photo instead.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (image) => (image ? resolve(image) : reject(new Error("capture-failed"))),
          "image/jpeg",
          0.94,
        ),
      );
      if (blob.size > IMAGE_TO_PDF_LIMITS.totalInputBytes) throw new Error("total-too-large");
      const captureFile = new File([blob], `scan-${pages.length + 1}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
      addImages([captureFile]);
    } catch (cause) {
      setError(scannerError(cause instanceof Error ? cause.message : "capture-failed"));
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  };

  const removePage = (id: string) => {
    const removed = pagesRef.current.find((page) => page.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    const next = pagesRef.current.filter((page) => page.id !== id);
    pagesRef.current = next;
    setPages(next);
    clearResult();
  };

  const movePage = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= pagesRef.current.length) return;
    const next = [...pagesRef.current];
    [next[index], next[target]] = [next[target]!, next[index]!];
    pagesRef.current = next;
    setPages(next);
    clearResult();
  };

  const createPdf = () => {
    if (busy || !pages.length) return;
    clearResult();
    setError("");
    setBusy(true);
    setStatus("Preparing scanned pages…");
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
        setError("PDF creation exceeded the 10-minute safety limit. Try fewer or smaller images.");
      },
      10 * 60 * 1000,
    );
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (workerRef.current !== worker) return;
      const response = event.data;
      if (response.type === "progress")
        setStatus(`Preparing page ${response.completed} of ${response.total}…`);
      else if (response.type === "saving") setStatus("Saving the multi-page PDF…");
      else if (response.type === "error") {
        setError(scannerError(response.code, response.fileName));
        setStatus("");
        finish();
      } else {
        const blob = new Blob([response.bytes], { type: "application/pdf" });
        const ready = {
          name: "scanned-document.pdf",
          href: URL.createObjectURL(blob),
          size: blob.size,
        };
        resultRef.current = ready;
        setResult(ready);
        setStatus(`${pages.length} scanned page${pages.length === 1 ? "" : "s"} saved to PDF.`);
        finish();
      }
    };
    worker.onerror = () => {
      if (workerRef.current !== worker) return;
      setError(scannerError("failed"));
      setStatus("");
      finish();
    };
    worker.postMessage({ files: pages.map(({ file }) => file), paperSize, margin });
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
              <Camera className="size-7" />
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Scan documents
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Capture pages with your camera or add photos. Arrange them, then create one multi-page
              PDF.
            </p>
          </header>
          <section
            className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
            aria-label="Document scanner"
          >
            <input
              ref={inputRef}
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                if (event.target.files) addImages(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="overflow-hidden rounded-xl bg-slate-950">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className={`aspect-[4/3] w-full object-contain ${cameraReady ? "" : "hidden"}`}
                />
                {!cameraReady && (
                  <div className="grid aspect-[4/3] place-items-center px-6 text-center text-white">
                    <div>
                      <Camera className="mx-auto size-10 text-white/70" />
                      <strong className="mt-4 block text-lg">Camera scanner</strong>
                      <p className="mt-2 text-sm text-white/70">
                        Camera access starts only when you press the button.
                      </p>
                      <Button
                        type="button"
                        className="mt-5"
                        onClick={() => void startCamera()}
                        disabled={cameraBusy}
                      >
                        {cameraBusy ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <Camera className="size-4" />
                        )}{" "}
                        Start camera
                      </Button>
                    </div>
                  </div>
                )}
                {cameraReady && (
                  <div className="flex flex-wrap items-center justify-center gap-2 p-3">
                    <Button type="button" onClick={() => void capture()} disabled={busy}>
                      <Camera className="size-4" /> Capture page
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        void startCamera(facingMode === "environment" ? "user" : "environment")
                      }
                      disabled={cameraBusy}
                    >
                      <RotateCw className="size-4" /> Switch camera
                    </Button>
                    <Button type="button" variant="outline" onClick={releaseCamera}>
                      <CameraOff className="size-4" /> Stop
                    </Button>
                  </div>
                )}
              </div>
              <div
                className={`flex flex-col justify-center rounded-xl border bg-soft/50 p-5 transition ${dragging ? "border-primary" : "border-border"}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  addImages(event.dataTransfer.files);
                }}
              >
                <span className="grid size-11 place-items-center rounded-xl bg-accent text-primary">
                  <FileImage className="size-5" />
                </span>
                <h2 className="mt-4 font-bold">Add pages from photos</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Use photos already on this device when a camera isn’t available or you need to add
                  an existing scan.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                >
                  <Plus className="size-4" /> Add image files
                </Button>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  Up to {IMAGE_TO_PDF_LIMITS.files} images ·{" "}
                  {formatScanBytes(IMAGE_TO_PDF_LIMITS.totalInputBytes)} total · browser-supported
                  formats
                </p>
              </div>
            </div>
            {pages.length > 0 && (
              <div className="mt-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">
                      Scanned pages <span className="text-muted-foreground">({pages.length})</span>
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Use the arrows to change the final PDF order.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      pagesRef.current.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
                      pagesRef.current = [];
                      setPages([]);
                      clearResult();
                      setError("");
                      setStatus("");
                    }}
                    disabled={busy}
                  >
                    <Trash2 className="size-4" /> Clear all
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {pages.map((page, index) => (
                    <article
                      key={page.id}
                      className="overflow-hidden rounded-xl border border-border bg-background"
                    >
                      <img
                        src={page.previewUrl}
                        alt={`Scanned page ${index + 1}`}
                        className="aspect-[3/4] w-full bg-soft object-contain"
                      />
                      <div className="flex items-center gap-1 p-2">
                        <strong className="min-w-0 flex-1 truncate text-xs">
                          Page {index + 1}
                        </strong>
                        <button
                          type="button"
                          disabled={busy || index === 0}
                          onClick={() => movePage(index, -1)}
                          aria-label={`Move page ${index + 1} earlier`}
                          className="rounded p-1.5 hover:bg-soft disabled:opacity-35"
                        >
                          <ArrowLeft className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busy || index === pages.length - 1}
                          onClick={() => movePage(index, 1)}
                          aria-label={`Move page ${index + 1} later`}
                          className="rounded p-1.5 hover:bg-soft disabled:opacity-35"
                        >
                          <ArrowLeft className="size-3.5 rotate-180" />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => removePage(page.id)}
                          aria-label={`Remove page ${index + 1}`}
                          className="rounded p-1.5 text-muted-foreground hover:bg-soft hover:text-destructive disabled:opacity-35"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold">
                    Page size
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
                    Page margins
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
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs leading-5 text-muted-foreground">
                    Images stay in this browser. Auto edge detection and perspective correction are
                    not included yet.
                  </p>
                  <div className="flex gap-2">
                    {busy ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          stopWorker();
                          setBusy(false);
                          setStatus("");
                          setError(scannerError("cancelled"));
                        }}
                      >
                        <X className="size-4" /> Cancel
                      </Button>
                    ) : (
                      <Button onClick={createPdf} disabled={!pages.length}>
                        <FileImage className="size-4" /> Create scan PDF
                      </Button>
                    )}
                  </div>
                </div>
              </div>
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
            {result && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-accent/40 p-4">
                <span>
                  <strong className="block text-sm">Your scan PDF is ready</strong>
                  <small className="text-muted-foreground">{formatScanBytes(result.size)}</small>
                </span>
                <a
                  href={result.href}
                  download={result.name}
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
