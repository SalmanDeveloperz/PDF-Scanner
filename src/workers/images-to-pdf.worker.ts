import { PDFDocument, PageSizes } from "pdf-lib";
import {
  IMAGE_TO_PDF_LIMITS,
  type ImagePdfMargin,
  type ImagePdfPaperSize,
} from "@/lib/image-to-pdf";

type WorkerRequest = {
  files: File[];
  paperSize: ImagePdfPaperSize;
  margin: ImagePdfMargin;
};
type WorkerResponse =
  | { type: "progress"; completed: number; total: number; fileName: string }
  | { type: "saving" }
  | { type: "success"; bytes: ArrayBuffer }
  | {
      type: "error";
      code:
        | "invalid-image"
        | "unsupported-format"
        | "processor-unavailable"
        | "image-too-large"
        | "too-many-pixels"
        | "too-large-output"
        | "memory"
        | "failed";
      fileName?: string;
    };
type ImageWorkerErrorCode = Extract<WorkerResponse, { type: "error" }>["code"];

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

function classifyImageError(error: unknown): ImageWorkerErrorCode {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message === "image-too-large") return "image-too-large";
  if (message === "too-many-pixels") return "too-many-pixels";
  if (message === "unsupported-canvas") return "processor-unavailable";
  if (
    message.includes("out of memory") ||
    message.includes("array buffer allocation failed") ||
    message.includes("memory access out of bounds") ||
    message.includes("memory.grow")
  ) {
    return "memory";
  }
  if (
    error instanceof DOMException &&
    ["NotSupportedError", "EncodingError"].includes(error.name)
  ) {
    return "unsupported-format";
  }
  return "invalid-image";
}

function getPageDimensions(
  paperSize: ImagePdfPaperSize,
  imageWidth: number,
  imageHeight: number,
): [number, number] {
  if (paperSize === "fit") {
    const pointsPerPixel = 72 / 150;
    const scale = Math.min(1, 1_440 / Math.max(imageWidth, imageHeight));
    return [imageWidth * pointsPerPixel * scale, imageHeight * pointsPerPixel * scale];
  }

  const base = paperSize === "a4" ? PageSizes.A4 : PageSizes.Letter;
  return imageWidth / imageHeight > base[0] / base[1] ? [base[1], base[0]] : [base[0], base[1]];
}

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { files, paperSize, margin } = event.data;
  let currentFileName: string | undefined;
  let bitmap: ImageBitmap | undefined;
  try {
    if (files.length === 0 || files.length > IMAGE_TO_PDF_LIMITS.files)
      throw new Error("invalid-file-count");
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (files.some((file) => file.size === 0) || totalBytes > IMAGE_TO_PDF_LIMITS.totalInputBytes) {
      throw new Error("invalid-file-size");
    }

    const pdf = await PDFDocument.create();
    pdf.setTitle("Images to PDF");
    pdf.setCreator("PDF Scanner");
    let totalPixels = 0;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (!file) throw new Error("invalid-file-list");
      currentFileName = file.name;
      workerScope.postMessage({
        type: "progress",
        completed: index,
        total: files.length,
        fileName: file.name,
      });

      let decoded: ImageBitmap;
      try {
        decoded = await createImageBitmap(file, { imageOrientation: "from-image" });
        bitmap = decoded;
      } catch (error) {
        const code = classifyImageError(error);
        workerScope.postMessage({ type: "error", code, fileName: file.name });
        return;
      }

      const { width, height } = decoded;
      if (
        width === 0 ||
        height === 0 ||
        width > IMAGE_TO_PDF_LIMITS.imageDimension ||
        height > IMAGE_TO_PDF_LIMITS.imageDimension
      ) {
        decoded.close();
        bitmap = undefined;
        workerScope.postMessage({ type: "error", code: "image-too-large", fileName: file.name });
        return;
      }
      const imagePixels = width * height;
      if (imagePixels > IMAGE_TO_PDF_LIMITS.imagePixels) {
        decoded.close();
        bitmap = undefined;
        workerScope.postMessage({ type: "error", code: "image-too-large", fileName: file.name });
        return;
      }
      totalPixels += imagePixels;
      if (totalPixels > IMAGE_TO_PDF_LIMITS.totalPixels) {
        decoded.close();
        bitmap = undefined;
        workerScope.postMessage({ type: "error", code: "too-many-pixels", fileName: file.name });
        return;
      }

      try {
        if (typeof OffscreenCanvas === "undefined") throw new Error("unsupported-canvas");
        const preserveAlpha = file.type === "image/png" || /\.png$/i.test(file.name);
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d", { alpha: preserveAlpha });
        if (!context) throw new Error("unsupported-canvas");
        if (!preserveAlpha) {
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
        }
        context.drawImage(decoded, 0, 0);

        // PNG output keeps transparency. Other formats become a broadly supported JPEG.
        const imageBlob = await canvas.convertToBlob(
          preserveAlpha ? { type: "image/png" } : { type: "image/jpeg", quality: 0.96 },
        );
        decoded.close();
        bitmap = undefined;
        canvas.width = 0;
        canvas.height = 0;
        const imageBytes = await imageBlob.arrayBuffer();
        const embedded = preserveAlpha
          ? await pdf.embedPng(imageBytes)
          : await pdf.embedJpg(imageBytes);
        const [pageWidth, pageHeight] = getPageDimensions(paperSize, width, height);
        const page = pdf.addPage([pageWidth, pageHeight]);
        const inset = paperSize === "fit" ? 0 : margin;
        const availableWidth = pageWidth - inset * 2;
        const availableHeight = pageHeight - inset * 2;
        const scale = Math.min(availableWidth / width, availableHeight / height);
        const drawWidth = width * scale;
        const drawHeight = height * scale;
        page.drawImage(embedded, {
          x: (pageWidth - drawWidth) / 2,
          y: (pageHeight - drawHeight) / 2,
          width: drawWidth,
          height: drawHeight,
        });
      } catch (error) {
        const code = classifyImageError(error);
        decoded.close();
        bitmap = undefined;
        workerScope.postMessage({ type: "error", code, fileName: file.name });
        return;
      }

      decoded.close();
      bitmap = undefined;
    }

    workerScope.postMessage({ type: "saving" });
    const bytes = await pdf.save();
    if (bytes.byteLength > IMAGE_TO_PDF_LIMITS.outputBytes) {
      workerScope.postMessage({ type: "error", code: "too-large-output" });
      return;
    }
    const output =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? (bytes.buffer as ArrayBuffer)
        : (bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer);
    workerScope.postMessage({ type: "success", bytes: output }, [output]);
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      code: classifyImageError(error),
      ...(currentFileName ? { fileName: currentFileName } : {}),
    });
  } finally {
    bitmap?.close();
  }
};
