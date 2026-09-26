import { createFileRoute } from "@tanstack/react-router";
import { PdfToJpgTool } from "@/components/PdfToJpgTool";

export const Route = createFileRoute("/pdf-to-jpg")({ component: PdfToJpgTool });
