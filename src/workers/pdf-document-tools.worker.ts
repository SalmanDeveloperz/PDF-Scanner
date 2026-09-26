import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  PDF_DOCUMENT_TOOL_LIMITS,
  type PdfDocumentToolRequest,
  type PdfDocumentToolResponse,
} from "@/lib/pdf-document-tools";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PdfDocumentToolRequest>) => void) | null;
  postMessage(message: PdfDocumentToolResponse, transfer?: Transferable[]): void;
};

function colorFromHex(value: string) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error("invalid-edit");
  return rgb(
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
  );
}

function fitText(
  text: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
  maxWidth: number,
  maxHeight: number,
) {
  const maxLines = Math.max(1, Math.floor(maxHeight / (size * 1.25)));
  const lines: string[] = [];
  let line = "";
  for (const word of text.replace(/\r/g, "").split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const truncated =
    lines.length >= maxLines &&
    text.replace(/\s+/g, " ").trim().split(" ").length > lines.join(" ").split(" ").length;
  if (truncated && lines.length) {
    let last = lines[lines.length - 1] ?? "";
    while (last && font.widthOfTextAtSize(`${last}...`, size) > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}...`;
  }
  return lines.join("\n");
}

function classifyError(cause: unknown) {
  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  if (message.includes("empty-file")) return "empty-file";
  if (message.includes("input-too-large")) return "input-too-large";
  if (message.includes("password") || message.includes("encrypted")) return "password-protected";
  if (message.includes("unsupported-text")) return "unsupported-text";
  if (message.includes("invalid-crop")) return "invalid-crop";
  if (message.includes("invalid-edit")) return "invalid-edit";
  if (message.includes("output-too-large")) return "output-too-large";
  if (message.includes("too-many-pages")) return "too-many-pages";
  if (message.includes("empty-document")) return "damaged-pdf";
  if (message.includes("memory") || message.includes("allocation") || message.includes("heap"))
    return "memory";
  if (
    message.includes("invalid pdf") ||
    message.includes("invalid object") ||
    message.includes("corrupt") ||
    message.includes("xref")
  )
    return "damaged-pdf";
  return "processing-failed";
}

scope.onmessage = async (event) => {
  try {
    const request = event.data;
    if (request.input.byteLength === 0) throw new Error("empty-file");
    if (request.input.byteLength > PDF_DOCUMENT_TOOL_LIMITS.inputBytes)
      throw new Error("input-too-large");
    const document = await PDFDocument.load(request.input, {
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    const pages = document.getPages();
    if (!pages.length) throw new Error("empty-document");
    if (pages.length > PDF_DOCUMENT_TOOL_LIMITS.pages) throw new Error("too-many-pages");

    if (request.mode === "edit") {
      if (request.items.length > PDF_DOCUMENT_TOOL_LIMITS.editItems)
        throw new Error("invalid-edit");
      const font = await document.embedFont(StandardFonts.Helvetica);
      for (const item of request.items) {
        const page = pages[item.pageIndex];
        if (
          !page ||
          ![item.x, item.y, item.width, item.height, item.fontSize].every(Number.isFinite) ||
          item.x < 0 ||
          item.y < 0 ||
          item.width <= 0 ||
          item.height <= 0 ||
          item.fontSize < 6 ||
          item.fontSize > 96
        )
          throw new Error("invalid-edit");
        const { width, height } = page.getSize();
        if (item.x > width || item.y > height || item.width > width || item.height > height)
          throw new Error("invalid-edit");
        const color = colorFromHex(item.color);
        if (item.type === "text") {
          const text = item.text.trim().slice(0, 500);
          if (!text) throw new Error("invalid-edit");
          try {
            font.encodeText(text);
          } catch {
            throw new Error("unsupported-text");
          }
          const x = Math.min(item.x, width - 12);
          const y = Math.min(Math.max(item.fontSize, item.y), height - item.fontSize);
          const maxWidth = Math.max(1, Math.min(item.width, width - x));
          page.drawText(fitText(text, font, item.fontSize, maxWidth, height - y), {
            x,
            y,
            size: item.fontSize,
            font,
            color,
            lineHeight: item.fontSize * 1.25,
          });
        } else if (item.type === "note") {
          const text = item.text.trim().slice(0, 500);
          if (!text) throw new Error("invalid-edit");
          try {
            font.encodeText(text);
          } catch {
            throw new Error("unsupported-text");
          }
          const noteWidth = Math.min(item.width, width);
          const noteHeight = Math.min(item.height, height);
          const noteX = Math.min(item.x, width - noteWidth);
          const noteY = Math.min(item.y, height - noteHeight);
          page.drawRectangle({
            x: noteX,
            y: noteY,
            width: noteWidth,
            height: noteHeight,
            color: rgb(1, 0.96, 0.73),
            borderColor: color,
            borderWidth: 0.8,
          });
          page.drawText(
            fitText(text, font, item.fontSize, Math.max(1, noteWidth - 12), noteHeight - 12),
            {
              x: noteX + 6,
              y: noteY + noteHeight - item.fontSize - 6,
              size: item.fontSize,
              font,
              color: rgb(0.12, 0.12, 0.12),
              lineHeight: item.fontSize * 1.25,
            },
          );
        } else if (item.type === "rectangle") {
          page.drawRectangle({
            x: item.x,
            y: item.y,
            width: Math.min(item.width, width - item.x),
            height: Math.min(item.height, height - item.y),
            color,
            opacity: 0.12,
            borderColor: color,
            borderWidth: 1.5,
          });
        } else throw new Error("invalid-edit");
      }
    } else if (request.mode === "crop") {
      const { top, right, bottom, left } = request.margins;
      if (
        ![top, right, bottom, left].every(
          (value) => Number.isFinite(value) && value >= 0 && value <= 720,
        )
      )
        throw new Error("invalid-crop");
      for (const page of pages) {
        const box = page.getCropBox();
        if (left + right >= box.width - 72 || top + bottom >= box.height - 72)
          throw new Error("invalid-crop");
        page.setCropBox(
          box.x + left,
          box.y + bottom,
          box.width - left - right,
          box.height - top - bottom,
        );
      }
    } else {
      if (
        !Number.isSafeInteger(request.startNumber) ||
        request.startNumber < 1 ||
        request.startNumber > 1_000_000 ||
        !Number.isFinite(request.fontSize) ||
        request.fontSize < 6 ||
        request.fontSize > 36
      )
        throw new Error("invalid-edit");
      if (request.startNumber + pages.length - 1 > 1_000_000) throw new Error("invalid-edit");
      const color = colorFromHex(request.color);
      const font = await document.embedFont(StandardFonts.Helvetica);
      pages.forEach((page, index) => {
        const number = request.startNumber + index;
        const label =
          request.style === "page"
            ? `Page ${number}`
            : request.style === "of"
              ? `${number} of ${request.startNumber + pages.length - 1}`
              : `${number}`;
        try {
          font.encodeText(label);
        } catch {
          throw new Error("unsupported-text");
        }
        const width = font.widthOfTextAtSize(label, request.fontSize);
        const box = page.getCropBox();
        const pageWidth = box.width;
        const pageHeight = box.height;
        const rotation = ((page.getRotation().angle % 360) + 360) % 360;
        let x = box.x + (pageWidth - width) / 2;
        let y = box.y + 18;
        if (rotation === 90) {
          x = box.x + pageWidth - 18;
          y = box.y + (pageHeight - width) / 2;
        } else if (rotation === 180) {
          x = box.x + (pageWidth + width) / 2;
          y = box.y + pageHeight - 18;
        } else if (rotation === 270) {
          x = box.x + 18;
          y = box.y + (pageHeight + width) / 2;
        }
        page.drawText(label, {
          x,
          y,
          size: request.fontSize,
          font,
          color,
          rotate: degrees(-rotation),
        });
      });
    }

    const output = await document.save({ useObjectStreams: true });
    if (output.byteLength > PDF_DOCUMENT_TOOL_LIMITS.outputBytes)
      throw new Error("output-too-large");
    const bytes =
      output.byteOffset === 0 && output.byteLength === output.buffer.byteLength
        ? (output.buffer as ArrayBuffer)
        : (output.buffer.slice(
            output.byteOffset,
            output.byteOffset + output.byteLength,
          ) as ArrayBuffer);
    scope.postMessage({ type: "success", bytes, pageCount: pages.length }, [bytes]);
  } catch (cause) {
    scope.postMessage({ type: "error", code: classifyError(cause) });
  }
};
