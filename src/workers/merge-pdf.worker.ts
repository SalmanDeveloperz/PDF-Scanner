import { EncryptedPDFError, PDFDocument } from "pdf-lib";

type WorkerRequest = { files: File[] };
type WorkerResponse =
  | { type: "progress"; completed: number; total: number; fileName: string }
  | { type: "success"; bytes: ArrayBuffer }
  | { type: "error"; code: "encrypted" | "invalid" | "too-many-pages" | "failed" };

const MAX_OUTPUT_PAGES = 5_000;

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { files } = event.data;
  try {
    const merged = await PDFDocument.create();
    let pageCount = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (!file) throw new Error("invalid-file-list");
      workerScope.postMessage({
        type: "progress",
        completed: index,
        total: files.length,
        fileName: file.name,
      } satisfies WorkerResponse);
      if (file.size === 0) throw new Error("empty-pdf");

      // Process sources one at a time so we don't keep every source byte buffer around.
      const source = await PDFDocument.load(await file.arrayBuffer());
      const pageIndices = source.getPageIndices();
      if (pageIndices.length === 0) throw new Error("empty-pdf");
      pageCount += pageIndices.length;
      if (pageCount > MAX_OUTPUT_PAGES) throw new Error("too-many-pages");
      const pages = await merged.copyPages(source, pageIndices);
      pages.forEach((page) => merged.addPage(page));
    }

    const bytes = await merged.save();
    const output = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    workerScope.postMessage({ type: "success", bytes: output } satisfies WorkerResponse, [output]);
  } catch (error) {
    const code =
      error instanceof EncryptedPDFError
        ? "encrypted"
        : error instanceof Error && error.message === "empty-pdf"
          ? "invalid"
          : error instanceof Error && error.message === "too-many-pages"
            ? "too-many-pages"
            : "failed";
    workerScope.postMessage({ type: "error", code } satisfies WorkerResponse);
  }
};
