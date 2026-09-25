import { createFileRoute } from "@tanstack/react-router";
import { PDFDocument } from "pdf-lib";
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
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

type PdfFile = { id: string; file: File };

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
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | File[]) => {
    const selected = Array.from(incoming);
    const valid = selected.filter(
      (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
    );
    if (valid.length !== selected.length)
      setError("Some files were skipped. Please choose PDF files only.");
    else setError("");
    setFiles((current) => [
      ...current,
      ...valid.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    setFiles((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
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
    try {
      const output = await PDFDocument.create();
      for (const item of files) {
        const source = await PDFDocument.load(await item.file.arrayBuffer());
        const pages = await output.copyPages(source, source.getPageIndices());
        pages.forEach((page) => output.addPage(page));
      }
      const bytes = await output.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "merged.pdf";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      console.error("PDF merge failed", cause);
      setError(
        "We couldn't read one of these PDFs. It may be password-protected or damaged. Check the files and try again.",
      );
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <>
      <SiteHeader />
      <main className="min-h-[calc(100vh-18rem)] bg-soft px-4 py-8 sm:px-6 sm:py-12">
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
              className={`flex w-full flex-col items-center rounded-lg border-2 border-dashed px-5 py-10 text-center transition ${dragging ? "border-primary bg-accent/50" : "border-border hover:border-primary/60 hover:bg-soft/70"}`}
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
                    onClick={() => {
                      setFiles([]);
                      setError("");
                    }}
                    className="text-sm font-semibold text-muted-foreground hover:text-destructive"
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
                        disabled={index === 0}
                        onClick={() => moveFile(index, -1)}
                        className="rounded p-2 text-muted-foreground hover:bg-soft hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        aria-label={`Move ${file.name} down`}
                        disabled={index === files.length - 1}
                        onClick={() => moveFile(index, 1)}
                        className="rounded p-2 text-muted-foreground hover:bg-soft hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowDown className="size-4" />
                      </button>
                      <button
                        type="button"
                        title="Remove file"
                        aria-label={`Remove ${file.name}`}
                        onClick={() =>
                          setFiles((current) => current.filter((item) => item.id !== id))
                        }
                        className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
            <Button
              type="button"
              onClick={merge}
              disabled={isMerging || files.length < 2}
              className="mt-6 h-12 w-full text-base font-bold"
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
            <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
              Your files are processed locally in this browser and aren’t uploaded to a server.
            </p>
          </section>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Encrypted or damaged PDFs may not be supported.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
