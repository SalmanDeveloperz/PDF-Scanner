export const IMAGE_TO_PDF_LIMITS = {
  files: 100,
  totalInputBytes: 200 * 1024 * 1024,
  imagePixels: 40_000_000,
  totalPixels: 120_000_000,
  imageDimension: 16_000,
  outputBytes: 200 * 1024 * 1024,
} as const;

export type ImagePdfPaperSize = "a4" | "letter" | "fit";
export type ImagePdfMargin = 0 | 24 | 48;
export type ImagePdfEnhancement = "natural" | "grayscale" | "high-contrast";
export type ImagePdfOptions = { enhancement?: ImagePdfEnhancement; rotations?: number[] };
