import { useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileText,
  LoaderCircle,
  LockKeyhole,
  UnlockKeyhole,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PDF_SECURITY_LIMITS, type PdfSecurityMode } from "@/lib/pdf-security";

type QpdfRunErrorLike = Error & {
  code?: string;
  stderr?: string[];
  exitCode?: number | null;
};

const INPUT_NAME = "source.pdf";
const OUTPUT_NAME = "secured.pdf";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isPdfHeader(bytes: Uint8Array) {
  const header = new TextDecoder("ascii").decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
  return header.includes("%PDF-");
}

function safeBaseName(name: string) {
  return (
    name
      .replace(/\.pdf$/i, "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim() || "document"
  );
}

function errorMessage(error: unknown, mode: PdfSecurityMode) {
  const cause = error as QpdfRunErrorLike;
  const diagnostics = [...(cause?.stderr ?? []), cause?.message ?? ""].join(" ").toLowerCase();
  if (cause?.code === "QPDF_INIT_FAILED") {
    return "The secure PDF engine couldn’t start. Check your connection and browser settings, then try again.";
  }
  if (cause?.code === "QPDF_TIMEOUT") {
    return "Processing took too long and was stopped. Try a smaller PDF or a device with more available memory.";
  }
  if (/password|password.*incorrect|invalid password/.test(diagnostics)) {
    return mode === "unlock"
      ? "That password didn’t unlock this PDF. Check it and try again."
      : "This PDF is already password-protected. Unlock it first, then try locking it again.";
  }
  if (/memory|allocation|out of memory|cannot enlarge memory/.test(diagnostics)) {
    return "Your device ran out of memory while processing this PDF. Try a smaller file or close other tabs and apps.";
  }
  if (/encrypted|decrypt/.test(diagnostics) && mode === "unlock") {
    return "This PDF could not be unlocked with the supplied password. It may use an unsupported encryption method or be damaged.";
  }
  if (
    /file is damaged|damaged|invalid pdf|unable to find trailer|can't find startxref|can't find start of pdf/.test(
      diagnostics,
    )
  ) {
    return "This file is damaged or isn’t a valid PDF. Check the file and try again.";
  }
  if (cause?.code === "QPDF_OUTPUT_MISSING") {
    return "The PDF engine couldn’t create an output file. The document may be damaged or use unsupported features.";
  }
  return "We couldn’t process this PDF. It may be damaged, unsupported, or incompatible with this browser.";
}

export function PdfSecurityTool({ mode }: { mode: PdfSecurityMode }) {
  const isLock = mode === "lock";
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const runnerRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const cancelledRef = useRef(false);

  const selectFile = (selected?: File) => {
    if (!selected) return;
    if (!isPdf(selected)) {
      setError("Choose a PDF file. This tool doesn’t accept other file types.");
      setStatus("");
      return;
    }
    if (selected.size === 0) {
      setError("This PDF is empty. Choose a non-empty PDF file.");
      setStatus("");
      return;
    }
    if (selected.size > PDF_SECURITY_LIMITS.inputBytes) {
      setError(
        `This PDF is ${formatBytes(selected.size)}. The input limit is ${formatBytes(PDF_SECURITY_LIMITS.inputBytes)}; choose a smaller file.`,
      );
      setStatus("");
      return;
    }
    setFile(selected);
    setPassword("");
    setConfirmation("");
    setError("");
    setStatus("");
  };

  const processPdf = async () => {
    if (!file) {
      setError("Choose a PDF file to continue.");
      return;
    }
    if (!password) {
      setError(
        isLock ? "Enter a password for the protected PDF." : "Enter the PDF’s current password.",
      );
      return;
    }
    const passwordLength = Array.from(password).length;
    if (isLock && passwordLength < PDF_SECURITY_LIMITS.passwordMinCharacters) {
      setError(
        `Use a password with at least ${PDF_SECURITY_LIMITS.passwordMinCharacters} characters.`,
      );
      return;
    }
    if (passwordLength > PDF_SECURITY_LIMITS.passwordMaxCharacters) {
      setError(`Passwords can be at most ${PDF_SECURITY_LIMITS.passwordMaxCharacters} characters.`);
      return;
    }
    if (isLock && password !== confirmation) {
      setError("The passwords don’t match. Re-enter them and try again.");
      return;
    }

    cancelledRef.current = false;
    setError("");
    setStatus("Starting secure PDF processing…");
    setIsProcessing(true);
    let runner: Awaited<ReturnType<typeof import("qpdf-run").createQpdfRunner>> | null = null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isPdfHeader(bytes)) {
        throw Object.assign(new Error("invalid pdf header"), { code: "QPDF_INVALID_INPUT" });
      }
      if (cancelledRef.current) return;
      setStatus("Loading the secure PDF engine…");
      const { createQpdfRunner } = await import("qpdf-run");
      runner = await createQpdfRunner({
        workerUrl: new URL("qpdf-run/worker", import.meta.url),
        qpdfJsUrl: new URL("qpdf-run/qpdf.js", import.meta.url),
        wasmUrl: new URL("qpdf-run/qpdf.wasm", import.meta.url),
        timeoutMs: PDF_SECURITY_LIMITS.timeoutMs,
      });
      if (cancelledRef.current) return;
      runnerRef.current = runner;
      setStatus(isLock ? "Encrypting your PDF…" : "Checking the password and decrypting your PDF…");

      const args = isLock
        ? [
            "--encrypt",
            `--user-password=${password}`,
            `--owner-password=${makeOwnerPassword()}`,
            "--bits=256",
            "--",
            INPUT_NAME,
            OUTPUT_NAME,
          ]
        : [`--password=${password}`, "--decrypt", "--", INPUT_NAME, OUTPUT_NAME];

      const result = await runner.run({
        inputs: { [INPUT_NAME]: bytes },
        args,
        outputs: [OUTPUT_NAME],
      });
      if (cancelledRef.current) return;
      const output = result.outputs[OUTPUT_NAME];
      if (!output || output.byteLength === 0) {
        throw Object.assign(new Error("missing output"), { code: "QPDF_OUTPUT_MISSING" });
      }
      if (output.byteLength > PDF_SECURITY_LIMITS.outputBytes) {
        setError(
          `The resulting PDF is ${formatBytes(output.byteLength)}, above the ${formatBytes(PDF_SECURITY_LIMITS.outputBytes)} output limit. Try a smaller source file.`,
        );
        setStatus("");
        return;
      }
      const outputName = `${safeBaseName(file.name)}-${isLock ? "locked" : "unlocked"}.pdf`;
      const outputBuffer = output.buffer.slice(
        output.byteOffset,
        output.byteOffset + output.byteLength,
      ) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([outputBuffer], { type: "application/pdf" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = outputName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus(`${isLock ? "Locked" : "Unlocked"} ${file.name} and downloaded ${outputName}.`);
      setPassword("");
      setConfirmation("");
    } catch (cause) {
      if (!cancelledRef.current) {
        setStatus("");
        if (cause instanceof Error && cause.message === "invalid pdf header") {
          setError(
            "This file doesn’t contain a valid PDF header. Choose a valid PDF and try again.",
          );
        } else {
          setError(errorMessage(cause, mode));
        }
      }
    } finally {
      runnerRef.current = null;
      await runner?.destroy().catch(() => undefined);
      if (!cancelledRef.current) setIsProcessing(false);
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    void runnerRef.current?.destroy();
    runnerRef.current = null;
    setIsProcessing(false);
    setStatus("");
    setError("Processing cancelled.");
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
            {isLock ? <LockKeyhole className="size-7" /> : <UnlockKeyhole className="size-7" />}
          </span>
          <p className="eyebrow mt-5">PDF Tools</p>
          <h1 className="mt-2 text-4xl font-black sm:text-5xl">
            {isLock ? "Lock PDF" : "Unlock PDF"}
          </h1>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">
            {isLock
              ? "Protect a PDF with a password using strong 256-bit AES encryption."
              : "Remove password protection from a PDF when you know its current password."}
          </p>
        </header>

        <section
          className="mt-9 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-7"
          aria-label={`${isLock ? "Lock" : "Unlock"} PDF`}
        >
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="application/pdf,.pdf"
            disabled={isProcessing}
            onChange={(event) => {
              selectFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              selectFile(event.dataTransfer.files[0]);
            }}
            className={`flex w-full flex-col items-center rounded-lg border-2 border-dashed px-5 py-10 text-center transition disabled:cursor-not-allowed disabled:opacity-60 ${dragging ? "border-primary bg-accent/50" : "border-border hover:border-primary/60 hover:bg-soft/70"}`}
          >
            <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
              <FileText className="size-6" />
            </span>
            <strong className="mt-4 text-base">
              {file ? "Choose a different PDF" : "Choose a PDF or drop it here"}
            </strong>
            <span className="mt-1 text-sm text-muted-foreground">
              One PDF · up to {formatBytes(PDF_SECURITY_LIMITS.inputBytes)}
            </span>
          </button>

          {file && (
            <div className="mt-5 flex items-center gap-3 rounded-lg border border-border bg-background p-3">
              <FileText className="size-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm">{file.name}</strong>
                <small className="text-muted-foreground">{formatBytes(file.size)}</small>
              </span>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  setFile(null);
                  setError("");
                  setStatus("");
                }}
                className="text-sm font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          )}

          <div className="mt-5 grid gap-4">
            <label className="grid gap-2 text-sm font-bold">
              {isLock ? "New password" : "Current PDF password"}
              <Input
                type="password"
                autoComplete={isLock ? "new-password" : "current-password"}
                value={password}
                disabled={isProcessing}
                maxLength={PDF_SECURITY_LIMITS.passwordMaxCharacters}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isLock ? "At least 8 characters" : "Enter the PDF password"}
              />
            </label>
            {isLock && (
              <label className="grid gap-2 text-sm font-bold">
                Confirm password
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  disabled={isProcessing}
                  maxLength={PDF_SECURITY_LIMITS.passwordMaxCharacters}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder="Enter the password again"
                />
              </label>
            )}
          </div>

          {!isLock && (
            <details className="mt-4 rounded-lg border border-border bg-background px-4 py-3 text-sm">
              <summary className="cursor-pointer font-semibold text-primary">
                Forgot your password?
              </summary>
              <p className="mt-3 leading-6 text-muted-foreground">
                This tool can’t recover or bypass a forgotten PDF password. Check your password
                manager or records, ask the document’s creator or administrator, or look for the
                original unprotected PDF or a backup. If you have an authorized owner password,
                you can enter it above.
              </p>
            </details>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
            >
              {error}
            </p>
          )}
          {status && (
            <p
              role="status"
              className="mt-4 break-words text-center text-sm font-medium text-muted-foreground"
            >
              {status}
            </p>
          )}
          <div className="mt-6 flex gap-3">
            <Button
              type="button"
              onClick={processPdf}
              disabled={isProcessing || !file}
              className="h-12 flex-1 text-base font-bold"
            >
              {isProcessing ? (
                <>
                  <LoaderCircle className="animate-spin" /> Processing PDF…
                </>
              ) : (
                <>
                  <Download /> {isLock ? "Lock and download" : "Unlock and download"}
                </>
              )}
            </Button>
            {isProcessing && (
              <Button type="button" variant="outline" onClick={cancel} className="h-12">
                Cancel
              </Button>
            )}
          </div>
          <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
            Your PDF and password are processed locally in your browser and aren’t uploaded.
            Password-protected PDFs restrict access in compatible readers; they are not DRM.
          </p>
        </section>
        <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
          Maximum input and output size: {formatBytes(PDF_SECURITY_LIMITS.inputBytes)}. Large PDFs
          need extra memory on your device. Unlocking requires a password you’re authorized to use.
        </p>
      </div>
    </main>
  );
}

function makeOwnerPassword() {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  return Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
