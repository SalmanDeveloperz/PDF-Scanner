export const PDF_SECURITY_LIMITS = {
  inputBytes: 200 * 1024 * 1024,
  outputBytes: 200 * 1024 * 1024,
  passwordMinCharacters: 8,
  passwordMaxCharacters: 128,
  timeoutMs: 15 * 60 * 1000,
} as const;

export type PdfSecurityMode = "lock" | "unlock";
