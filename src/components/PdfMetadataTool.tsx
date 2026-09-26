import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, FileMinus, FileText, LoaderCircle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  formatMetadataBytes,
  metadataErrorMessage,
  PDF_METADATA_LIMITS,
  type PdfMetadataResponse,
} from "@/lib/pdf-metadata";

type Output = { name: string; href: string; size: number; pages: number };

export function PdfMetadataTool() {
  const [file, setFile] = useState<File | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const outputRef = useRef<Output | null>(null);
  const cancelledRef = useRef(false);

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
      cancelledRef.current = true;
      stopWorker();
      if (outputRef.current) URL.revokeObjectURL(outputRef.current.href);
    },
    [],
  );

  const selectFile = (selected?: File) => {
    if (!selected || busy) return;
    clearOutput();
    setError("");
    setStatus("");
    if (
      !selected.name.toLowerCase().endsWith(".pdf") ||
      (selected.type && !["application/pdf", "application/octet-stream"].includes(selected.type))
    ) {
      setFile(null);
      setError(metadataErrorMessage("wrong-type"));
    } else if (!selected.size) {
      setFile(null);
      setError(metadataErrorMessage("empty-file"));
    } else if (selected.size > PDF_METADATA_LIMITS.inputBytes) {
      setFile(null);
      setError(metadataErrorMessage("input-too-large"));
    } else setFile(selected);
  };

  const clean = async () => {
    if (!file || busy) return;
    clearOutput();
    setError("");
    setBusy(true);
    setStatus("Removing standard document metadata…");
    cancelledRef.current = false;
    const worker = new Worker(new URL("../workers/pdf-metadata.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      stopWorker();
      setBusy(false);
    };
    timeoutRef.current = window.setTimeout(() => {
      if (workerRef.current !== worker) return;
      cancelledRef.current = true;
      worker.terminate();
      workerRef.current = null;
      timeoutRef.current = null;
      setError(metadataErrorMessage("timeout"));
      setStatus("");
      setBusy(false);
      finished = true;
    }, PDF_METADATA_LIMITS.timeoutMs);
    worker.onmessage = (event: MessageEvent<PdfMetadataResponse>) => {
      if (workerRef.current !== worker || cancelledRef.current) return;
      const response = event.data;
      if (response.type === "error") {
        setError(metadataErrorMessage(response.code));
        setStatus("");
      } else {
        const safeName =
          file.name
            .replace(/\.pdf$/i, "")
            .replace(/[\\/:*?"<>|]/g, "_")
            .trim() || "document";
        const blob = new Blob([response.bytes], { type: "application/pdf" });
        const ready = {
          name: `${safeName}-metadata-cleaned.pdf`,
          href: URL.createObjectURL(blob),
          size: blob.size,
          pages: response.pages,
        };
        outputRef.current = ready;
        setOutput(ready);
        setStatus(`Cleaned standard metadata in ${response.pages.toLocaleString()} pages.`);
      }
      finish();
    };
    worker.onerror = () => {
      if (workerRef.current !== worker || cancelledRef.current) return;
      setError(metadataErrorMessage("processing-failed"));
      setStatus("");
      finish();
    };
    try {
      const input = await file.arrayBuffer();
      if (cancelledRef.current || workerRef.current !== worker) return;
      worker.postMessage({ input }, [input]);
    } catch (cause) {
      if (!cancelledRef.current) {
        setError(
          metadataErrorMessage(
            cause instanceof Error && /memory|allocation/i.test(cause.message)
              ? "memory"
              : "processing-failed",
          ),
        );
        setStatus("");
      }
      finish();
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    stopWorker();
    setBusy(false);
    setStatus("");
    setError(metadataErrorMessage("cancelled"));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <a
          href="/#security-pdf"
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> PDF security tools
        </a>
        <div className="mx-auto max-w-3xl">
          <header className="mb-8 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent text-primary">
              <FileMinus className="size-7" />
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Clean PDF metadata
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Remove the standard document information dictionary and XMP metadata from a PDF copy.
              Your file stays on this device.
            </p>
          </header>
          <section
            className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
            aria-label="Clean PDF metadata"
          >
            {!file ? (
              <button
                type="button"
                disabled={busy}
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
                  Up to {formatMetadataBytes(PDF_METADATA_LIMITS.inputBytes)}
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3 sm:p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                  <FileText className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{file.name}</strong>
                  <small className="text-muted-foreground">{formatMetadataBytes(file.size)}</small>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setFile(null);
                    clearOutput();
                    setError("");
                    setStatus("");
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
            {error && (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {status && (
              <p
                role="status"
                aria-live="polite"
                className="mt-4 rounded-lg bg-accent/50 p-3 text-sm"
              >
                {status}
              </p>
            )}
            <div className="mt-5 flex justify-center gap-3">
              {busy ? (
                <Button variant="outline" onClick={cancel}>
                  <X className="size-4" /> Cancel
                </Button>
              ) : (
                <Button onClick={() => void clean()} disabled={!file}>
                  <FileMinus className="size-4" /> Clean metadata
                </Button>
              )}
            </div>
            {busy && (
              <p className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Processing locally…
              </p>
            )}
            {output && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-accent/40 p-4">
                <span>
                  <strong className="block text-sm">{output.name} is ready</strong>
                  <small className="text-muted-foreground">
                    {formatMetadataBytes(output.size)} · {output.pages} pages
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
            <p className="mt-5 rounded-lg bg-soft p-3 text-xs leading-5 text-muted-foreground">
              This removes standard document information and XMP metadata. It does not remove
              visible text, annotations, comments, attachments, or redact sensitive page content.
              Use a redaction tool for information visible on pages.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
