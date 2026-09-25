import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Eraser, FileText, LoaderCircle, PenLine, Stamp, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PDF_EDIT_LIMITS, type PdfEditMode, type PdfEditResponse } from "@/lib/pdf-editing";

type Position = "left" | "center" | "right";
type WorkerRef = { worker: Worker; timer: number };

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function errorMessage(code: string) {
  switch (code) {
    case "password-protected":
      return "This PDF is password-protected. Unlock it with an authorized password first, then try again.";
    case "too-many-pages":
      return `This document has more than ${PDF_EDIT_LIMITS.pages.toLocaleString()} pages, which is above this tool’s safe processing limit.`;
    case "invalid-page-range":
      return "The selected page range doesn’t exist in this PDF. Check the page numbers and try again.";
    case "empty-document":
      return "This PDF has no pages to edit.";
    case "output-too-large":
      return `The edited PDF would exceed ${formatBytes(PDF_EDIT_LIMITS.outputBytes)}. Try a smaller PDF.`;
    case "memory":
      return "Your device ran out of memory while editing this PDF. Try a smaller file or close other tabs and apps.";
    case "damaged-pdf":
      return "This PDF appears to be damaged or invalid. Check the file and try again.";
    case "timeout":
      return "Editing took too long and was stopped. Try a smaller PDF or a device with more available memory.";
    case "worker-error":
      return "The PDF editing worker stopped unexpectedly. Try again with a valid PDF.";
    default:
      return "We couldn’t edit this PDF. It may be damaged or contain features this browser tool can’t preserve.";
  }
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function safeBaseName(name: string) {
  return (
    name
      .replace(/\.pdf$/i, "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim() || "document"
  );
}

function getTrimmedSignature(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("canvas-unavailable"));
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height).data;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3]! > 12) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left || bottom < top) return Promise.reject(new Error("signature-empty"));
  const padding = 12;
  const cropLeft = Math.max(0, left - padding);
  const cropTop = Math.max(0, top - padding);
  const cropWidth = Math.min(width - cropLeft, right - left + padding * 2);
  const cropHeight = Math.min(height - cropTop, bottom - top + padding * 2);
  const cropped = document.createElement("canvas");
  cropped.width = cropWidth;
  cropped.height = cropHeight;
  const croppedContext = cropped.getContext("2d");
  if (!croppedContext) return Promise.reject(new Error("canvas-unavailable"));
  croppedContext.drawImage(
    canvas,
    cropLeft,
    cropTop,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  );
  return new Promise((resolve, reject) => {
    cropped.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("canvas-export-failed"));
        return;
      }
      try {
        resolve(await blob.arrayBuffer());
      } catch {
        reject(new Error("canvas-export-failed"));
      }
    }, "image/png");
  });
}

function makeWatermarkImage(text: string, color: string, opacity: number): Promise<ArrayBuffer> {
  const canvas = document.createElement("canvas");
  canvas.width = 1800;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("canvas-unavailable"));
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.globalAlpha = opacity;
  context.textAlign = "center";
  context.textBaseline = "middle";
  let fontSize = 180;
  context.font = `700 ${fontSize}px system-ui, sans-serif`;
  while (context.measureText(text).width > canvas.width * 0.9 && fontSize > 32) {
    fontSize -= 4;
    context.font = `700 ${fontSize}px system-ui, sans-serif`;
  }
  context.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width * 0.9);
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("canvas-export-failed"));
        return;
      }
      try {
        resolve(await blob.arrayBuffer());
      } catch {
        reject(new Error("canvas-export-failed"));
      }
    }, "image/png");
  });
}

export function PdfMarkTool({ mode }: { mode: PdfEditMode }) {
  const isSign = mode === "sign";
  const [file, setFile] = useState<File | null>(null);
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
  const [watermarkColor, setWatermarkColor] = useState("#1f2937");
  const [opacity, setOpacity] = useState(25);
  const [rotation, setRotation] = useState(-35);
  const [position, setPosition] = useState<Position>("right");
  const [allPages, setAllPages] = useState(true);
  const [startPage, setStartPage] = useState("1");
  const [endPage, setEndPage] = useState("1");
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<WorkerRef | null>(null);
  const operationRef = useRef(0);
  const drawingRef = useRef(false);
  const touchedRef = useRef(false);

  useEffect(
    () => () => {
      if (workerRef.current) {
        window.clearTimeout(workerRef.current.timer);
        workerRef.current.worker.terminate();
      }
    },
    [],
  );

  const selectFile = (selected?: File) => {
    if (!selected) return;
    if (!isPdf(selected)) {
      setError("Choose a PDF file. This tool doesn’t accept other file types.");
      setStatus("");
      return;
    }
    if (selected.size === 0) {
      setError("This PDF is empty. Choose a non-empty PDF file.");
      setStatus("");
      return;
    }
    if (selected.size > PDF_EDIT_LIMITS.inputBytes) {
      setError(
        `This PDF is ${formatBytes(selected.size)}. The input limit is ${formatBytes(PDF_EDIT_LIMITS.inputBytes)}; choose a smaller file.`,
      );
      setStatus("");
      return;
    }
    setFile(selected);
    setError("");
    setStatus("");
  };

  const pointerPosition = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  };

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (isProcessing) return;
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const { x, y } = pointerPosition(event);
    drawingRef.current = true;
    touchedRef.current = true;
    context.beginPath();
    context.moveTo(x, y);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#172554";
    context.lineWidth = 7;
    context.lineTo(x + 0.1, y + 0.1);
    context.stroke();
    setError("");
  };

  const continueStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const { x, y } = pointerPosition(event);
    context.lineTo(x, y);
    context.stroke();
  };

  const endStroke = () => {
    drawingRef.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    touchedRef.current = false;
    setError("");
  };

  const processPdf = async () => {
    if (!file) {
      setError("Choose a PDF file to continue.");
      return;
    }
    if (isSign && !touchedRef.current) {
      setError("Draw your signature in the box before applying it.");
      return;
    }
    if (!isSign && !watermarkText.trim()) {
      setError("Enter the text you want to use as a watermark.");
      return;
    }
    const first = allPages ? 1 : Number(startPage);
    const last = allPages ? 0 : Number(endPage);
    if (
      !allPages &&
      (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first)
    ) {
      setError("Enter a valid page range, such as page 1 through 3.");
      return;
    }

    const operation = ++operationRef.current;
    setError("");
    setStatus("Preparing your PDF…");
    setIsProcessing(true);
    let image: ArrayBuffer;
    try {
      image = isSign
        ? await getTrimmedSignature(canvasRef.current!)
        : await makeWatermarkImage(watermarkText.trim(), watermarkColor, opacity / 100);
      if (operation !== operationRef.current) return;
    } catch (cause) {
      if (operation !== operationRef.current) return;
      setIsProcessing(false);
      setStatus("");
      setError(
        cause instanceof Error && cause.message === "signature-empty"
          ? "Draw your signature in the box before applying it."
          : "The browser couldn’t prepare the mark image. Please try again.",
      );
      return;
    }

    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/pdf-edit.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      if (operation !== operationRef.current) return;
      setIsProcessing(false);
      setStatus("");
      setError(
        "This browser couldn’t start the PDF editor. Try a current version of Chrome, Edge, Firefox, or Safari.",
      );
      return;
    }

    const timer = window.setTimeout(() => {
      operationRef.current++;
      worker.terminate();
      workerRef.current = null;
      setIsProcessing(false);
      setStatus("");
      setError(errorMessage("timeout"));
    }, PDF_EDIT_LIMITS.timeoutMs);
    workerRef.current = { worker, timer };

    const finish = () => {
      window.clearTimeout(timer);
      worker.terminate();
      workerRef.current = null;
      setIsProcessing(false);
    };
    worker.onmessage = (event: MessageEvent<PdfEditResponse>) => {
      if (operation !== operationRef.current) return;
      finish();
      const response = event.data;
      if (response.type === "error") {
        setStatus("");
        setError(errorMessage(response.code));
        return;
      }
      try {
        const outputName = `${safeBaseName(file.name)}-${isSign ? "signed" : "watermarked"}.pdf`;
        const url = URL.createObjectURL(new Blob([response.bytes], { type: "application/pdf" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = outputName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setError("");
        setStatus(
          `Created ${outputName} with the mark on ${response.pageCount} page${response.pageCount === 1 ? "" : "s"}.`,
        );
      } catch {
        setStatus("");
        setError(
          "The browser couldn’t prepare the edited PDF for download. Try a smaller document.",
        );
      }
    };
    worker.onerror = (event) => {
      if (operation !== operationRef.current) return;
      event.preventDefault();
      finish();
      setStatus("");
      setError(
        errorMessage(event.message.toLowerCase().includes("memory") ? "memory" : "worker-error"),
      );
    };
    worker.onmessageerror = () => {
      if (operation !== operationRef.current) return;
      finish();
      setStatus("");
      setError("The browser couldn’t transfer the PDF to the editor. Please try again.");
    };

    try {
      const input = await file.arrayBuffer();
      if (workerRef.current?.worker !== worker) return;
      const header = new TextDecoder("ascii").decode(
        new Uint8Array(input, 0, Math.min(input.byteLength, 1024)),
      );
      if (!header.includes("%PDF-")) {
        finish();
        setStatus("");
        setError("This file doesn’t contain a valid PDF header. Choose a valid PDF and try again.");
        return;
      }
      worker.postMessage(
        {
          mode,
          input,
          image,
          startPage: first,
          endPage: last,
          position,
          rotation,
        },
        [input, image],
      );
      setStatus(isSign ? "Applying your signature…" : "Adding your watermark…");
    } catch {
      if (workerRef.current?.worker === worker) {
        finish();
        setStatus("");
        setError("The browser couldn’t read the PDF. Check the file and try again.");
      }
    }
  };

  const cancel = () => {
    operationRef.current++;
    if (workerRef.current) {
      window.clearTimeout(workerRef.current.timer);
      workerRef.current.worker.terminate();
      workerRef.current = null;
    }
    setIsProcessing(false);
    setStatus("");
    setError("PDF editing cancelled.");
  };

  return (
    <main className="min-h-screen bg-soft px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-4xl">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to PDF Scanner
        </a>
        <header className="mt-10 text-center sm:mt-14">
          <span className="mx-auto grid size-14 place-items-center rounded-xl bg-accent text-primary">
            {isSign ? <PenLine className="size-7" /> : <Stamp className="size-7" />}
          </span>
          <p className="eyebrow mt-5">PDF Tools</p>
          <h1 className="mt-2 text-4xl font-black sm:text-5xl">
            {isSign ? "Sign PDF" : "Watermark PDF"}
          </h1>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">
            {isSign
              ? "Draw a natural-looking signature and place it on the pages you choose."
              : "Add a clear, customizable text watermark to protect or label your document."}
          </p>
        </header>

        <section
          className="mt-9 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-7"
          aria-label={isSign ? "Sign PDF" : "Watermark PDF"}
        >
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="application/pdf,.pdf"
            disabled={isProcessing}
            onChange={(event) => {
              selectFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              selectFile(event.dataTransfer.files[0]);
            }}
            className={`flex w-full flex-col items-center rounded-lg border-2 border-dashed px-5 py-9 text-center transition disabled:cursor-not-allowed disabled:opacity-60 ${dragging ? "border-primary bg-accent/50" : "border-border hover:border-primary/60 hover:bg-soft/70"}`}
          >
            <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
              <FileText className="size-6" />
            </span>
            <strong className="mt-4 text-base">
              {file ? "Choose a different PDF" : "Choose a PDF or drop it here"}
            </strong>
            <span className="mt-1 text-sm text-muted-foreground">
              One PDF · up to {formatBytes(PDF_EDIT_LIMITS.inputBytes)}
            </span>
          </button>

          {file && (
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-background p-3">
              <FileText className="size-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm">{file.name}</strong>
                <small className="text-muted-foreground">{formatBytes(file.size)}</small>
              </span>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  setFile(null);
                  setError("");
                  setStatus("");
                }}
                className="text-sm font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          )}

          {isSign ? (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold">Draw your signature</h2>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={clearSignature}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <Eraser className="size-3.5" /> Clear
                </button>
              </div>
              <canvas
                ref={canvasRef}
                width={1200}
                height={320}
                aria-label="Draw signature here"
                className="h-40 w-full touch-none rounded-lg border border-border bg-white sm:h-48"
                onPointerDown={startStroke}
                onPointerMove={continueStroke}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Use a mouse, stylus, or finger. Your signature is added as visible ink, not a
                certificate-backed digital signature.
              </p>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto]">
              <label className="grid gap-2 text-sm font-bold">
                Watermark text
                <Input
                  value={watermarkText}
                  maxLength={100}
                  disabled={isProcessing}
                  onChange={(event) => setWatermarkText(event.target.value)}
                  placeholder="e.g. CONFIDENTIAL"
                />
              </label>
              <label className="grid gap-2 text-sm font-bold">
                Color
                <span className="flex h-9 items-center gap-3 rounded-md border border-input bg-background px-3">
                  <input
                    aria-label="Watermark color"
                    type="color"
                    value={watermarkColor}
                    disabled={isProcessing}
                    onChange={(event) => setWatermarkColor(event.target.value)}
                    className="size-7 cursor-pointer border-0 bg-transparent p-0"
                  />
                  <span className="font-mono text-xs font-normal">
                    {watermarkColor.toUpperCase()}
                  </span>
                </span>
              </label>
              <label className="grid gap-2 text-sm font-bold">
                Opacity · {opacity}%
                <input
                  type="range"
                  min={5}
                  max={80}
                  step={1}
                  value={opacity}
                  disabled={isProcessing}
                  onChange={(event) => setOpacity(Number(event.target.value))}
                />
              </label>
              <label className="grid gap-2 text-sm font-bold">
                Angle · {rotation}°
                <input
                  type="range"
                  min={-60}
                  max={60}
                  step={5}
                  value={rotation}
                  disabled={isProcessing}
                  onChange={(event) => setRotation(Number(event.target.value))}
                />
              </label>
            </div>
          )}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-bold">
              {isSign ? "Signature placement" : "Watermark position"}
              <select
                value={position}
                disabled={isProcessing}
                onChange={(event) => setPosition(event.target.value as Position)}
                className="h-11 rounded-md border border-input bg-background px-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {isSign ? (
                  <>
                    <option value="left">Bottom left</option>
                    <option value="center">Bottom center</option>
                    <option value="right">Bottom right</option>
                  </>
                ) : (
                  <>
                    <option value="left">Center left</option>
                    <option value="center">Center</option>
                    <option value="right">Center right</option>
                  </>
                )}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-bold">
              Apply to
              <select
                value={allPages ? "all" : "range"}
                disabled={isProcessing}
                onChange={(event) => setAllPages(event.target.value === "all")}
                className="h-11 rounded-md border border-input bg-background px-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">All pages</option>
                <option value="range">Page range</option>
              </select>
            </label>
          </div>
          {!allPages && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold">
                From page
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={startPage}
                  disabled={isProcessing}
                  onChange={(event) => setStartPage(event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm font-bold">
                Through page
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={endPage}
                  disabled={isProcessing}
                  onChange={(event) => setEndPage(event.target.value)}
                />
              </label>
            </div>
          )}

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
              className="mt-4 break-words text-center text-sm font-medium text-muted-foreground"
            >
              {status}
            </p>
          )}
          <div className="mt-6 flex gap-3">
            <Button
              type="button"
              onClick={processPdf}
              disabled={isProcessing || !file}
              className="h-12 flex-1 text-base font-bold"
            >
              {isProcessing ? (
                <>
                  <LoaderCircle className="animate-spin" /> Processing PDF…
                </>
              ) : (
                <>
                  <Download />{" "}
                  {isSign ? "Apply signature and download" : "Add watermark and download"}
                </>
              )}
            </Button>
            {isProcessing && (
              <Button type="button" variant="outline" onClick={cancel} className="h-12">
                Cancel
              </Button>
            )}
          </div>
          <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
            Your PDF and mark are processed locally in this browser. Editing a PDF may invalidate
            existing digital signatures.
          </p>
        </section>
        <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
          Maximum input and output size: {formatBytes(PDF_EDIT_LIMITS.inputBytes)} · up to{" "}
          {PDF_EDIT_LIMITS.pages.toLocaleString()} pages. Large PDFs need extra memory on your
          device.
        </p>
      </div>
    </main>
  );
}
