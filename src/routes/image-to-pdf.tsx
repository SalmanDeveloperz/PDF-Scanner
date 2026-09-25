import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Download,
  FileImage,
  ImagePlus,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  IMAGE_TO_PDF_LIMITS,
  type ImagePdfMargin,
  type ImagePdfPaperSize,
} from "@/lib/image-to-pdf";

type ImageFile = { id: string; file: File; previewUrl: string };
type WorkerResponse =
  | { type: "progress"; completed: number; total: number; fileName: string }
  | { type: "saving" }
  | {
      type: "success";
      bytes: ArrayBuffer;
    }
  | {
      type: "error";
      code: string;
      fileName?: string;
    };

export const Route = createFileRoute("/image-to-pdf")({ component: ImageToPdfPage });

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function isImageFile(file: File) {
  if (file.type.startsWith("image/")) return true;
  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(file.name);
}

function errorMessage(code: string, fileName?: string) {
  const file = fileName ? `“${fileName}”` : "One of these images";
  switch (code) {
    case "unsupported-format":
      return `${file} uses an image format this browser can’t decode. Try converting it to JPEG or PNG.`;
    case "processor-unavailable":
      return "This browser doesn’t support the background image-conversion features required by this tool. Try a current version of Chrome, Edge, Firefox, or Safari.";
    case "image-too-large":
      return `${file} is too large to process safely. Each image must be at most 40 megapixels and 16,000 pixels on either side.`;
    case "too-many-pixels":
      return `${file} takes the selection over the 120 megapixel total limit. Remove images or choose lower-resolution copies.`;
    case "too-large-output":
      return "The resulting PDF would be larger than 200 MiB. Reduce the number or resolution of the images and try again.";
    case "memory":
      return "Your device ran out of available memory while processing these images. Try fewer or smaller images, or use a device with more memory.";
    case "invalid-image":
      return `${file} is empty, damaged, or couldn’t be decoded. Check the file and try again.`;
    default:
      return "The image processor stopped unexpectedly. Try removing the last image or choosing a different file.";
  }
}

function ImageToPdfPage() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [paperSize, setPaperSize] = useState<ImagePdfPaperSize>("a4");
  const [margin, setMargin] = useState<ImagePdfMargin>(24);
  const [isCreating, setIsCreating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const previewUrlsRef = useRef(new Set<string>());

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  const addFiles = (incoming: FileList | File[]) => {
    if (isCreating) return;
    const selected = Array.from(incoming);
    const valid = selected.filter((file) => file.size > 0 && isImageFile(file));
    const invalidCount = selected.length - valid.length;
    if (valid.length === 0) {
      setError(
        "Choose one or more non-empty image files. The selected files were not recognized as images.",
      );
      setStatus("");
      return;
    }
    if (images.length + valid.length > IMAGE_TO_PDF_LIMITS.files) {
      setError(
        `This selection would exceed the ${IMAGE_TO_PDF_LIMITS.files}-image limit. Remove images or choose fewer files.`,
      );
      setStatus("");
      return;
    }

    const existingBytes = images.reduce((sum, image) => sum + image.file.size, 0);
    const selectedBytes = valid.reduce((sum, file) => sum + file.size, 0);
    const oversized = valid.filter((file) => file.size > IMAGE_TO_PDF_LIMITS.totalInputBytes);
    if (oversized.length > 0) {
      const names = oversized
        .slice(0, 3)
        .map((file) => `“${file.name}” (${formatBytes(file.size)})`)
        .join(", ");
      setError(
        `${names}${oversized.length > 3 ? ", and others" : ""} exceed the ${formatBytes(IMAGE_TO_PDF_LIMITS.totalInputBytes)} input limit. Choose smaller images.`,
      );
      setStatus("");
      return;
    }
    if (existingBytes + selectedBytes > IMAGE_TO_PDF_LIMITS.totalInputBytes) {
      setError(
        `These files add ${formatBytes(selectedBytes)} to the ${formatBytes(existingBytes)} already selected, exceeding the ${formatBytes(IMAGE_TO_PDF_LIMITS.totalInputBytes)} total input limit. Remove images or choose smaller files.`,
      );
      setStatus("");
      return;
    }

    const added = valid.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      return { id: crypto.randomUUID(), file, previewUrl };
    });
    setImages((current) => [...current, ...added]);
    setError(
      invalidCount > 0
        ? `${invalidCount} file${invalidCount === 1 ? " was" : "s were"} skipped. Choose non-empty image files.`
        : "",
    );
    setStatus("");
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    if (isCreating) return;
    setImages((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const reordered = [...current];
      const currentImage = reordered[index];
      const targetImage = reordered[target];
      if (!currentImage || !targetImage) return current;
      reordered[index] = targetImage;
      reordered[target] = currentImage;
      return reordered;
    });
  };

  const removeImage = (id: string) => {
    const removed = images.find((image) => image.id === id);
    if (removed) {
      URL.revokeObjectURL(removed.previewUrl);
      previewUrlsRef.current.delete(removed.previewUrl);
    }
    setImages((current) => current.filter((image) => image.id !== id));
    setError("");
    setStatus("");
  };

  const clearImages = () => {
    images.forEach((image) => {
      URL.revokeObjectURL(image.previewUrl);
      previewUrlsRef.current.delete(image.previewUrl);
    });
    setImages([]);
    setError("");
    setStatus("");
  };

  const createPdf = () => {
    if (images.length === 0) {
      setError("Add at least one image to create a PDF.");
      return;
    }
    setError("");
    setStatus("Starting image conversion…");
    setIsCreating(true);

    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/images-to-pdf.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      setIsCreating(false);
      setStatus("");
      setError(
        "This browser couldn’t start the image processor. Try a current version of Chrome, Edge, Firefox, or Safari.",
      );
      return;
    }
    workerRef.current = worker;

    const finish = () => {
      worker.terminate();
      workerRef.current = null;
      setIsCreating(false);
    };

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        setStatus(
          `Preparing image ${message.completed + 1} of ${message.total}: ${message.fileName}`,
        );
        return;
      }
      if (message.type === "saving") {
        setStatus("Writing PDF…");
        return;
      }
      finish();
      if (message.type === "error") {
        setStatus("");
        setError(errorMessage(message.code, message.fileName));
        return;
      }
      try {
        const url = URL.createObjectURL(new Blob([message.bytes], { type: "application/pdf" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "images.pdf";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setError("");
        setStatus(
          `Created images.pdf with ${images.length} page${images.length === 1 ? "" : "s"}.`,
        );
      } catch {
        setStatus("");
        setError("The browser couldn’t prepare the PDF for download. Try fewer or smaller images.");
      }
    };

    worker.onerror = (event) => {
      event.preventDefault();
      finish();
      setStatus("");
      setError(errorMessage(event.message.toLowerCase().includes("memory") ? "memory" : "failed"));
    };
    worker.onmessageerror = () => {
      finish();
      setStatus("");
      setError(
        "The browser couldn’t transfer the selected images to the processor. Please try again.",
      );
    };

    try {
      worker.postMessage({
        files: images.map((image) => image.file),
        paperSize,
        margin,
      });
    } catch {
      finish();
      setStatus("");
      setError("The browser couldn’t start processing these images. Try fewer or smaller files.");
    }
  };

  const cancel = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setIsCreating(false);
    setStatus("");
    setError("PDF creation cancelled.");
  };

  const totalBytes = images.reduce((sum, image) => sum + image.file.size, 0);

  return (
    <>
      <SiteHeader />
      <main className="min-h-[calc(100vh-18rem)] bg-soft px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-4xl">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Back to PDF Scanner
          </a>
          <header className="mt-10 text-center sm:mt-14">
            <span className="mx-auto grid size-14 place-items-center rounded-xl bg-accent text-primary">
              <FileImage className="size-7" />
            </span>
            <p className="eyebrow mt-5">PDF Tools</p>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Image to PDF</h1>
            <p className="mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">
              Turn photos into a clean, multi-page PDF. Arrange your images, choose a page size, and
              download the result.
            </p>
          </header>

          <section
            className="mt-9 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-7"
            aria-label="Convert images to PDF"
          >
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/*,.heic,.heif,.tif,.tiff,.svg"
              multiple
              disabled={isCreating}
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={isCreating}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(event.dataTransfer.files);
              }}
              className={`flex w-full flex-col items-center rounded-lg border-2 border-dashed px-5 py-10 text-center transition disabled:cursor-not-allowed disabled:opacity-60 ${dragging ? "border-primary bg-accent/50" : "border-border hover:border-primary/60 hover:bg-soft/70"}`}
            >
              <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
                <ImagePlus className="size-6" />
              </span>
              <strong className="mt-4 text-base">Choose images or drop them here</strong>
              <span className="mt-1 text-sm text-muted-foreground">
                JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC, TIFF, SVG, and other browser-supported image
                types
              </span>
            </button>

            {images.length > 0 && (
              <div className="mt-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-extrabold">
                    Your images{" "}
                    <span className="font-medium text-muted-foreground">
                      ({images.length} · {formatBytes(totalBytes)})
                    </span>
                  </h2>
                  <button
                    type="button"
                    disabled={isCreating}
                    onClick={clearImages}
                    className="text-sm font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    Clear all
                  </button>
                </div>
                <ol className="grid gap-3 sm:grid-cols-2">
                  {images.map(({ id, file, previewUrl }, index) => (
                    <li
                      key={id}
                      className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-background p-3"
                    >
                      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-soft">
                        <img
                          src={previewUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-full object-contain"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm">{file.name}</strong>
                        <small className="text-muted-foreground">
                          {formatBytes(file.size)} · Page {index + 1}
                        </small>
                      </span>
                      <button
                        type="button"
                        title="Move up"
                        aria-label={`Move ${file.name} up`}
                        disabled={isCreating || index === 0}
                        onClick={() => moveImage(index, -1)}
                        className="rounded p-2 text-muted-foreground hover:bg-soft hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        aria-label={`Move ${file.name} down`}
                        disabled={isCreating || index === images.length - 1}
                        onClick={() => moveImage(index, 1)}
                        className="rounded p-2 text-muted-foreground hover:bg-soft hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowDown className="size-4" />
                      </button>
                      <button
                        type="button"
                        title="Remove image"
                        aria-label={`Remove ${file.name}`}
                        disabled={isCreating}
                        onClick={() => removeImage(id)}
                        className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold">
                Page size
                <select
                  value={paperSize}
                  disabled={isCreating}
                  onChange={(event) => setPaperSize(event.target.value as ImagePdfPaperSize)}
                  className="h-11 rounded-md border border-input bg-background px-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="a4">A4 · auto orientation</option>
                  <option value="letter">US Letter · auto orientation</option>
                  <option value="fit">Fit to image · 150 DPI</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-bold">
                Page margin
                <select
                  value={margin}
                  disabled={isCreating || paperSize === "fit"}
                  onChange={(event) => setMargin(Number(event.target.value) as ImagePdfMargin)}
                  className="h-11 rounded-md border border-input bg-background px-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <option value={0}>None</option>
                  <option value={24}>Small · ⅓ inch</option>
                  <option value={48}>Large · ⅔ inch</option>
                </select>
              </label>
            </div>

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
              >
                {error}
              </p>
            )}
            {status && (
              <p
                role="status"
                className="mt-4 text-center text-sm font-medium text-muted-foreground"
              >
                {status}
              </p>
            )}
            <div className="mt-6 flex gap-3">
              <Button
                type="button"
                onClick={createPdf}
                disabled={isCreating || images.length === 0}
                className="h-12 flex-1 text-base font-bold"
              >
                {isCreating ? (
                  <>
                    <LoaderCircle className="animate-spin" /> Creating PDF…
                  </>
                ) : (
                  <>
                    <Download /> Create and download PDF
                  </>
                )}
              </Button>
              {isCreating && (
                <Button type="button" variant="outline" onClick={cancel} className="h-12">
                  Cancel
                </Button>
              )}
            </div>
            <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
              Your images are processed locally in this browser and aren’t uploaded to a server.
            </p>
          </section>

          <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
            Limits: {IMAGE_TO_PDF_LIMITS.files} images,{" "}
            {formatBytes(IMAGE_TO_PDF_LIMITS.totalInputBytes)} total input and output,{" "}
            {IMAGE_TO_PDF_LIMITS.imagePixels / 1_000_000} megapixels per image,{" "}
            {IMAGE_TO_PDF_LIMITS.totalPixels / 1_000_000} megapixels overall, and{" "}
            {IMAGE_TO_PDF_LIMITS.imageDimension.toLocaleString()} pixels per side. Images must be
            decodable by your browser; animated images use their first frame.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
