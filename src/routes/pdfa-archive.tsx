import { createFileRoute } from "@tanstack/react-router";
import { PdfOptimizeTool } from "@/components/PdfOptimizeTool";

export const Route = createFileRoute("/pdfa-archive")({ component: () => <PdfOptimizeTool mode="archive" /> });
