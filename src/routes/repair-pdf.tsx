import { createFileRoute } from "@tanstack/react-router";
import { PdfOptimizeTool } from "@/components/PdfOptimizeTool";

export const Route = createFileRoute("/repair-pdf")({ component: () => <PdfOptimizeTool mode="repair" /> });
