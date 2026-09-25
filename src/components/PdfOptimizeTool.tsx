import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileText,
  LoaderCircle,
  Minimize,
  Plus,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  formatOptimizeBytes,
  PDF_OPTIMIZE_LIMITS,
  pdfOptimizeErrorMessage,
  type PdfOptimizeMode,
} from "@/lib/pdf-optimize";

const TOOL_INFO: Record<PdfOptimizeMode, { title: string; description: string; button: string }> = {
  compress: {
    title: "Compress PDF",
    description: "Shrink compatible streams and PDF structure. Optional image optimization can be lossy, so you can keep the default fully lossless mode.",
    button: "Compress PDF",
  },
  repair: {
    title: "Repair PDF",
    description: "Try qpdf’s structural recovery for damaged cross references and related PDF structure, then save a repaired copy when possible.",
    button: "Try to repair PDF",
  },
  flatten: {
    title: "Flatten PDF",
    description: "Bake interactive AcroForm field values into page content so they are no longer editable form fields.",
    button: "Flatten form fields",
  },
  archive: {
    title: "PDF/A archive preparation",
    description: "Create a clean, lossless archive candidate. This browser tool cannot certify PDF/A conformance; use a standards validator before formal archiving.",
    button: "Prepare archive copy",
  },
};

type ReadyFile = { name: string; href: string; size: number; note: string };
type FlattenResponse =
  | { type: "success"; bytes: ArrayBuffer; flattenedFields: number }
  | { type: "error"; code: string };

function outputName(fileName: string, suffix: string) {
  const base = fileName.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, "_").trim() || "document";
  return `${base}-${suffix}.pdf`;
}

function getQpdfError(cause: unknown) {
  const error = cause as { code?: string; message?: string; stderr?: string[] };
  const diagnostics = `${error?.message ?? ""} ${(error?.stderr ?? []).join(" ")}`.toLowerCase();
  if (error?.code === "QPDF_INIT_FAILED") return pdfOptimizeErrorMessage("engine-unavailable");
  if (error?.code === "QPDF_TIMEOUT") return pdfOptimizeErrorMessage("timeout");
  if (/password|encrypted/.test(diagnostics)) return pdfOptimizeErrorMessage("encrypted");
  if (/memory|allocation|heap/.test(diagnostics)) return pdfOptimizeErrorMessage("memory");
  if (/damaged|xref|startxref|trailer|invalid pdf/.test(diagnostics)) return pdfOptimizeErrorMessage("damaged-pdf");
  return pdfOptimizeErrorMessage("qpdf-failed");
}

export function PdfOptimizeTool({ mode }: { mode: PdfOptimizeMode }) {
  const info = TOOL_INFO[mode];
  const [file, setFile] = useState<File | null>(null);
  const [optimizeImages, setOptimizeImages] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReadyFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const flattenWorkerRef = useRef<Worker | null>(null);
  const flattenCancelRef = useRef<(() => void) | null>(null);
  const qpdfRunnerRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const resultRef = useRef<ReadyFile | null>(null);
  const cancelledRef = useRef(false);

  const clearResult = () => {
    if (resultRef.current) URL.revokeObjectURL(resultRef.current.href);
    resultRef.current = null;
    setResult(null);
  };

  useEffect(() => () => {
    cancelledRef.current = true;
    flattenCancelRef.current?.();
    flattenWorkerRef.current?.terminate();
    void qpdfRunnerRef.current?.destroy();
    if (resultRef.current) URL.revokeObjectURL(resultRef.current.href);
  }, []);

  const selectFile = (selected?: File) => {
    if (!selected) return;
    clearResult();
    setError("");
    setStatus("");
    if (selected.type !== "application/pdf" && !selected.name.toLowerCase().endsWith(".pdf")) {
      setFile(null);
      setError(pdfOptimizeErrorMessage("wrong-type"));
      return;
    }
    if (selected.size === 0) {
      setFile(null);
      setError(pdfOptimizeErrorMessage("empty-file"));
      return;
    }
    if (selected.size > PDF_OPTIMIZE_LIMITS.inputBytes) {
      setFile(null);
      setError(pdfOptimizeErrorMessage("input-too-large"));
      return;
    }
    setFile(selected);
  };

  const publish = (bytes: Uint8Array, suffix: string, note: string) => {
    if (!file) return;
    if (!bytes.byteLength) throw new Error("empty-output");
    if (bytes.byteLength > PDF_OPTIMIZE_LIMITS.outputBytes) throw new Error("output-too-large");
    const outputBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([outputBytes], { type: "application/pdf" });
    const next = { name: outputName(file.name, suffix), href: URL.createObjectURL(blob), size: blob.size, note };
    clearResult();
    resultRef.current = next;
    setResult(next);
  };

  const processFlatten = async (input: ArrayBuffer) => new Promise<FlattenResponse>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/pdf-flatten.worker.ts", import.meta.url), { type: "module" });
    } catch {
      reject(new Error("worker-init"));
      return;
    }
    flattenWorkerRef.current = worker;
    const timer = window.setTimeout(() => {
      if (flattenWorkerRef.current !== worker) return;
      flattenWorkerRef.current = null;
      worker.terminate();
      reject(new Error("timeout"));
    }, PDF_OPTIMIZE_LIMITS.timeoutMs);
    const finish = () => {
      window.clearTimeout(timer);
      if (flattenWorkerRef.current === worker) flattenWorkerRef.current = null;
      flattenCancelRef.current = null;
      worker.terminate();
    };
    flattenCancelRef.current = () => { finish(); reject(new Error("cancelled")); };
    worker.onmessage = (event: MessageEvent<FlattenResponse>) => { finish(); resolve(event.data); };
    worker.onerror = (event) => { event.preventDefault(); finish(); reject(new Error(/memory|allocation|heap/i.test(event.message) ? "memory" : "worker-error")); };
    worker.onmessageerror = () => { finish(); reject(new Error("worker-error")); };
    worker.postMessage({ input }, [input]);
  });

  const processPdf = async () => {
    if (!file || isProcessing) return;
    cancelledRef.current = false;
    clearResult();
    setError("");
    setIsProcessing(true);
    setStatus("Reading PDF locally…");
    let activeRunner: { destroy: () => Promise<void> } | null = null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (cancelledRef.current) return;
      const header = new TextDecoder("ascii").decode(bytes.subarray(0, Math.min(1024, bytes.length)));
      if (!header.includes("%PDF-")) throw new Error("wrong-type");

      if (mode === "flatten") {
        setStatus("Flattening interactive form fields in a background worker…");
        const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const response = await processFlatten(input);
        if (cancelledRef.current) return;
        if (response.type === "error") throw new Error(response.code);
        publish(new Uint8Array(response.bytes), "flattened", `Flattened ${response.flattenedFields} form field${response.flattenedFields === 1 ? "" : "s"}. Other annotations may remain interactive.`);
      } else {
        setStatus("Starting the PDF processing engine…");
        const { createQpdfRunner } = await import("qpdf-run");
        const rawRunner = await createQpdfRunner({
          workerUrl: new URL("qpdf-run/worker", import.meta.url),
          qpdfJsUrl: new URL("qpdf-run/qpdf.js", import.meta.url),
          wasmUrl: new URL("qpdf-run/qpdf.wasm", import.meta.url),
          timeoutMs: PDF_OPTIMIZE_LIMITS.timeoutMs,
        });
        let runnerDestroyed = false;
        const destroyRunner = rawRunner.destroy.bind(rawRunner);
        const runner = {
          run: rawRunner.run.bind(rawRunner),
          destroy: async () => {
            if (runnerDestroyed) return;
            runnerDestroyed = true;
            await destroyRunner();
          },
        };
        activeRunner = runner;
        qpdfRunnerRef.current = runner;
        if (cancelledRef.current) return;
        setStatus(mode === "compress" ? "Optimizing streams and document structure…" : mode === "repair" ? "Attempting structural recovery…" : "Preparing a lossless archival candidate…");
        const output = mode === "repair" ? "repaired.pdf" : mode === "archive" ? "archive-prepared.pdf" : "compressed.pdf";
        const args = mode === "repair"
          ? ["--warning-exit-0", "--", "source.pdf", output]
          : mode === "archive"
            ? ["--object-streams=generate", "--", "source.pdf", output]
            : ["--compress-streams=y", "--recompress-flate", "--compression-level=9", "--object-streams=generate", ...(optimizeImages ? ["--optimize-images", "--jpeg-quality=85"] : []), "--", "source.pdf", output];
        const response = await runner.run({ inputs: { "source.pdf": bytes }, args, outputs: [output] });
        if (cancelledRef.current) return;
        const processed = response.outputs[output];
        if (!processed?.byteLength) throw new Error("empty-output");
        let finalBytes = processed;
        let note = response.warnings.length ? `Recovered/re-written with ${response.warnings.length} qpdf warning${response.warnings.length === 1 ? "" : "s"}. Review the output carefully.` : mode === "repair" ? "qpdf rewrote the document. Inspect recovered pages because repair cannot guarantee missing content." : mode === "archive" ? "Archive candidate prepared, but PDF/A conformance has not been certified. Validate it before formal archival." : "";
        if (mode === "compress" && processed.byteLength >= bytes.byteLength) {
          finalBytes = bytes;
          note = "This PDF is already optimized for these settings, so its original bytes are retained to avoid an unnecessary larger rewrite.";
        }
        publish(finalBytes, mode, note);
      }
      setStatus("PDF is ready to save.");
    } catch (cause) {
      if (!cancelledRef.current) {
        const code = cause instanceof Error ? cause.message : "processing-failed";
        setError(code === "wrong-type" || code === "input-too-large" || code === "empty-file" || code === "output-too-large" || code === "memory" || code === "timeout" || code === "encrypted" || code === "damaged-pdf" || code === "no-form-fields" || code === "too-many-pages" || code === "empty-document" ? pdfOptimizeErrorMessage(code) : mode === "flatten" ? pdfOptimizeErrorMessage("processing-failed") : getQpdfError(cause));
        setStatus("");
      }
    } finally {
      await activeRunner?.destroy().catch(() => undefined);
      if (qpdfRunnerRef.current === activeRunner) qpdfRunnerRef.current = null;
      if (!cancelledRef.current) setIsProcessing(false);
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    flattenCancelRef.current?.();
    flattenCancelRef.current = null;
    flattenWorkerRef.current?.terminate();
    flattenWorkerRef.current = null;
    void qpdfRunnerRef.current?.destroy();
    qpdfRunnerRef.current = null;
    setIsProcessing(false);
    setStatus("");
    setError("Processing cancelled.");
  };

  return (
    <>
      <SiteHeader />
      <main className="min-h-[calc(100vh-18rem)] bg-soft px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-3xl">
          <a href="/#tools" className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-4" /> Back to PDF tools</a>
          <header className="mt-8 text-center sm:mt-10">
            <span className="mx-auto grid size-14 place-items-center rounded-xl bg-accent text-primary">{mode === "repair" ? <Wrench className="size-7" /> : mode === "archive" ? <ShieldCheck className="size-7" /> : <Minimize className="size-7" />}</span>
            <p className="eyebrow mt-4">Optimize PDF</p>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">{info.title}</h1>
            <p className="mx-auto mt-3 max-w-2xl leading-7 text-muted-foreground">{info.description}</p>
          </header>
          <section className="mt-8 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-7" aria-label={info.title}>
            <input ref={inputRef} className="sr-only" type="file" accept="application/pdf,.pdf" onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ""; }} />
            {!file ? (
              <button type="button" disabled={isProcessing} onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]); }} className={`flex w-full flex-col items-center rounded-lg border-2 border-dashed px-5 py-10 text-center transition ${dragging ? "border-primary bg-accent/50" : "border-border hover:border-primary/60 hover:bg-soft/70"}`}>
                <span className="grid size-12 place-items-center rounded-full bg-accent text-primary"><Plus className="size-6" /></span><strong className="mt-4 text-base">Choose a PDF or drop it here</strong><span className="mt-1 text-sm text-muted-foreground">Up to {formatOptimizeBytes(PDF_OPTIMIZE_LIMITS.inputBytes)}</span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3 sm:p-4"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-primary"><FileText className="size-5" /></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{file.name}</strong><small className="text-muted-foreground">{formatOptimizeBytes(file.size)}</small></span><button type="button" disabled={isProcessing} onClick={() => { setFile(null); clearResult(); setError(""); setStatus(""); }} className="rounded p-2 text-muted-foreground hover:bg-soft hover:text-destructive disabled:opacity-40" aria-label="Remove PDF"><X className="size-4" /></button></div>
            )}
            {mode === "compress" && <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-4"><input type="checkbox" checked={optimizeImages} onChange={(event) => setOptimizeImages(event.target.checked)} className="mt-1 accent-primary" /><span><strong className="block text-sm">Optimize images (may be lossy)</strong><small className="mt-1 block leading-5 text-muted-foreground">Re-encodes supported images at high quality. qpdf keeps an image only when the optimized version is smaller.</small></span></label>}
            {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
            {status && <p role="status" aria-live="polite" className="mt-4 rounded-md bg-accent/50 px-4 py-3 text-sm font-medium">{status}</p>}
            <div className="mt-5 flex gap-3"><Button type="button" onClick={() => void processPdf()} disabled={!file || isProcessing} className="h-12 flex-1 text-base font-bold">{isProcessing ? <><LoaderCircle className="animate-spin" /> Processing…</> : <><Download /> {info.button}</>}</Button>{isProcessing && <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>}</div>
            {result && <div className="mt-5 rounded-lg border border-primary/20 bg-accent/40 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><span><strong className="block text-sm">{result.name} is ready</strong><small className="text-muted-foreground">{formatOptimizeBytes(result.size)}{mode === "compress" && file ? ` · ${result.size <= file.size ? `${Math.round((1 - result.size / file.size) * 100)}% smaller` : "same size"}` : ""}</small></span><a href={result.href} download={result.name} className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"><Download className="size-4" /> Save PDF</a></div>{result.note && <p className="mt-3 text-sm leading-6 text-muted-foreground">{result.note}</p>}</div>}
            <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">Your PDF is processed in your browser. Input and output are limited to {formatOptimizeBytes(PDF_OPTIMIZE_LIMITS.inputBytes)}.</p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
