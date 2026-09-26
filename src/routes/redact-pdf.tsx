import { createFileRoute } from "@tanstack/react-router";
import { PdfRedactTool } from "@/components/PdfRedactTool";

export const Route = createFileRoute("/redact-pdf")({ component: PdfRedactTool });
