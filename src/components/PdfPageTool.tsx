import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Files,
  LoaderCircle,
  Plus,
  RotateCw,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import {
  formatPageBytes,
  parsePageRanges,
  parsePageSelection,
  PDF_PAGE_LIMITS,
  pdfPageErrorMessage,
  type PdfPageToolMode,
  type PdfPageWorkerRequest,
  type PdfPageWorkerResponse,
} from "@/lib/pdf-pages";

const toolInfo: Record<
  PdfPageToolMode,
  { title: string; description: string; action: string; selectionLabel: string; placeholder: string; help: string }
> = {
  split: {
    title: "Split PDF",
    description: "Separate one document into smaller PDFs using the page ranges you choose.",
    action: "Split and download",
    selectionLabel: "Page ranges",
    placeholder: "Example: 1-3, 4-8, 9-12",
    help: `Each range becomes a separate PDF. Split into up to ${PDF_PAGE_LIMITS.maxSplitFiles} files.`,
  },
  organize: {
    title: "Organize PDF",
    description: "Reorder, rotate, or remove pages, then save a clean copy of your document.",
    action: "Save organized PDF",
    selectionLabel: "Pages",
    placeholder: "",
    help: "Move pages into the order you want. Rotations and removed pages are included in the saved copy.",
  },
  extract: {
    title: "Extract PDF pages",
    description: "Choose specific pages and save them as a new PDF, in the order you enter.",
    action: "Extract and download",
    selectionLabel: "Pages to extract",
    placeholder: "Example: 1, 3-5, 8",
    help: "Use commas between pages or ranges. Repeated pages are not allowed.",
  },
  remove: {
    title: "Remove PDF pages",
    description: "Delete pages you don’t need and download the remaining document.",
    action: "Remove pages and download",
    selectionLabel: "Pages to remove",
    placeholder: "Example: 2, 4-6",
    help: "At least one page must remain in the finished PDF.",
  },
};

type GeneratedPdf = { name: string; href: string; size: number };
type Phase = "inspecting" | "processing" | null;

export function PdfPageTool({ mode }: { mode: PdfPageToolMode }) {
  const info = toolInfo[mode];
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selection, setSelection] = useState("");
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [rotations, setRotations] = useState<Record<number, number>>({});
  const [removedPages, setRemovedPages] = useState<Set<number>>(new Set());
  const [listPage, setListPage] = useState(0);
  const [phase, setPhase] = useState<Phase>(null);
  const [error, setError] = useState("");
  const [outputs, setOutputs] = useState<GeneratedPdf[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const outputsRef = useRef<GeneratedPdf[]>([]);
  const rowsPerPage = 30;
  const firstVisiblePage = listPage * rowsPerPage;
  const visiblePages = pageOrder.slice(firstVisiblePage, firstVisiblePage + rowsPerPage);
  const pageInfo = pageCount ? ` · ${pageCount.toLocaleString()} pages` : "";

  const stopWorker = () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
  };

  const clearOutputs = () => {
    outputsRef.current.forEach(({ href }) => URL.revokeObjectURL(href));
    outputsRef.current = [];
    setOutputs([]);
  };

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      outputsRef.current.forEach(({ href }) => URL.revokeObjectURL(href));
    },
    [],
  );

  const runWorker = async (
    selectedFile: File,
    createRequest: (input: ArrayBuffer) => PdfPageWorkerRequest,
    nextPhase: Exclude<Phase, null>,
  ) => {
    stopWorker();
    setPhase(nextPhase);
    setError("");
    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/pdf-pages.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      setPhase(null);
      setError(pdfPageErrorMessage("worker-error"));
      return;
    }
    workerRef.current = worker;

    const finish = () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      if (workerRef.current === worker) workerRef.current = null;
      worker.terminate();
      setPhase(null);
    };

    timeoutRef.current = window.setTimeout(() => {
      if (workerRef.current !== worker) return;
      workerRef.current = null;
      worker.terminate();
      timeoutRef.current = null;
      setPhase(null);
      setError(pdfPageErrorMessage("timeout"));
    }, PDF_PAGE_LIMITS.timeoutMs);

    worker.onmessage = (event: MessageEvent<PdfPageWorkerResponse>) => {
      if (workerRef.current !== worker) return;
      finish();
      const response = event.data;
      if (response.type === "error") {
        setError(pdfPageErrorMessage(response.code));
      } else if (response.type === "inspected") {
        setPageCount(response.pageCount);
        setPageOrder(Array.from({ length: response.pageCount }, (_, index) => index));
        setRotations({});
        setRemovedPages(new Set());
        setListPage(0);
      } else {
        const generated: GeneratedPdf[] = [];
        try {
          for (const { name, bytes } of response.outputs) {
            const blob = new Blob([bytes], { type: "application/pdf" });
            generated.push({ name, href: URL.createObjectURL(blob), size: blob.size });
          }
          outputsRef.current = generated;
          setOutputs(generated);
        } catch {
          generated.forEach(({ href }) => URL.revokeObjectURL(href));
          setError(pdfPageErrorMessage("memory"));
        }
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

    try {
      const input = await selectedFile.arrayBuffer();
      if (workerRef.current !== worker) return;
      worker.postMessage(createRequest(input), [input]);
    } catch {
      if (workerRef.current !== worker) return;
      finish();
      setError(pdfPageErrorMessage("memory"));
    }
  };

  const selectFile = (selected: File | undefined) => {
    if (!selected) return;
    stopWorker();
    clearOutputs();
    setFile(null);
    setPageCount(0);
    setPageOrder([]);
    setRotations({});
    setRemovedPages(new Set());
    setSelection("");
    setError("");

    if (selected.type !== "application/pdf" && !selected.name.toLowerCase().endsWith(".pdf")) {
      setError(pdfPageErrorMessage("wrong-type"));
      return;
    }
    if (selected.size === 0) {
      setError(pdfPageErrorMessage("empty-file"));
      return;
    }
    if (selected.size > PDF_PAGE_LIMITS.inputBytes) {
      setError(pdfPageErrorMessage("input-too-large"));
      return;
    }
    setFile(selected);
    void runWorker(selected, (input) => ({ type: "inspect", input }), "inspecting");
  };

  const processPdf = () => {
    if (!file || pageCount === 0 || phase) return;
    clearOutputs();
    setError("");
    let request: (input: ArrayBuffer) => PdfPageWorkerRequest;

    if (mode === "split") {
      try {
        parsePageRanges(selection, pageCount);
      } catch (cause) {
        setError(pdfPageErrorMessage(cause instanceof Error ? cause.message : "invalid-selection"));
        return;
      }
      request = (input) => ({ type: "process", mode, input, selection });
    } else if (mode === "extract" || mode === "remove") {
      try {
        parsePageSelection(selection, pageCount);
      } catch (cause) {
        setError(pdfPageErrorMessage(cause instanceof Error ? cause.message : "invalid-selection"));
        return;
      }
      request = (input) => ({ type: "process", mode, input, selection });
    } else {
      const orderedPages = pageOrder
        .filter((pageIndex) => !removedPages.has(pageIndex))
        .map((pageIndex) => ({ pageIndex, rotation: rotations[pageIndex] ?? 0 }));
      if (orderedPages.length === 0) {
        setError(pdfPageErrorMessage("no-pages-left"));
        return;
      }
      request = (input) => ({ type: "process", mode, input, pageOrder: orderedPages });
    }
    void runWorker(file, request, "processing");
  };

  const movePage = (index: number, direction: -1 | 1) => {
    setPageOrder((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
      return reordered;
    });
  };

  const rotatePage = (pageIndex: number) => {
    setRotations((current) => ({ ...current, [pageIndex]: ((current[pageIndex] ?? 0) + 90) % 360 }));
  };

  const clearFile = () => {
    stopWorker();
    clearOutputs();
    setFile(null);
    setPageCount(0);
    setPageOrder([]);
    setRotations({});
    setRemovedPages(new Set());
    setSelection("");
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <>
      <SiteHeader />
      <main className="min-h-[calc(100vh-18rem)] bg-soft px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-4xl">
          <a href="/#tools" className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition hover:text-foreground">
            <ArrowLeft className="size-4" /> Back to PDF tools
          </a>
          <header className="mt-8 text-center sm:mt-10">
            <span className="mx-auto grid size-14 place-items-center rounded-xl bg-accent text-primary">
              {mode === "organize" ? <Files className="size-7" /> : <Scissors className="size-7" />}
            </span>
            <p className="eyebrow mt-4">Organize PDF</p>
            <h1 className="mt-2 text-4xl font-black sm:text-5xl">{info.title}</h1>
            <p className="mx-auto mt-3 max-w-2xl leading-7 text-muted-foreground">{info.description}</p>
          </header>

          <section className="mt-8 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-7" aria-label={info.title}>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                selectFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            {!file ? (
              <button
                type="button"
                disabled={phase !== null}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]); }}
                className={`flex w-full flex-col items-center rounded-lg border-2 border-dashed px-5 py-10 text-center transition disabled:opacity-60 ${dragging ? "border-primary bg-accent/50" : "border-border hover:border-primary/60 hover:bg-soft/70"}`}
              >
                <span className="grid size-12 place-items-center rounded-full bg-accent text-primary"><Plus className="size-6" /></span>
                <strong className="mt-4 text-base">Choose one PDF or drop it here</strong>
                <span className="mt-1 text-sm text-muted-foreground">Up to {formatPageBytes(PDF_PAGE_LIMITS.inputBytes)}</span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3 sm:p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-primary"><FileText className="size-5" /></span>
                <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{file.name}</strong><small className="text-muted-foreground">{formatPageBytes(file.size)}{pageInfo}</small></span>
                {phase === "inspecting" ? <LoaderCircle className="size-5 animate-spin text-primary" aria-label="Reading PDF" /> : null}
                <button type="button" onClick={clearFile} className="rounded p-2 text-muted-foreground hover:bg-soft hover:text-destructive" aria-label="Remove PDF"><X className="size-4" /></button>
              </div>
            )}

            {file && pageCount > 0 && mode !== "organize" && (
              <label className="mt-6 block">
                <span className="mb-2 block text-sm font-bold">{info.selectionLabel}</span>
                <input
                  type="text"
                  inputMode="text"
                  value={selection}
                  onChange={(event) => setSelection(event.target.value)}
                  placeholder={info.placeholder}
                  aria-describedby="page-selection-help"
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span id="page-selection-help" className="mt-2 block text-xs leading-5 text-muted-foreground">{info.help} This PDF has {pageCount.toLocaleString()} pages.</span>
              </label>
            )}

            {file && pageCount > 0 && mode === "organize" && (
              <div className="mt-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div><h2 className="font-extrabold">Arrange pages</h2><p className="mt-1 text-xs text-muted-foreground">{info.help}</p></div>
                  <button type="button" onClick={() => { setPageOrder(Array.from({ length: pageCount }, (_, index) => index)); setRotations({}); setRemovedPages(new Set()); setListPage(0); }} className="text-xs font-bold text-primary">Reset changes</button>
                </div>
                <ol className="grid gap-2 sm:grid-cols-2">
                  {visiblePages.map((sourcePageIndex, visibleIndex) => {
                    const index = firstVisiblePage + visibleIndex;
                    const removed = removedPages.has(sourcePageIndex);
                    return (
                      <li key={sourcePageIndex} className={`flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background p-2.5 ${removed ? "opacity-50" : ""}`}>
                        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-primary"><FileText className="size-4" /></span>
                        <span className="min-w-0 flex-1"><strong className="block text-sm">Page {sourcePageIndex + 1}</strong><small className="text-xs text-muted-foreground">Position {index + 1}{rotations[sourcePageIndex] ? ` · rotated ${rotations[sourcePageIndex]}°` : ""}{removed ? " · removed" : ""}</small></span>
                        <button type="button" title="Move up" aria-label={`Move page ${sourcePageIndex + 1} up`} disabled={index === 0 || removed || phase !== null} onClick={() => movePage(index, -1)} className="rounded p-1.5 text-muted-foreground hover:bg-soft disabled:opacity-30"><ArrowUp className="size-4" /></button>
                        <button type="button" title="Move down" aria-label={`Move page ${sourcePageIndex + 1} down`} disabled={index === pageOrder.length - 1 || removed || phase !== null} onClick={() => movePage(index, 1)} className="rounded p-1.5 text-muted-foreground hover:bg-soft disabled:opacity-30"><ArrowDown className="size-4" /></button>
                        <button type="button" title="Rotate page" aria-label={`Rotate page ${sourcePageIndex + 1}`} disabled={removed || phase !== null} onClick={() => rotatePage(sourcePageIndex)} className="rounded p-1.5 text-muted-foreground hover:bg-soft hover:text-primary disabled:opacity-30"><RotateCw className="size-4" /></button>
                        <button type="button" title={removed ? "Restore page" : "Remove page"} aria-label={`${removed ? "Restore" : "Remove"} page ${sourcePageIndex + 1}`} disabled={phase !== null} onClick={() => setRemovedPages((current) => { const next = new Set(current); if (next.has(sourcePageIndex)) next.delete(sourcePageIndex); else next.add(sourcePageIndex); return next; })} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30">{removed ? <Check className="size-4" /> : <Trash2 className="size-4" />}</button>
                      </li>
                    );
                  })}
                </ol>
                {pageOrder.length > rowsPerPage && (
                  <div className="mt-4 flex items-center justify-center gap-3 text-sm">
                    <button type="button" aria-label="Previous page list" disabled={listPage === 0} onClick={() => setListPage((page) => Math.max(0, page - 1))} className="rounded-md border border-border p-2 disabled:opacity-40"><ChevronLeft className="size-4" /></button>
                    <span className="text-muted-foreground">Pages {firstVisiblePage + 1}–{Math.min(firstVisiblePage + rowsPerPage, pageCount)} of {pageCount}</span>
                    <button type="button" aria-label="Next page list" disabled={firstVisiblePage + rowsPerPage >= pageCount} onClick={() => setListPage((page) => page + 1)} className="rounded-md border border-border p-2 disabled:opacity-40"><ChevronRight className="size-4" /></button>
                  </div>
                )}
              </div>
            )}

            {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}

            <Button type="button" onClick={processPdf} disabled={!file || pageCount === 0 || phase !== null} className="mt-6 h-12 w-full text-base font-bold">
              {phase ? <><LoaderCircle className="animate-spin" />{phase === "inspecting" ? "Reading PDF…" : "Processing PDF…"}</> : <><Download />{info.action}</>}
            </Button>
            {outputs.length > 0 && (
              <section className="mt-6 rounded-lg border border-primary/20 bg-accent/40 p-4" aria-live="polite">
                <h2 className="font-extrabold">Ready to download ({outputs.length})</h2>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {outputs.map((output) => <li key={output.href} className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-card p-3"><FileText className="size-4 shrink-0 text-primary" /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{output.name}</strong><small className="text-muted-foreground">{formatPageBytes(output.size)}</small></span><a href={output.href} download={output.name} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"><Download className="size-3.5" /> Save</a></li>)}
                </ul>
              </section>
            )}

            <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">Your PDF stays on this device. Files are processed in a background worker so the page stays responsive.</p>
          </section>
          <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">Maximum input and combined output: {formatPageBytes(PDF_PAGE_LIMITS.inputBytes)} · {PDF_PAGE_LIMITS.pages.toLocaleString()} pages. Password-protected, damaged, or unusually complex PDFs may not be supported.</p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
