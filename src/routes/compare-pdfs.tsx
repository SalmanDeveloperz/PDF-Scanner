import { createFileRoute } from "@tanstack/react-router";
import { PdfCompareTool } from "@/components/PdfCompareTool";

export const Route = createFileRoute("/compare-pdfs")({ component: PdfCompareTool });
