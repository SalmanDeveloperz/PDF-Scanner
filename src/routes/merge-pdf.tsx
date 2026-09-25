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

type PdfFile = { id: string; file: File };
const MAX_TOTAL_SIZE = 200 * 1024 * 1024;
const MAX_FILES = 100;

export const Route = createFileRoute("/merge-pdf")({ component: MergePdfPage });

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MergePdfPage() {
  const [files, setFiles] = useState<PdfFile[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const addFiles = (incoming: FileList | File[]) => {
    if (isMerging) return;
    const selected = Array.from(incoming);
    const valid = selected.filter(
      (file) =>
        file.size > 0 &&
        (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")),
    );
    const invalidCount = selected.length - valid.length;
    if (files.length + valid.length > MAX_FILES) {
      setError(`You can merge up to ${MAX_FILES} PDF files at a time.`);
      return;
    }
    const nextSize =
      files.reduce((total, item) => total + item.file.size, 0) +
      valid.reduce((total, file) => total + file.size, 0);
    if (nextSize > MAX_TOTAL_SIZE) {
      setError(
        `The combined file size is over ${formatBytes(MAX_TOTAL_SIZE)}. Remove some files and try again to avoid running out of browser memory.`,
      );
      return;
    }
    setError(
      invalidCount
        ? `${invalidCount} file${invalidCount === 1 ? " was" : "s were"} skipped. Choose non-empty PDF files only.`
        : "",
    );
    setFiles((current) => [
      ...current,
      ...valid.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    if (isMerging) return;
    setFiles((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const reordered = [...current];
      const currentFile = reordered[index];
      const targetFile = reordered[target];
      if (!currentFile || !targetFile) return current;
      reordered[index] = targetFile;
      reordered[target] = currentFile;
      return reordered;
    });
  };

  const merge = async () => {
    if (files.length < 2) {
      setError("Add at least two PDF files to merge.");
      return;
    }
    setError("");
    setIsMerging(true);
    setProgress("Starting merge…");
    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/merge-pdf.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      setIsMerging(false);
      setProgress("");
      setError(
        "This browser couldn’t start the PDF processing worker. Try a current version of Chrome, Edge, Firefox, or Safari.",
      );
      return;
    }
    workerRef.current = worker;
    worker.onmessage = (
      event: MessageEvent<{
        type: string;
        completed?: number;
        total?: number;
        fileName?: string;
        bytes?: ArrayBuffer;
        code?: string;
      }>,
    ) => {
      const message = event.data;
      if (message.type === "progress") {
        setProgress(
          `Processing ${message.completed! + 1} of ${message.total}: ${message.fileName}`,
        );
        return;
      }
      worker.terminate();
      workerRef.current = null;
      setIsMerging(false);
      setProgress("");
      if (message.type === "error") {
        setError(
          message.code === "encrypted"
            ? "One of these PDFs is password-protected. Remove its password before merging."
            : message.code === "invalid"
              ? "One of these files is empty or contains no readable pages. Check the files and try again."
              : message.code === "too-many-pages"
                ? "This merge contains more than 5,000 pages, which is beyond the safe limit for browser processing. Split the files into smaller groups and try again."
                : "We couldn't merge these PDFs. One may be damaged or use a PDF feature this browser tool can't process.",
        );
        return;
      }
      if (!message.bytes) {
        setError("The merge finished without a downloadable file. Please try again.");
        return;
      }
      const url = URL.createObjectURL(new Blob([message.bytes], { type: "application/pdf" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "merged.pdf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      workerRef.current = null;
      setIsMerging(false);
      setProgress("");
      setError(
        "The browser stopped processing these files, likely because they are too large for available memory. Try smaller PDFs or use a device with more memory.",
      );
    };
    worker.onmessageerror = () => {
      worker.terminate();
      workerRef.current = null;
      setIsMerging(false);
      setProgress("");
      setError("The browser couldn’t transfer these files to the PDF processor. Please try again.");
    };
    try {
      worker.postMessage({ files: files.map((item) => item.file) });
    } catch {
      worker.terminate();
      workerRef.current = null;
      setIsMerging(false);
      setProgress("");
      setError(
        "The browser couldn’t start processing these files. Please try again with fewer or smaller PDFs.",
      );
    }
  };

  const cancelMerge = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setIsMerging(false);
    setProgress("");
    setError("Merge cancelled.");
  };

  return (
    <main className="min-h-screen bg-soft px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to PDF Scanner
        </a>
        <header className="mt-10 text-center sm:mt-14">
          <span className="mx-auto grid size-14 place-items-center rounded-xl bg-accent text-primary">
            <Files className="size-7" />
          </span>
          <p className="eyebrow mt-5">PDF Tools</p>
          <h1 className="mt-2 text-4xl font-black sm:text-5xl">Merge PDF files</h1>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">
            Combine multiple PDFs into one document. Arrange files in the order you want, then
            download your merged PDF.
          </p>
        </header>

        <section
          className="mt-9 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-7"
          aria-label="Merge PDF files"
        >
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={isMerging}
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
              <Plus className="size-6" />
            </span>
            <strong className="mt-4 text-base">Choose PDF files or drop them here</strong>
            <span className="mt-1 text-sm text-muted-foreground">
              Select two or more PDF documents
            </span>
          </button>

          {files.length > 0 && (
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-extrabold">
                  Your files <span className="text-muted-foreground">({files.length})</span>
                </h2>
                <button
                  type="button"
                  disabled={isMerging}
                  onClick={() => {
                    setFiles([]);
                    setError("");
                  }}
                  className="text-sm font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  Clear all
                </button>
              </div>
              <ol className="space-y-2">
                {files.map(({ id, file }, index) => (
                  <li
                    key={id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background p-3 sm:p-4"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-primary">
                      <FileText className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">{file.name}</strong>
                      <small className="text-muted-foreground">{formatBytes(file.size)}</small>
                    </span>
                    <span className="hidden text-xs font-bold text-muted-foreground sm:inline">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      title="Move up"
                      aria-label={`Move ${file.name} up`}
                      disabled={isMerging || index === 0}
                      onClick={() => moveFile(index, -1)}
                      className="rounded p-2 text-muted-foreground hover:bg-soft hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      title="Move down"
                      aria-label={`Move ${file.name} down`}
                      disabled={isMerging || index === files.length - 1}
                      onClick={() => moveFile(index, 1)}
                      className="rounded p-2 text-muted-foreground hover:bg-soft hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowDown className="size-4" />
                    </button>
                    <button
                      type="button"
                      title="Remove file"
                      aria-label={`Remove ${file.name}`}
                      disabled={isMerging}
                      onClick={() =>
                        setFiles((current) => current.filter((item) => item.id !== id))
                      }
                      className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ol>
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
          {progress && (
            <p className="mt-4 text-center text-sm font-medium text-muted-foreground" role="status">
              {progress}
            </p>
          )}
          <div className="mt-6 flex gap-3">
            <Button
              type="button"
              onClick={merge}
              disabled={isMerging || files.length < 2}
              className="h-12 flex-1 text-base font-bold"
            >
              {isMerging ? (
                <>
                  <LoaderCircle className="animate-spin" /> Merging PDFs…
                </>
              ) : (
                <>
                  <Download /> Merge and download
                </>
              )}
            </Button>
            {isMerging && (
              <Button type="button" variant="outline" onClick={cancelMerge} className="h-12">
                Cancel
              </Button>
            )}
          </div>
          <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
            Your files are processed locally in this browser and aren’t uploaded to a server.
          </p>
        </section>
        <p className="mt-5 text-center text-xs text-muted-foreground">
          For browser stability, merges support up to {MAX_FILES} PDFs,{" "}
          {formatBytes(MAX_TOTAL_SIZE)}
          total input, and 5,000 pages. Password-protected or damaged PDFs can’t be merged here.
        </p>
        <p className="mt-2 text-center text-xs leading-5 text-muted-foreground">
          This tool combines page content. Interactive form fields and bookmarks may not carry over;
          digital signatures won’t remain valid after merging.
        </p>
      </div>
    </main>
  );
}
