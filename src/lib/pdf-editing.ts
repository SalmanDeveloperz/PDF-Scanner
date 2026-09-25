export const PDF_EDIT_LIMITS = {
  inputBytes: 200 * 1024 * 1024,
  outputBytes: 200 * 1024 * 1024,
  pages: 2_000,
  timeoutMs: 15 * 60 * 1_000,
} as const;

export type PageSelection = "all" | "range";
export type PdfEditMode = "sign" | "watermark";

export type PdfEditRequest = {
  mode: PdfEditMode;
  input: ArrayBuffer;
  image: ArrayBuffer;
  startPage: number;
  endPage: number;
  position: "left" | "center" | "right";
  rotation: number;
};

export type PdfEditResponse =
  { type: "success"; bytes: ArrayBuffer; pageCount: number } | { type: "error"; code: string };
