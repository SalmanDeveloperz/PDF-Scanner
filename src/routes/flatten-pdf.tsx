import { createFileRoute } from "@tanstack/react-router";
import { PdfOptimizeTool } from "@/components/PdfOptimizeTool";

export const Route = createFileRoute("/flatten-pdf")({ component: () => <PdfOptimizeTool mode="flatten" /> });
