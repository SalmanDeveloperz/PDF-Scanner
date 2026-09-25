import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Download,
  FileText,
  Files,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  formatPageBytes,
  PDF_PAGE_LIMITS,
  pdfPageErrorMessage,
  type PdfPageWorkerResponse,
} from "@/lib/pdf-pages";

type PdfFile = { id: string; file: File };
type MergedPdf = { href: string; size: number };

export const Route = createFileRoute("/merge-pdf")({ component: MergePdfPage });

function MergePdfPage() {
  const [files, setFiles] = useState<PdfFile[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [mergedPdf, setMergedPdf] = useState<MergedPdf | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const mergedPdfRef = useRef<MergedPdf | null>(null);
  const selectedBytes = files.reduce((total, item) => total + item.file.size, 0);

  const stopWorker = () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
  };

  const clearOutput = () => {
    if (mergedPdfRef.current) URL.revokeObjectURL(mergedPdfRef.current.href);
    mergedPdfRef.current = null;
    setMergedPdf(null);
  };

  useEffect(() => () => {
    workerRef.current?.terminate();
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    if (mergedPdfRef.current) URL.revokeObjectURL(mergedPdfRef.current.href);
  }, []);

  const addFiles = (incoming: FileList | File[]) => {
    const selected = Array.from(incoming);
    if (selected.length === 0) return;
    clearOutput();
    const currentBytes = files.reduce((total, item) => total + item.file.size, 0);
    const accepted: File[] = [];
    const issues: string[] = [];
    let nextBytes = currentBytes;
    let nextCount = files.length;
    for (const file of selected) {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        issues.push(`${file.name} is not a PDF and was skipped.`);
      } else if (file.size === 0) {
        issues.push(`${file.name} is empty and was skipped.`);
      } else if (file.size > PDF_PAGE_LIMITS.inputBytes) {
        issues.push(`${file.name} exceeds the ${formatPageBytes(PDF_PAGE_LIMITS.inputBytes)} input limit and was skipped.`);
      } else if (nextCount >= PDF_PAGE_LIMITS.mergeFiles) {
        issues.push(pdfPageErrorMessage("too-many-files"));
        break;
      } else if (nextBytes + file.size > PDF_PAGE_LIMITS.inputBytes) {
        issues.push(pdfPageErrorMessage("total-input-too-large"));
      } else {
        accepted.push(file);
        nextCount++;
        nextBytes += file.size;
      }
    }
    if (accepted.length) setFiles([...files, ...accepted.map((file) => ({ id: crypto.randomUUID(), file }))]);
    setError(issues.join(" "));
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    setFiles((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
      return reordered;
    });
    clearOutput();
  };

  const merge = () => {
    if (files.length < 2) {
      setError("Add at least two PDF files to merge.");
      return;
    }
    if (selectedBytes > PDF_PAGE_LIMITS.inputBytes) {
      setError(pdfPageErrorMessage("total-input-too-large"));
      return;
    }

    stopWorker();
    clearOutput();
    setError("");
    setIsMerging(true);
    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/pdf-pages.worker.ts", import.meta.url), { type: "module" });
    } catch {
      setIsMerging(false);
      setError(pdfPageErrorMessage("worker-error"));
      return;
    }
    workerRef.current = worker;

    const finish = () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      if (workerRef.current === worker) workerRef.current = null;
      worker.terminate();
      setIsMerging(false);
    };
    timeoutRef.current = window.setTimeout(() => {
      if (workerRef.current !== worker) return;
      workerRef.current = null;
      worker.terminate();
      timeoutRef.current = null;
      setIsMerging(false);
      setError(pdfPageErrorMessage("timeout"));
    }, PDF_PAGE_LIMITS.timeoutMs);

    worker.onmessage = (event: MessageEvent<PdfPageWorkerResponse>) => {
      if (workerRef.current !== worker) return;
      finish();
      const response = event.data;
      if (response.type === "error") {
        setError(pdfPageErrorMessage(response.code));
        return;
      }
      if (response.type !== "processed" || response.outputs.length !== 1) {
        setError(pdfPageErrorMessage("worker-error"));
        return;
      }
      try {
        const blob = new Blob([response.outputs[0]!.bytes], { type: "application/pdf" });
        const result = { href: URL.createObjectURL(blob), size: blob.size };
        mergedPdfRef.current = result;
        setMergedPdf(result);
      } catch {
        setError(pdfPageErrorMessage("memory"));
      }
    };
    worker.onerror = (event) => {
      if (workerRef.current !== worker) return;
      event.preventDefault();
      finish();
      setError(pdfPageErrorMessage(/memory|allocation|heap/i.test(event.message) ? "memory" : "worker-error"));
    };
    worker.onmessageerror = () => {
      if (workerRef.current !== worker) return;
      finish();
      setError(pdfPageErrorMessage("worker-error"));
    };

    worker.postMessage({ type: "merge", files: files.map(({ file }) => file) });
  };

  const clearFiles = () => {
    stopWorker();
    clearOutput();
    setFiles([]);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      <SiteHeader />
      <main className="min-h-[calc(100vh-18rem)] bg-soft px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-3xl">
          <a href="/#tools" className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-4" /> Back to PDF tools</a>
          <header className="mt-8 text-center sm:mt-10">
            <span className="mx-auto grid size-14 place-items-center rounded-xl bg-accent text-primary"><Files className="size-7" /></span>
            <p className="eyebrow mt-4">Organize PDF</p>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">Merge PDF files</h1>
            <p className="mx-auto mt-3 max-w-xl leading-7 text-muted-foreground">Combine PDFs in the order you choose. Your files stay on this device while the merge runs in a background worker.</p>
          </header>

          <section className="mt-8 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-7" aria-label="Merge PDF files">
            <input ref={inputRef} className="sr-only" type="file" accept="application/pdf,.pdf" multiple onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
            <button
              type="button"
              disabled={isMerging}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
              className={`flex w-full flex-col items-center rounded-lg border-2 border-dashed px-5 py-10 text-center transition disabled:opacity-60 ${dragging ? "border-primary bg-accent/50" : "border-border hover:border-primary/60 hover:bg-soft/70"}`}
            >
              <span className="grid size-12 place-items-center rounded-full bg-accent text-primary"><Plus className="size-6" /></span>
              <strong className="mt-4 text-base">Choose PDF files or drop them here</strong>
              <span className="mt-1 text-sm text-muted-foreground">Add 2–{PDF_PAGE_LIMITS.mergeFiles} PDFs · up to {formatPageBytes(PDF_PAGE_LIMITS.inputBytes)} combined</span>
            </button>

            {files.length > 0 && (
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="font-extrabold">Your files <span className="text-muted-foreground">({files.length})</span></h2>
                  <div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{formatPageBytes(selectedBytes)} total</span><button type="button" onClick={clearFiles} className="text-sm font-semibold text-muted-foreground hover:text-destructive">Clear all</button></div>
                </div>
                <ol className="space-y-2">
                  {files.map(({ id, file }, index) => (
                    <li key={id} className="flex items-center gap-2 rounded-lg border border-border bg-background p-3 sm:gap-3 sm:p-4">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-primary"><FileText className="size-4" /></span>
                      <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{file.name}</strong><small className="text-muted-foreground">{formatPageBytes(file.size)}</small></span>
                      <span className="hidden text-xs font-bold text-muted-foreground sm:inline">{index + 1}</span>
                      <button type="button" title="Move up" aria-label={`Move ${file.name} up`} disabled={index === 0 || isMerging} onClick={() => moveFile(index, -1)} className="rounded p-2 text-muted-foreground hover:bg-soft hover:text-foreground disabled:opacity-30"><ArrowUp className="size-4" /></button>
                      <button type="button" title="Move down" aria-label={`Move ${file.name} down`} disabled={index === files.length - 1 || isMerging} onClick={() => moveFile(index, 1)} className="rounded p-2 text-muted-foreground hover:bg-soft hover:text-foreground disabled:opacity-30"><ArrowDown className="size-4" /></button>
                      <button type="button" title="Remove file" aria-label={`Remove ${file.name}`} disabled={isMerging} onClick={() => { setFiles((current) => current.filter((item) => item.id !== id)); clearOutput(); }} className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"><Trash2 className="size-4" /></button>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
            <Button type="button" onClick={merge} disabled={isMerging || files.length < 2} className="mt-6 h-12 w-full text-base font-bold">
              {isMerging ? <><LoaderCircle className="animate-spin" /> Merging PDFs…</> : <><Download /> Merge and download</>}
            </Button>
            {mergedPdf && <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-accent/40 p-4"><span><strong className="block text-sm">Your merged PDF is ready</strong><small className="text-muted-foreground">{formatPageBytes(mergedPdf.size)}</small></span><a href={mergedPdf.href} download="merged.pdf" className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"><Download className="size-4" /> Save PDF</a></div>}
            <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">Maximum input and output: {formatPageBytes(PDF_PAGE_LIMITS.inputBytes)} · {PDF_PAGE_LIMITS.pages.toLocaleString()} pages. Password-protected or damaged PDFs may not be supported.</p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
