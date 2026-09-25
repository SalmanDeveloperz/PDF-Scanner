import { createFileRoute } from "@tanstack/react-router";
import { PdfOptimizeTool } from "@/components/PdfOptimizeTool";

export const Route = createFileRoute("/compress-pdf")({ component: () => <PdfOptimizeTool mode="compress" /> });
