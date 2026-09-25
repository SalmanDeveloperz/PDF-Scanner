import { createFileRoute } from "@tanstack/react-router";
import { PdfOcrTool } from "@/components/PdfOcrTool";

export const Route = createFileRoute("/ocr-pdf")({ component: PdfOcrTool });
